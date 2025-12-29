# RTSP Stream Viewer - Technical Documentation

## Overview

This application streams RTSP (Real-Time Streaming Protocol) video from IP cameras to a web browser using a combination of FFmpeg, WebSocket, and JSMpeg. It's built with Tauri (Rust backend) and React (frontend).

## Architecture

```
┌─────────────┐     RTSP      ┌─────────────┐    MPEG-TS     ┌─────────────┐
│  IP Camera  │ ───────────►  │   FFmpeg    │ ────────────►  │  WebSocket  │
│  (RTSP)     │               │  (Transcode)│    (pipe)      │   Server    │
└─────────────┘               └─────────────┘                └──────┬──────┘
                                                                    │
                                                              Binary Data
                                                                    │
                                                                    ▼
┌─────────────┐    Decoded    ┌─────────────┐   WebSocket   ┌─────────────┐
│   Canvas    │ ◄──────────── │   JSMpeg    │ ◄──────────── │   Browser   │
│  (Display)  │    Frames     │  (Decoder)  │               │  (Client)   │
└─────────────┘               └─────────────┘               └─────────────┘
```

## Why This Approach?

### The Problem
Browsers cannot natively play RTSP streams. RTSP is a protocol designed for media servers and professional equipment, not web browsers.

### Common Solutions and Their Drawbacks

| Solution | Drawback |
|----------|----------|
| VLC Plugin | Deprecated, security issues |
| Flash Player | Dead technology |
| HLS/DASH | High latency (5-30 seconds) |
| WebRTC | Complex setup, requires signaling server |
| Native RTSP in browser | Not supported |

### Our Solution: FFmpeg + MPEG1 + WebSocket

We chose this approach because:

1. **Low Latency** (~50-200ms) - MPEG1 decoding is simple and fast
2. **No Plugins Required** - Pure JavaScript decoder (JSMpeg)
3. **Universal Browser Support** - Works in all modern browsers
4. **Simple Architecture** - No complex signaling or media servers

## How It Works

### Step 1: RTSP to MPEG-TS Conversion (Rust Backend)

The Rust backend spawns an FFmpeg process that:
- Connects to the RTSP stream using TCP transport
- Transcodes the video to MPEG1 format (required by JSMpeg)
- Outputs MPEG-TS (Transport Stream) to stdout

```rust
Command::new("ffmpeg")
    .args([
        "-rtsp_transport", "tcp",      // Use TCP for reliability
        "-fflags", "nobuffer",         // Reduce buffering
        "-flags", "low_delay",         // Low delay mode
        "-i", &rtsp_url,               // Input RTSP URL
        "-f", "mpegts",                // Output format: MPEG-TS
        "-codec:v", "mpeg1video",      // Video codec for JSMpeg
        "-s", "640x480",               // Resolution
        "-b:v", "1000k",               // Video bitrate
        "-bf", "0",                    // No B-frames (lower latency)
        "-q:v", "5",                   // Quality level
        "-r", "25",                    // Frame rate
        "-an",                         // No audio
        "-flush_packets", "1",         // Flush immediately
        "pipe:1",                      // Output to stdout
    ])
```

**Key FFmpeg Parameters:**
- `-rtsp_transport tcp`: More reliable than UDP, handles packet loss
- `-fflags nobuffer` + `-flags low_delay`: Minimizes internal buffering
- `-codec:v mpeg1video`: Required codec for JSMpeg decoder
- `-f mpegts`: Container format that supports streaming
- `-bf 0`: Disables B-frames for lower latency
- `-flush_packets 1`: Sends packets immediately

### Step 2: WebSocket Relay (Rust Backend)

The WebSocket server:
1. Binds to a specified port with `SO_REUSEADDR` for quick restarts
2. Reads FFmpeg's stdout in a blocking thread (`spawn_blocking`)
3. Broadcasts binary data to all connected WebSocket clients

```rust
// Create broadcast channel for multiple clients
let (video_tx, _) = broadcast::channel::<Vec<u8>>(100);

// Read FFmpeg output and broadcast
loop {
    match reader.read(&mut buffer) {
        Ok(n) => {
            video_tx.send(buffer[..n].to_vec());
        }
        // ...
    }
}
```

**Why Broadcast Channel?**
- Supports multiple viewers watching the same stream
- Non-blocking - slow clients don't affect others
- Automatic cleanup when clients disconnect

### Step 3: WebSocket Client (Browser)

JSMpeg connects to the WebSocket server and:
1. Receives binary MPEG-TS data
2. Demuxes the transport stream
3. Decodes MPEG1 video frames
4. Renders to HTML5 Canvas (WebGL or 2D)

```javascript
const player = new JSMpeg.Player(wsUrl, {
    canvas: canvasRef.current,
    autoplay: true,
    audio: false,
    video: true,
    videoBufferSize: 512 * 1024,
    // ...
});
```

## API Reference

### Tauri Commands

#### `start_stream`
Starts streaming from an RTSP source.

**Parameters:**
- `rtsp_url: String` - The RTSP URL (e.g., `rtsp://user:pass@192.168.1.100:554/stream`)
- `ws_port: u16` - WebSocket port for the stream (e.g., `9999`)

**Response:**
```json
{
    "success": true,
    "message": "Stream started on port 9999",
    "ws_url": "ws://127.0.0.1:9999",
    "port": 9999
}
```

#### `stop_stream`
Stops an active stream.

**Parameters:**
- `ws_port: u16` - WebSocket port of the stream to stop

**Response:**
```json
{
    "success": true,
    "message": "Stream on port 9999 stopped",
    "port": 9999
}
```

#### `get_active_streams`
Returns all currently active streams.

**Response:**
```json
[
    {
        "port": 9999,
        "rtsp_url": "rtsp://...",
        "ws_url": "ws://127.0.0.1:9999",
        "active": true
    }
]
```

#### `check_ffmpeg`
Checks if FFmpeg is installed and available.

**Response:**
```json
true  // or false
```

### React Component: RTSPPlayer

```jsx
<RTSPPlayer
    wsUrl="ws://127.0.0.1:9999"
    width={640}
    height={480}
/>
```

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `wsUrl` | `string` | required | WebSocket URL for the stream |
| `width` | `number` | `640` | Canvas width in pixels |
| `height` | `number` | `480` | Canvas height in pixels |

**Status States:**
- `disconnected` - Not connected
- `connecting` - Establishing connection
- `connected` - Receiving frames
- `stalled` - Stream temporarily paused
- `ended` - Stream finished
- `error` - Connection error

## Common RTSP URL Formats

| Camera Brand | URL Format |
|--------------|------------|
| Hikvision | `rtsp://user:pass@ip:554/Streaming/Channels/101` |
| Dahua | `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0` |
| Axis | `rtsp://user:pass@ip:554/axis-media/media.amp` |
| Generic | `rtsp://user:pass@ip:554/stream` |

## Troubleshooting

### WebSocket Connection Fails
- Ensure no other process is using the specified port
- Check if FFmpeg is installed: `ffmpeg -version`
- Verify the RTSP URL is accessible: `ffplay rtsp://...`

### No Video / Black Screen
- Check FFmpeg logs in the terminal for errors
- Verify the RTSP stream is accessible
- Ensure the camera is online and streaming

### High Latency
- Reduce resolution: change `-s 640x480` to `-s 320x240`
- Lower bitrate: change `-b:v 1000k` to `-b:v 500k`
- Ensure network path is stable

### "Sec-WebSocket-Protocol" Error
- The patched JSMpeg in `/public/jsmpeg.min.js` fixes this
- Don't use the CDN version of JSMpeg

## Dependencies

### Backend (Rust/Tauri)
- `tokio` - Async runtime
- `tokio-tungstenite` - WebSocket server
- `futures-util` - Async utilities
- `socket2` - Low-level socket control
- `serde` - Serialization

### Frontend (React)
- `JSMpeg` - MPEG1 video decoder (patched local version)
- `React 19` - UI framework

### System Requirements
- **FFmpeg** must be installed and in PATH
- Minimum FFmpeg version: 4.0+

## Performance Considerations

| Setting | Impact |
|---------|--------|
| Resolution | Higher = more bandwidth, CPU |
| Bitrate | Higher = better quality, more bandwidth |
| Frame Rate | Higher = smoother, more CPU |
| Buffer Size | Larger = more latency tolerance |

**Recommended Settings:**
- Local network: 1000kbps, 640x480, 25fps
- Remote/slow network: 500kbps, 320x240, 15fps

## Security Notes

- RTSP credentials are passed in the URL - use HTTPS/WSS in production
- The WebSocket server only binds to `127.0.0.1` (localhost)
- For external access, use a reverse proxy with authentication
