/**
 * Production server for ALPR App
 * - Serves static React build files
 * - Provides RTSP streaming API with FFmpeg + WebSocket
 */

import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.secret' });
import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import net from 'net';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { request as httpRequest } from 'http';

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

const BASE_WS_PORT = 9900;
const MAX_WS_PORT = 9910;

async function findFreePort(requestedPort) {
  // Try requested port first
  if (!(await isPortInUse(requestedPort)) && !streams.has(requestedPort)) {
    return requestedPort;
  }
  // Scan range for a free port
  for (let port = BASE_WS_PORT; port <= MAX_WS_PORT; port++) {
    if (!streams.has(port) && !(await isPortInUse(port))) {
      return port;
    }
  }
  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 80;
const streams = new Map();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_production';
const AUTH_PHONE = process.env.AUTH_PHONE;
const AUTH_PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH;
const GO2RTC_URL = process.env.GO2RTC_URL || 'http://127.0.0.1:1984';

if (!AUTH_PHONE || !AUTH_PASSWORD_HASH) {
  console.warn('WARNING: AUTH_PHONE or AUTH_PASSWORD_HASH not set in .env — login will be disabled');
}

function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

// FFmpeg path
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
console.log(`Using FFmpeg: ${FFMPEG_PATH}`);

// Middleware
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// API: Login
app.post('/api/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ success: false, message: 'Phone and password are required' });
  }
  if (!AUTH_PHONE || !AUTH_PASSWORD_HASH) {
    return res.status(503).json({ success: false, message: 'Auth not configured on server' });
  }
  if (phone !== AUTH_PHONE) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  const valid = await bcrypt.compare(password, AUTH_PASSWORD_HASH);
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  const token = jwt.sign({ phone }, JWT_SECRET);
  res.json({ success: true, token });
});

// API: Check FFmpeg
app.get('/api/check-ffmpeg', requireAuth, (req, res) => {
  const ffmpeg = spawn(FFMPEG_PATH, ['-version']);
  ffmpeg.on('error', () => {
    res.json({ available: false });
  });
  ffmpeg.on('close', (code) => {
    res.json({ available: code === 0 });
  });
});

// API: Start stream
app.post('/api/start-stream', requireAuth, (req, res) => {
  const { rtspUrl, wsPort } = req.body;

  if (!rtspUrl || !wsPort) {
    return res.status(400).json({
      success: false,
      message: 'rtspUrl and wsPort are required'
    });
  }

  findFreePort(wsPort).then((freePort) => {
    if (freePort === null) {
      return res.json({
        success: false,
        message: `No free ports available in range ${BASE_WS_PORT}-${MAX_WS_PORT}`
      });
    }
    const result = startStream(rtspUrl, freePort, req.hostname);
    res.json(result);
  });
});

// API: Stop stream
app.post('/api/stop-stream', requireAuth, (req, res) => {
  const { wsPort } = req.body;
  const result = stopStream(wsPort);
  res.json(result);
});

// API: Get active streams
app.get('/api/streams', requireAuth, (req, res) => {
  const activeStreams = Array.from(streams.entries()).map(([port, info]) => ({
    port,
    rtsp_url: info.rtspUrl,
    ws_url: `ws://${req.hostname}:${port}`,
    active: true
  }));
  res.json(activeStreams);
});

// Proxy: go2rtc API — authenticated, proxied over port 80 so Cloudflare can reach it
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

// SPA fallback - serve index.html for all non-API routes
app.use((req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

function startStream(rtspUrl, wsPort, hostname) {
  console.log(`Starting stream: ${rtspUrl} on port ${wsPort}`);

  try {
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

    ffmpeg.stdout.on('data', (data) => {
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(data);
        }
      });
    });

    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      if (!msg.includes('frame=')) {
        console.log(`FFmpeg [${wsPort}]:`, msg.trim());
      }
    });

    ffmpeg.on('close', (code) => {
      console.log(`FFmpeg process on port ${wsPort} exited with code ${code}`);
      cleanupStream(wsPort);
    });

    ffmpeg.on('error', (err) => {
      console.error(`FFmpeg error on port ${wsPort}:`, err);
      cleanupStream(wsPort);
    });

    streams.set(wsPort, { rtspUrl, wss, ffmpeg });

    wss.on('connection', (ws) => {
      console.log(`Client connected to stream on port ${wsPort}`);
      ws.on('close', () => {
        console.log(`Client disconnected from stream on port ${wsPort}`);
      });
    });

    wss.on('error', (err) => {
      console.error(`WebSocket server error on port ${wsPort}:`, err);
    });

    return {
      success: true,
      message: `Stream started on port ${wsPort}`,
      ws_url: `ws://${hostname || '127.0.0.1'}:${wsPort}`,
      port: wsPort
    };
  } catch (err) {
    console.error(`Failed to start stream on port ${wsPort}:`, err);
    return {
      success: false,
      message: err.message
    };
  }
}

function cleanupStream(wsPort) {
  const stream = streams.get(wsPort);
  if (stream) {
    if (stream.wss) {
      try { stream.wss.close(); } catch (e) { /* ignore */ }
    }
    streams.delete(wsPort);
  }
}

function stopStream(wsPort) {
  const stream = streams.get(wsPort);

  if (!stream) {
    return { success: false, message: `No stream found on port ${wsPort}` };
  }

  if (stream.ffmpeg) {
    try { stream.ffmpeg.kill('SIGTERM'); } catch (e) { /* ignore */ }
  }
  if (stream.wss) {
    try { stream.wss.close(); } catch (e) { /* ignore */ }
  }
  streams.delete(wsPort);

  return { success: true, message: `Stream on port ${wsPort} stopped`, port: wsPort };
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎥 ALPR App with RTSP Streaming`);
  console.log(`   Web App: http://0.0.0.0:${PORT}`);
  console.log(`\n   Streaming API Endpoints:`);
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

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down...');
  streams.forEach((_, port) => stopStream(port));
  process.exit();
});