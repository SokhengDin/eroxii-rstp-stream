/**
 * Production server for ALPR App
 * - Serves static React build files
 * - Provides RTSP streaming API with FFmpeg + WebSocket
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import net from 'net';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 80;
const streams = new Map();

// FFmpeg path
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
console.log(`Using FFmpeg: ${FFMPEG_PATH}`);

// Middleware
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// API: Check FFmpeg
app.get('/api/check-ffmpeg', (req, res) => {
  const ffmpeg = spawn(FFMPEG_PATH, ['-version']);
  ffmpeg.on('error', () => {
    res.json({ available: false });
  });
  ffmpeg.on('close', (code) => {
    res.json({ available: code === 0 });
  });
});

// API: Start stream
app.post('/api/start-stream', (req, res) => {
  const { rtspUrl, wsPort } = req.body;

  if (!rtspUrl || !wsPort) {
    return res.status(400).json({
      success: false,
      message: 'rtspUrl and wsPort are required'
    });
  }

  if (streams.has(wsPort)) {
    return res.json({
      success: false,
      message: `Port ${wsPort} is already in use`
    });
  }

  isPortInUse(wsPort).then((inUse) => {
    if (inUse) {
      return res.json({
        success: false,
        message: `Port ${wsPort} is already in use by another process`
      });
    }
    const result = startStream(rtspUrl, wsPort, req.hostname);
    res.json(result);
  });
});

// API: Stop stream
app.post('/api/stop-stream', (req, res) => {
  const { wsPort } = req.body;
  const result = stopStream(wsPort);
  res.json(result);
});

// API: Get active streams
app.get('/api/streams', (req, res) => {
  const activeStreams = Array.from(streams.entries()).map(([port, info]) => ({
    port,
    rtsp_url: info.rtspUrl,
    ws_url: `ws://${req.hostname}:${port}`,
    active: true
  }));
  res.json(activeStreams);
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