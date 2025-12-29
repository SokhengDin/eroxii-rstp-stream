use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tauri::State;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio_tungstenite::tungstenite::Message;

// Stream state management
#[derive(Default)]
pub struct StreamManager {
    streams: RwLock<HashMap<u16, StreamInfo>>,
}

struct StreamInfo {
    rtsp_url: String,
    shutdown_tx: broadcast::Sender<()>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StreamStatus {
    pub port: u16,
    pub rtsp_url: String,
    pub ws_url: String,
    pub active: bool,
}

#[derive(Serialize, Deserialize)]
pub struct StreamResponse {
    pub success: bool,
    pub message: String,
    pub ws_url: Option<String>,
    pub port: Option<u16>,
}

// Start RTSP stream and create WebSocket relay
#[tauri::command]
async fn start_stream(
    rtsp_url: String,
    ws_port: u16,
    stream_manager: State<'_, Arc<StreamManager>>,
) -> Result<StreamResponse, String> {
    // Check if port is already in use
    {
        let streams = stream_manager.streams.read().await;
        if streams.contains_key(&ws_port) {
            return Ok(StreamResponse {
                success: false,
                message: format!("Port {} is already in use", ws_port),
                ws_url: None,
                port: None,
            });
        }
    }

    let (shutdown_tx, _) = broadcast::channel::<()>(1);
    let shutdown_rx = shutdown_tx.subscribe();

    // Store stream info
    {
        let mut streams = stream_manager.streams.write().await;
        streams.insert(
            ws_port,
            StreamInfo {
                rtsp_url: rtsp_url.clone(),
                shutdown_tx: shutdown_tx.clone(),
            },
        );
    }

    let rtsp_url_clone = rtsp_url.clone();
    let stream_manager_clone = Arc::clone(&stream_manager.inner());

    // Spawn the stream handler
    tokio::spawn(async move {
        if let Err(e) = run_stream_server(rtsp_url_clone, ws_port, shutdown_rx).await {
            log::error!("Stream server error: {}", e);
        }

        // Clean up on exit
        let mut streams = stream_manager_clone.streams.write().await;
        streams.remove(&ws_port);
    });

    Ok(StreamResponse {
        success: true,
        message: format!("Stream started on port {}", ws_port),
        ws_url: Some(format!("ws://127.0.0.1:{}", ws_port)),
        port: Some(ws_port),
    })
}

// Stop a running stream
#[tauri::command]
async fn stop_stream(
    ws_port: u16,
    stream_manager: State<'_, Arc<StreamManager>>,
) -> Result<StreamResponse, String> {
    let mut streams = stream_manager.streams.write().await;

    if let Some(info) = streams.remove(&ws_port) {
        let _ = info.shutdown_tx.send(());
        Ok(StreamResponse {
            success: true,
            message: format!("Stream on port {} stopped", ws_port),
            ws_url: None,
            port: Some(ws_port),
        })
    } else {
        Ok(StreamResponse {
            success: false,
            message: format!("No stream found on port {}", ws_port),
            ws_url: None,
            port: None,
        })
    }
}

// Get all active streams
#[tauri::command]
async fn get_active_streams(
    stream_manager: State<'_, Arc<StreamManager>>,
) -> Result<Vec<StreamStatus>, String> {
    let streams = stream_manager.streams.read().await;
    let statuses: Vec<StreamStatus> = streams
        .iter()
        .map(|(port, info)| StreamStatus {
            port: *port,
            rtsp_url: info.rtsp_url.clone(),
            ws_url: format!("ws://127.0.0.1:{}", port),
            active: true,
        })
        .collect();
    Ok(statuses)
}

// Check if FFmpeg is available
#[tauri::command]
async fn check_ffmpeg() -> Result<bool, String> {
    match Command::new("ffmpeg").arg("-version").output() {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

// Run the WebSocket server that relays FFmpeg output
async fn run_stream_server(
    rtsp_url: String,
    ws_port: u16,
    mut shutdown_rx: broadcast::Receiver<()>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Bind WebSocket server
    let listener = TcpListener::bind(format!("127.0.0.1:{}", ws_port)).await?;
    log::info!("WebSocket server listening on port {}", ws_port);

    // Create a broadcast channel for video data
    let (video_tx, _) = broadcast::channel::<Vec<u8>>(100);
    let video_tx = Arc::new(video_tx);

    // Spawn FFmpeg process
    let ffmpeg_handle = Arc::new(Mutex::new(None::<Child>));
    let ffmpeg_handle_clone = Arc::clone(&ffmpeg_handle);
    let video_tx_clone = Arc::clone(&video_tx);
    let rtsp_url_clone = rtsp_url.clone();

    // FFmpeg runner task
    let ffmpeg_task = tokio::spawn(async move {
        let mut ffmpeg = match Command::new("ffmpeg")
            .args([
                "-rtsp_transport", "tcp",      // Use TCP for RTSP (more reliable)
                "-i", &rtsp_url_clone,          // Input RTSP URL
                "-f", "mpegts",                 // Output format: MPEG-TS
                "-codec:v", "mpeg1video",       // Video codec for jsmpeg
                "-s", "640x480",                // Resolution
                "-b:v", "1000k",                // Video bitrate
                "-bf", "0",                     // No B-frames (lower latency)
                "-r", "25",                     // Frame rate
                "-an",                          // No audio (simplifies things)
                "-flush_packets", "1",          // Flush packets immediately
                "pipe:1",                       // Output to stdout
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                log::error!("Failed to start FFmpeg: {}", e);
                return;
            }
        };

        *ffmpeg_handle_clone.lock().await = Some(ffmpeg.id().try_into().unwrap_or(0) as i32).map(|_| {
            // Store process handle for cleanup - we need to return the child
            unreachable!()
        }).ok();

        if let Some(stdout) = ffmpeg.stdout.take() {
            let mut reader = std::io::BufReader::new(stdout);
            let mut buffer = [0u8; 4096];

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let _ = video_tx_clone.send(buffer[..n].to_vec());
                    }
                    Err(e) => {
                        log::error!("FFmpeg read error: {}", e);
                        break;
                    }
                }
            }
        }

        let _ = ffmpeg.kill();
        let _ = ffmpeg.wait();
    });

    // Accept WebSocket connections
    loop {
        tokio::select! {
            _ = shutdown_rx.recv() => {
                log::info!("Shutting down stream server on port {}", ws_port);
                break;
            }
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((stream, addr)) => {
                        log::info!("New WebSocket connection from {}", addr);
                        let video_rx = video_tx.subscribe();

                        tokio::spawn(async move {
                            if let Ok(ws_stream) = tokio_tungstenite::accept_async(stream).await {
                                handle_ws_connection(ws_stream, video_rx).await;
                            }
                        });
                    }
                    Err(e) => {
                        log::error!("Accept error: {}", e);
                    }
                }
            }
        }
    }

    // Cleanup
    ffmpeg_task.abort();
    if let Some(mut child) = ffmpeg_handle.lock().await.take() {
        let _ = child.kill();
    }

    Ok(())
}

// Handle individual WebSocket connection
async fn handle_ws_connection(
    ws_stream: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    mut video_rx: broadcast::Receiver<Vec<u8>>,
) {
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Send video data to client
    let send_task = tokio::spawn(async move {
        while let Ok(data) = video_rx.recv().await {
            if ws_sender.send(Message::Binary(data.into())).await.is_err() {
                break;
            }
        }
    });

    // Handle incoming messages (for keep-alive/control)
    let recv_task = tokio::spawn(async move {
        while let Some(msg) = ws_receiver.next().await {
            match msg {
                Ok(Message::Close(_)) => break,
                Ok(Message::Ping(data)) => {
                    // Pong is handled automatically by tungstenite
                    log::debug!("Received ping: {:?}", data);
                }
                Err(_) => break,
                _ => {}
            }
        }
    });

    // Wait for either task to complete
    tokio::select! {
        _ = send_task => {}
        _ = recv_task => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(StreamManager::default()))
        .invoke_handler(tauri::generate_handler![
            start_stream,
            stop_stream,
            get_active_streams,
            check_ffmpeg
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
