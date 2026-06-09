/**
 * Production server for ALPR App
 * - Serves static React build files
 * - Provides RTSP streaming API with FFmpeg + WebSocket
 * - All WebSocket streams routed through the main HTTP server on /ws/stream/:id
 *   so they work through Cloudflare Tunnel without extra port forwarding
 */

import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { randomBytes } from 'crypto';
import { request as httpRequest } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 80;
const streams = new Map(); // streamId -> { rtspUrl, ffmpeg, wss }

const AUTH_USERNAME = process.env.AUTH_USERNAME || process.env.AUTH_USERNAME;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const GO2RTC_URL = process.env.GO2RTC_URL || 'http://127.0.0.1:1984';
const USERS_FILE = join(__dirname, 'users.json');
const CAMERAS_FILE = join(__dirname, 'cameras.json');

// Load persisted users from disk
function loadUsers() {
  try {
    if (existsSync(USERS_FILE)) return JSON.parse(readFileSync(USERS_FILE, 'utf8'));
  } catch {}
  return [];
}

function saveUsers(users) {
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadCameras() {
  try {
    if (existsSync(CAMERAS_FILE)) return JSON.parse(readFileSync(CAMERAS_FILE, 'utf8'));
  } catch {}
  return [];
}

function saveCameras(cameras) {
  writeFileSync(CAMERAS_FILE, JSON.stringify(cameras, null, 2));
}

// In-memory session tokens: token -> { username, isAdmin }
const sessions = new Map();

function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  req.session = sessions.get(token);
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.session.isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });
    next();
  });
}

// FFmpeg path
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
console.log(`Using FFmpeg: ${FFMPEG_PATH}`);

// Middleware
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// API: Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  let isAdmin = false;

  if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
    isAdmin = true;
  } else {
    const users = loadUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const token = randomBytes(32).toString('hex');
  sessions.set(token, { username, isAdmin });
  res.json({ success: true, token, isAdmin });
});

// API: List users (admin only)
app.get('/api/users', requireAdmin, (req, res) => {
  const users = loadUsers();
  res.json(users.map(u => ({ username: u.username })));
});

// API: Create user (admin only)
app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }
  if (username === AUTH_USERNAME) {
    return res.status(400).json({ success: false, message: 'Cannot create user with admin username' });
  }
  const users = loadUsers();
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ success: false, message: 'User already exists' });
  }
  users.push({ username, password });
  saveUsers(users);
  res.json({ success: true });
});

// API: Delete user (admin only)
app.delete('/api/users/:username', requireAdmin, (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const users = loadUsers();
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return res.status(404).json({ success: false, message: 'User not found' });
  users.splice(idx, 1);
  saveUsers(users);
  // Invalidate any active sessions for this user
  for (const [token, session] of sessions.entries()) {
    if (session.username === username) sessions.delete(token);
  }
  res.json({ success: true });
});

// API: Get cameras (all authenticated users)
app.get('/api/cameras', requireAuth, (req, res) => {
  res.json(loadCameras());
});

// API: Add camera (admin only)
app.post('/api/cameras', requireAdmin, (req, res) => {
  const { name, rtspUrl } = req.body;
  if (!name || !rtspUrl) {
    return res.status(400).json({ success: false, message: 'name and rtspUrl are required' });
  }
  const cameras = loadCameras();
  const camera = { id: Date.now(), name, rtspUrl, wsPort: 9900 + cameras.length };
  cameras.push(camera);
  saveCameras(cameras);
  res.json({ success: true, camera });
});

// API: Delete camera (admin only)
app.delete('/api/cameras/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const cameras = loadCameras();
  const idx = cameras.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Camera not found' });
  cameras.splice(idx, 1);
  saveCameras(cameras);
  res.json({ success: true });
});

// API: Check FFmpeg
app.get('/api/check-ffmpeg', requireAuth, (req, res) => {
  const ffmpeg = spawn(FFMPEG_PATH, ['-version']);
  ffmpeg.on('error', () => res.json({ available: false }));
  ffmpeg.on('close', (code) => res.json({ available: code === 0 }));
});

// API: Start stream — returns a path-based ws_url routed through main HTTP server
app.post('/api/start-stream', requireAuth, (req, res) => {
  const { rtspUrl, wsPort } = req.body;
  if (!rtspUrl || !wsPort) {
    return res.status(400).json({ success: false, message: 'rtspUrl and wsPort are required' });
  }

  const streamId = String(wsPort);

  if (streams.has(streamId)) {
    return res.json({
      success: true,
      message: 'Stream already running',
      ws_url: `/ws/stream/${streamId}`,
      port: wsPort,
    });
  }

  const result = startStream(rtspUrl, streamId);
  res.json(result);
});

// API: Stop stream
app.post('/api/stop-stream', requireAuth, (req, res) => {
  const { wsPort } = req.body;
  const result = stopStream(String(wsPort));
  res.json(result);
});

// API: Get active streams
app.get('/api/streams', requireAuth, (req, res) => {
  const activeStreams = Array.from(streams.entries()).map(([id, info]) => ({
    port: id,
    rtsp_url: info.rtspUrl,
    ws_url: `/ws/stream/${id}`,
    active: true,
  }));
  res.json(activeStreams);
});

// Proxy: go2rtc API — authenticated, proxied over main port so Cloudflare can reach it
app.use('/api/go2rtc', requireAuth, (req, res) => {
  const target = new URL(GO2RTC_URL);
  const options = {
    hostname: target.hostname,
    port: target.port || 1984,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  };
  const proxy = httpRequest(options, (upstream) => {
    res.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on('error', () => res.status(502).json({ success: false, message: 'go2rtc unavailable' }));
  req.pipe(proxy);
});

// Serve static files (React app)
app.use(express.static(join(__dirname, 'dist')));

// SPA fallback
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// Create HTTP server so we can handle WebSocket upgrades
const server = createServer(app);

// Single WebSocket server — routes upgrades by path /ws/stream/:id
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const match = req.url?.match(/^\/ws\/stream\/([^/?]+)/);
  if (!match) {
    socket.destroy();
    return;
  }

  const streamId = match[1];
  const stream = streams.get(streamId);
  if (!stream) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    stream.clients.add(ws);
    ws.on('close', () => stream.clients.delete(ws));
  });
});

function startStream(rtspUrl, streamId) {
  console.log(`Starting stream: ${rtspUrl} [id=${streamId}]`);

  try {
    const clients = new Set();

    const ffmpeg = spawn(FFMPEG_PATH, [
      '-rtsp_transport', 'tcp',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-i', rtspUrl,
      '-f', 'mpegts',
      '-codec:v', 'mpeg1video',
      '-s', process.env.STREAM_RESOLUTION || '640x480',
      '-b:v', process.env.STREAM_BITRATE || '1000k',
      '-bf', '0',
      '-q:v', process.env.STREAM_QUALITY || '5',
      '-r', process.env.STREAM_FPS || '25',
      '-threads', process.env.STREAM_THREADS || '2',
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
        console.log(`FFmpeg [${streamId}]:`, msg.trim());
      }
    });

    ffmpeg.on('close', (code) => {
      console.log(`FFmpeg [${streamId}] exited with code ${code}`);
      cleanupStream(streamId);
    });

    ffmpeg.on('error', (err) => {
      console.error(`FFmpeg error [${streamId}]:`, err);
      cleanupStream(streamId);
    });

    streams.set(streamId, { rtspUrl, ffmpeg, clients });

    return {
      success: true,
      message: `Stream started`,
      ws_url: `/ws/stream/${streamId}`,
      port: streamId,
    };
  } catch (err) {
    console.error(`Failed to start stream [${streamId}]:`, err);
    return { success: false, message: err.message };
  }
}

function cleanupStream(streamId) {
  streams.delete(streamId);
}

function stopStream(streamId) {
  const stream = streams.get(streamId);
  if (!stream) {
    return { success: false, message: `No stream found [${streamId}]` };
  }
  try { stream.ffmpeg.kill('SIGTERM'); } catch {}
  stream.clients.forEach((ws) => { try { ws.close(); } catch {} });
  streams.delete(streamId);
  return { success: true, message: `Stream stopped`, port: streamId };
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n ALPR App with RTSP Streaming`);
  console.log(`   Web App: http://0.0.0.0:${PORT}`);
  console.log(`   WebSocket streams: ws://host/ws/stream/<id>`);
  console.log(`\n   API Endpoints:`);
  console.log(`   - GET  /api/check-ffmpeg`);
  console.log(`   - POST /api/start-stream  { rtspUrl, wsPort }`);
  console.log(`   - POST /api/stop-stream   { wsPort }`);
  console.log(`   - GET  /api/streams\n`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  streams.forEach((_, id) => stopStream(id));
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down...');
  streams.forEach((_, id) => stopStream(id));
  process.exit();
});
