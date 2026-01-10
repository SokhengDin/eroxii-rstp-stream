# RTSP Stream Viewer - Technical Documentation

## Overview

This application streams RTSP video from IP cameras to a web browser using FFmpeg transcoding, WebSocket relay, and JSMpeg decoder.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  IP Camera  │────▶│   FFmpeg    │────▶│  WebSocket  │────▶│   JSMpeg    │
│   (RTSP)    │     │ (transcode) │     │   Server    │     │  (browser)  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

### Data Flow

1. **RTSP Input**: Camera streams H.264/H.265 video over RTSP protocol
2. **FFmpeg Transcode**: Converts to MPEG1 video in MPEG-TS container (JSMpeg compatible)
3. **WebSocket Relay**: Rust backend (Tauri) or Node.js server streams binary data
4. **JSMpeg Decode**: JavaScript decoder renders video to HTML5 canvas

## Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop App | Tauri v2 (Rust backend) |
| Frontend | React 19 |
| Video Decoder | JSMpeg (MPEG1 in JavaScript) |
| Transcoding | FFmpeg |
| WebSocket | tokio-tungstenite (Rust) / ws (Node.js) |
| Storage | localStorage (camera configs) |

## Key Files

```
├── src/
│   ├── App.jsx                 # Main app with camera grid & tabs
│   └── components/
│       └── RTSPPlayer.jsx      # JSMpeg player component
├── src-tauri/
│   └── src/
│       └── lib.rs              # Rust backend (WebSocket + FFmpeg)
├── server.js                   # Node.js server (browser mode)
├── public/
│   └── jsmpeg.min.js           # Patched JSMpeg library
└── index.html                  # Loads JSMpeg globally
```

## FFmpeg Configuration

```bash
ffmpeg \
  -rtsp_transport tcp \       # Use TCP for reliable RTSP
  -fflags nobuffer \          # Reduce buffering
  -flags low_delay \          # Low latency mode
  -i <RTSP_URL> \             # Input stream
  -f mpegts \                 # MPEG-TS container
  -codec:v mpeg1video \       # MPEG1 codec (JSMpeg compatible)
  -s 640x480 \                # Resolution
  -b:v 1000k \                # Video bitrate
  -bf 0 \                     # No B-frames (lower latency)
  -q:v 5 \                    # Quality level
  -r 25 \                     # Frame rate
  -an \                       # No audio
  -flush_packets 1 \          # Flush immediately
  pipe:1                      # Output to stdout
```

## Issues Solved

### 1. WebSocket Protocol Handshake Error

**Problem**: JSMpeg sends `Sec-WebSocket-Protocol: null` header, server rejects connection.

**Solution**: Patched `jsmpeg.min.js` - changed `this.options.protocols||null` to `this.options.protocols` to prevent sending null protocol.

### 2. Port Already in Use (Windows Error 10048)

**Problem**: After stopping stream, port can't be rebound immediately.

**Solution**: Added `socket2` crate with `SO_REUSEADDR` option:
```rust
socket.set_reuse_address(true)?;
```

### 3. FFmpeg Not Found

**Problem**: FFmpeg installed via WinGet not in PATH.

**Solution**: Auto-discovery function searches common Windows locations:
- `FFMPEG_PATH` environment variable
- System PATH
- WinGet Links: `%USERPROFILE%\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe`
- WinGet Packages folder (recursive search)
- Common paths: `C:\ffmpeg\bin\`, `C:\Program Files\ffmpeg\bin\`
- Scoop: `%USERPROFILE%\scoop\apps\ffmpeg\current\bin\`

### 4. Console Window Popup on Windows

**Problem**: FFmpeg spawns visible CMD window.

**Solution**: Added `CREATE_NO_WINDOW` flag:
```rust
#[cfg(target_os = "windows")]
{
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
```

### 5. Race Condition with Tauri API

**Problem**: `invoke` function called before Tauri API loaded.

**Solution**: Changed dynamic import to Promise-based approach:
```javascript
const tauriInvokePromise = isTauri
  ? import('@tauri-apps/api/core').then((m) => m.invoke)
  : Promise.resolve(null);

// Usage
const invoke = await tauriInvokePromise;
```

### 6. Double Player Initialization (React StrictMode)

**Problem**: JSMpeg player created twice in development mode.

**Solution**: Added `initializingRef` guard:
```javascript
const initializingRef = useRef(false);

if (initializingRef.current || playerRef.current) return;
initializingRef.current = true;
```

## Running the App

### Tauri Desktop App (Recommended)
```powershell
npm run tauri dev
```

### Browser Mode (requires Node.js server)
```powershell
# Terminal 1: Start server
npm run server

# Terminal 2: Start frontend
npm run dev

# Or both together:
npm run dev:full
```

### If FFmpeg not detected
```powershell
$env:FFMPEG_PATH="C:\path\to\ffmpeg.exe"; npm run tauri dev
```

## Camera Grid Layout

- 2x2 grid per page (4 cameras)
- Tab navigation for multiple pages
- Auto-assigned WebSocket ports starting at 9900
- Cameras saved to localStorage

## Dependencies

### Rust (Cargo.toml)
```toml
tauri = "2"
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = "0.24"
futures-util = "0.3"
socket2 = "0.5"
dirs = "5"
log = "0.4"
env_logger = "0.11"
```

### Node.js (package.json)
```json
{
  "ws": "^8.x",
  "express": "^4.x",
  "cors": "^2.x"
}
```
