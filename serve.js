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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 80;
const streams = new Map(); // streamId -> { rtspUrl, ffmpeg, wss }

const AUTH_PHONE = process.env.AUTH_PHONE;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const GO2RTC_URL = process.env.GO2RTC_URL || 'http://127.0.0.1:1984';

// In-memory session tokens
const sessions = new Set();

function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
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
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ success: false, message: 'Phone and password are required' });
  }
  if (phone !== AUTH_PHONE || password !== AUTH_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  const token = randomBytes(32).toString('hex');
  sessions.add(token);
  res.json({ success: true, token });
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
