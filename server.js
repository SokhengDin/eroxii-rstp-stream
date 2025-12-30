import { WebSocketServer } from 'ws';
import { spawn, spawnSync } from 'child_process';
import http from 'http';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const streams = new Map();

// Search for ffmpeg.exe recursively in a directory
function searchFFmpegInDir(dir, depth = 0) {
  if (depth > 3) return null; // Limit search depth
  try {
    const items = readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isFile() && item.name.toLowerCase() === 'ffmpeg.exe') {
        return join(dir, item.name);
      }
    }
    for (const item of items) {
      if (item.isDirectory() && !item.name.startsWith('.')) {
        const found = searchFFmpegInDir(join(dir, item.name), depth + 1);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

// Find FFmpeg - check common locations
function findFFmpeg() {
  // If explicitly set via env var, use that
  if (process.env.FFMPEG_PATH) {
    return process.env.FFMPEG_PATH;
  }

  // Check if ffmpeg is in PATH
  const testResult = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', shell: true });
  if (testResult.status === 0) {
    return 'ffmpeg';
  }

  // Common Windows locations
  const windowsPaths = [
    join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    join(homedir(), 'scoop', 'apps', 'ffmpeg', 'current', 'bin', 'ffmpeg.exe'),
  ];

  // Search WinGet packages folder
  const wingetBase = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (existsSync(wingetBase)) {
    try {
      const dirs = readdirSync(wingetBase);
      for (const dir of dirs) {
        if (dir.toLowerCase().includes('ffmpeg')) {
          const found = searchFFmpegInDir(join(wingetBase, dir));
          if (found) {
            windowsPaths.unshift(found);
            break;
          }
        }
      }
    } catch {}
  }

  for (const p of windowsPaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  return 'ffmpeg'; // fallback
}

const FFMPEG_PATH = findFFmpeg();
console.log(`Using FFmpeg: ${FFMPEG_PATH}`);

// Create HTTP server for API endpoints
const httpServer = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Check FFmpeg availability
  if (url.pathname === '/api/check-ffmpeg') {
    const ffmpeg = spawn(FFMPEG_PATH, ['-version']);
    ffmpeg.on('error', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: false }));
    });
    ffmpeg.on('close', (code) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: code === 0 }));
    });
    return;
  }

  // Start stream
  if (url.pathname === '/api/start-stream' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { rtspUrl, wsPort } = JSON.parse(body);

        if (streams.has(wsPort)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            message: `Port ${wsPort} is already in use`
          }));
          return;
        }

        const result = startStream(rtspUrl, wsPort);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // Stop stream
  if (url.pathname === '/api/stop-stream' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { wsPort } = JSON.parse(body);
        const result = stopStream(wsPort);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // Get active streams
  if (url.pathname === '/api/streams') {
    const activeStreams = Array.from(streams.entries()).map(([port, info]) => ({
      port,
      rtsp_url: info.rtspUrl,
      ws_url: `ws://127.0.0.1:${port}`,
      active: true
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(activeStreams));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

function startStream(rtspUrl, wsPort) {
  console.log(`Starting stream: ${rtspUrl} on port ${wsPort}`);

  // Create WebSocket server
  const wss = new WebSocketServer({ port: wsPort });

  // Start FFmpeg
  const ffmpeg = spawn(FFMPEG_PATH, [
    '-rtsp_transport', 'tcp',
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-i', rtspUrl,
    '-f', 'mpegts',
    '-codec:v', 'mpeg1video',
    '-s', '640x480',
    '-b:v', '1000k',
    '-bf', '0',
    '-q:v', '5',
    '-r', '25',
    '-an',
    '-flush_packets', '1',
    'pipe:1'
  ]);

  let totalBytes = 0;

  ffmpeg.stdout.on('data', (data) => {
    totalBytes += data.length;

    // Broadcast to all connected clients
    wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    });
  });

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (!msg.includes('frame=')) { // Filter out progress lines
      console.log(`FFmpeg [${wsPort}]:`, msg.trim());
    }
  });

  ffmpeg.on('close', (code) => {
    console.log(`FFmpeg process exited with code ${code}`);
    stopStream(wsPort);
  });

  ffmpeg.on('error', (err) => {
    console.error('FFmpeg error:', err);
    stopStream(wsPort);
  });

  // Store stream info
  streams.set(wsPort, {
    rtspUrl,
    wss,
    ffmpeg,
    totalBytes: 0
  });

  wss.on('connection', (ws) => {
    console.log(`Client connected to stream on port ${wsPort}`);

    ws.on('close', () => {
      console.log(`Client disconnected from stream on port ${wsPort}`);
    });
  });

  return {
    success: true,
    message: `Stream started on port ${wsPort}`,
    ws_url: `ws://127.0.0.1:${wsPort}`,
    port: wsPort
  };
}

function stopStream(wsPort) {
  const stream = streams.get(wsPort);

  if (!stream) {
    return {
      success: false,
      message: `No stream found on port ${wsPort}`
    };
  }

  // Kill FFmpeg
  if (stream.ffmpeg) {
    stream.ffmpeg.kill('SIGTERM');
  }

  // Close WebSocket server
  if (stream.wss) {
    stream.wss.close();
  }

  streams.delete(wsPort);

  return {
    success: true,
    message: `Stream on port ${wsPort} stopped`,
    port: wsPort
  };
}

// Start HTTP server
const API_PORT = 3001;
httpServer.listen(API_PORT, () => {
  console.log(`\n🎥 RTSP Stream Server`);
  console.log(`   API: http://127.0.0.1:${API_PORT}`);
  console.log(`\n   Endpoints:`);
  console.log(`   - GET  /api/check-ffmpeg`);
  console.log(`   - POST /api/start-stream  { rtspUrl, wsPort }`);
  console.log(`   - POST /api/stop-stream   { wsPort }`);
  console.log(`   - GET  /api/streams\n`);
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  streams.forEach((_, port) => stopStream(port));
  process.exit();
});
