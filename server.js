import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { spawn, spawnSync } from 'child_process';
import http from 'http';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

const AUTH_PHONE = process.env.AUTH_PHONE;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const sessions = new Set();

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

// Single WebSocket server — routes upgrades by path /ws/stream/:port
const sharedWss = new WebSocketServer({ noServer: true });

// Create HTTP server for API endpoints
const httpServer = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Login — public
  if (url.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { phone, password } = JSON.parse(body);
        if (!phone || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Phone and password are required' }));
        }
        if (phone !== AUTH_PHONE || password !== AUTH_PASSWORD) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }));
        }
        const token = randomBytes(32).toString('hex');
        sessions.add(token);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, token }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // Verify session token for all other /api routes
  const token = req.headers['x-session-token'];
  if (!token || !sessions.has(token)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
  }

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
          // Already running — return the path-based url
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: `Stream already running`,
            ws_url: `/ws/stream/${wsPort}`,
            port: wsPort,
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
      ws_url: `/ws/stream/${port}`,
      active: true,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(activeStreams));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

function startStream(rtspUrl, wsPort) {
  console.log(`Starting stream: ${rtspUrl} [id=${wsPort}]`);

  const clients = new Set();

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
    'pipe:1',
  ]);

  ffmpeg.stdout.on('data', (data) => {
    clients.forEach((ws) => {
      if (ws.readyState === 1) ws.send(data);
    });
  });

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (!msg.includes('frame=')) {
      console.log(`FFmpeg [${wsPort}]:`, msg.trim());
    }
  });

  ffmpeg.on('close', (code) => {
    console.log(`FFmpeg [${wsPort}] exited with code ${code}`);
    streams.delete(wsPort);
  });

  ffmpeg.on('error', (err) => {
    console.error(`FFmpeg error [${wsPort}]:`, err);
    streams.delete(wsPort);
  });

  streams.set(wsPort, { rtspUrl, ffmpeg, clients });

  return {
    success: true,
    message: `Stream started`,
    ws_url: `/ws/stream/${wsPort}`,
    port: wsPort,
  };
}

function stopStream(wsPort) {
  const stream = streams.get(wsPort);
  if (!stream) {
    return { success: false, message: `No stream found [${wsPort}]` };
  }
  try { stream.ffmpeg.kill('SIGTERM'); } catch {}
  stream.clients.forEach((ws) => { try { ws.close(); } catch {} });
  streams.delete(wsPort);
  return { success: true, message: `Stream stopped`, port: wsPort };
}

// Route WebSocket upgrades by path /ws/stream/:port
httpServer.on('upgrade', (req, socket, head) => {
  const match = req.url?.match(/^\/ws\/stream\/(\d+)/);
  if (!match) { socket.destroy(); return; }
  const wsPort = Number(match[1]);
  const stream = streams.get(wsPort);
  if (!stream) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
  sharedWss.handleUpgrade(req, socket, head, (ws) => {
    stream.clients.add(ws);
    ws.on('close', () => stream.clients.delete(ws));
  });
});

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
