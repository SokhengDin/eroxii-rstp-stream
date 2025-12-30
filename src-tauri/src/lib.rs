use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use socket2::{Domain, Socket, Type};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::Read;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use tauri::State;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, RwLock};
use tokio_tungstenite::tungstenite::Message;

// Find FFmpeg executable - searches common Windows locations
fn find_ffmpeg() -> String {
    // Check environment variable first
    if let Ok(path) = env::var("FFMPEG_PATH") {
        if std::path::Path::new(&path).exists() {
            log::info!("Using FFmpeg from FFMPEG_PATH: {}", path);
            return path;
        }
    }

    // Check if ffmpeg is in PATH
    if let Ok(output) = Command::new("ffmpeg").arg("-version").output() {
        if output.status.success() {
            log::info!("Using FFmpeg from PATH");
            return "ffmpeg".to_string();
        }
    }

    // Common Windows locations
    let home = dirs::home_dir().unwrap_or_default();
    let paths = vec![
        home.join("AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe"),
        PathBuf::from("C:/ffmpeg/bin/ffmpeg.exe"),
        PathBuf::from("C:/Program Files/ffmpeg/bin/ffmpeg.exe"),
        home.join("scoop/apps/ffmpeg/current/bin/ffmpeg.exe"),
    ];

    // Search WinGet packages folder
    let winget_base = home.join("AppData/Local/Microsoft/WinGet/Packages");
    if winget_base.exists() {
        if let Ok(entries) = fs::read_dir(&winget_base) {
            for entry in entries.flatten() {
                let dir_name = entry.file_name().to_string_lossy().to_lowercase();
                if dir_name.contains("ffmpeg") {
                    if let Some(found) = search_ffmpeg_in_dir(&entry.path(), 0) {
                        log::info!("Found FFmpeg in WinGet: {}", found.display());
                        return found.to_string_lossy().to_string();
                    }
                }
            }
        }
    }

    // Check common paths
    for path in paths {
        if path.exists() {
            log::info!("Found FFmpeg at: {}", path.display());
            return path.to_string_lossy().to_string();
        }
    }

    log::warn!("FFmpeg not found, using 'ffmpeg' as fallback");
    "ffmpeg".to_string()
}

// Recursively search for ffmpeg.exe in a directory
fn search_ffmpeg_in_dir(dir: &std::path::Path, depth: u32) -> Option<PathBuf> {
    if depth > 3 {
        return None;
    }

    let entries: Vec<_> = fs::read_dir(dir).ok()?.flatten().collect();

    // First check files in current directory
    for entry in &entries {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name() {
                if name.to_string_lossy().to_lowercase() == "ffmpeg.exe" {
                    return Some(path);
                }
            }
        }
    }

    // Then recurse into subdirectories
    for entry in &entries {
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name() {
                if !name.to_string_lossy().starts_with('.') {
                    if let Some(found) = search_ffmpeg_in_dir(&path, depth + 1) {
                        return Some(found);
                    }
                }
            }
        }
    }

    None
}

// Get FFmpeg path (cached)
fn get_ffmpeg_path() -> String {
    use std::sync::OnceLock;
    static FFMPEG_PATH: OnceLock<String> = OnceLock::new();
    FFMPEG_PATH.get_or_init(find_ffmpeg).clone()
}

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
    log::info!("Received start_stream request: rtsp_url={}, ws_port={}", rtsp_url, ws_port);

    // Check if port is already in use
    {
        let streams = stream_manager.streams.read().await;
        if streams.contains_key(&ws_port) {
            log::warn!("Port {} is already in use", ws_port);
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
    let ffmpeg_path = get_ffmpeg_path();
    log::info!("Checking FFmpeg at: {}", ffmpeg_path);
    match Command::new(&ffmpeg_path).arg("-version").output() {
        Ok(output) => {
            log::info!("FFmpeg check result: {}", output.status.success());
            Ok(output.status.success())
        }
        Err(e) => {
            log::error!("FFmpeg check error: {}", e);
            Ok(false)
        }
    }
}

// Run the WebSocket server that relays FFmpeg output
async fn run_stream_server(
    rtsp_url: String,
    ws_port: u16,
    mut shutdown_rx: broadcast::Receiver<()>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    log::info!("Attempting to bind WebSocket server on port {}", ws_port);

    // Create socket with SO_REUSEADDR to allow quick rebinding
    let addr: SocketAddr = format!("127.0.0.1:{}", ws_port).parse().unwrap();
    let socket = Socket::new(Domain::IPV4, Type::STREAM, None)?;
    socket.set_reuse_address(true)?;
    socket.bind(&addr.into())?;
    socket.listen(128)?;
    socket.set_nonblocking(true)?;

    let listener = TcpListener::from_std(socket.into())?;
    log::info!("Successfully bound WebSocket server on port {}", ws_port);

    // Create a broadcast channel for video data
    let (video_tx, _) = broadcast::channel::<Vec<u8>>(100);
    let video_tx = Arc::new(video_tx);

    // Spawn FFmpeg process
    let video_tx_clone = Arc::clone(&video_tx);
    let rtsp_url_clone = rtsp_url.clone();

    // FFmpeg runner task - use spawn_blocking for blocking I/O
    let ffmpeg_path = get_ffmpeg_path();
    let ffmpeg_task = tokio::task::spawn_blocking(move || {
        log::info!("Starting FFmpeg ({}) for RTSP URL: {}", ffmpeg_path, rtsp_url_clone);

        let mut cmd = Command::new(&ffmpeg_path);
        cmd.args([
            "-rtsp_transport", "tcp",      // Use TCP for RTSP (more reliable)
            "-fflags", "nobuffer",         // Reduce buffering
            "-flags", "low_delay",         // Low delay mode
            "-i", &rtsp_url_clone,          // Input RTSP URL
            "-f", "mpegts",                 // Output format: MPEG-TS
            "-codec:v", "mpeg1video",       // Video codec for jsmpeg
            "-s", "640x480",                // Resolution
            "-b:v", "1000k",                // Video bitrate
            "-bf", "0",                     // No B-frames (lower latency)
            "-q:v", "5",                    // Quality level
            "-r", "25",                     // Frame rate
            "-an",                          // No audio
            "-flush_packets", "1",          // Flush packets immediately
            "pipe:1",                       // Output to stdout
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

        // Hide console window on Windows
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = match cmd.spawn()
        {
            Ok(child) => {
                log::info!("FFmpeg process started with PID: {:?}", child.id());
                child
            }
            Err(e) => {
                log::error!("Failed to start FFmpeg: {}", e);
                return;
            }
        };

        let stdout = match child.stdout.take() {
            Some(out) => out,
            None => {
                log::error!("Failed to get FFmpeg stdout");
                return;
            }
        };

        let stderr = child.stderr.take();

        // Spawn a thread to read stderr
        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                use std::io::BufRead;
                let stderr_reader = std::io::BufReader::new(stderr);
                for line in stderr_reader.lines() {
                    if let Ok(line) = line {
                        log::info!("FFmpeg: {}", line);
                    }
                }
            });
        }

        let mut reader = std::io::BufReader::with_capacity(32768, stdout);
        let mut buffer = [0u8; 32768];
        let mut total_bytes: u64 = 0;
        let mut last_log_bytes: u64 = 0;

        log::info!("Starting to read FFmpeg output...");

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    log::info!("FFmpeg stream ended (EOF). Total bytes: {}", total_bytes);
                    break;
                }
                Ok(n) => {
                    total_bytes += n as u64;

                    // Log every 100KB
                    if total_bytes - last_log_bytes >= 100000 {
                        log::info!("FFmpeg: Streamed {} bytes, receivers: {}", total_bytes, video_tx_clone.receiver_count());
                        last_log_bytes = total_bytes;
                    }

                    // Always send data - receivers will get it when they connect
                    let _ = video_tx_clone.send(buffer[..n].to_vec());
                }
                Err(e) => {
                    log::error!("FFmpeg read error: {}", e);
                    break;
                }
            }
        }

        log::info!("Cleaning up FFmpeg process...");
        let _ = child.kill();
        let _ = child.wait();
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
                            // Custom callback to handle the jsmpeg protocol
                            let callback = |req: &tokio_tungstenite::tungstenite::handshake::server::Request,
                                           mut response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                                // Check if client requested the jsmpeg protocol
                                if let Some(protocols) = req.headers().get("Sec-WebSocket-Protocol") {
                                    if let Ok(protocols_str) = protocols.to_str() {
                                        if protocols_str.contains("jsmpeg") {
                                            // Echo back the jsmpeg protocol
                                            response.headers_mut().insert(
                                                "Sec-WebSocket-Protocol",
                                                "jsmpeg".parse().unwrap(),
                                            );
                                        }
                                    }
                                }
                                Ok(response)
                            };

                            match tokio_tungstenite::accept_hdr_async(stream, callback).await {
                                Ok(ws_stream) => {
                                    log::info!("WebSocket handshake successful");
                                    handle_ws_connection(ws_stream, video_rx).await;
                                }
                                Err(e) => {
                                    log::error!("WebSocket handshake failed: {}", e);
                                }
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

    // Cleanup - abort the blocking FFmpeg task
    ffmpeg_task.abort();

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
