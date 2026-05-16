import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { spawn, spawnSync } from 'child_process';
import http from 'http';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AUTH_USERNAME = process.env.AUTH_USERNAME || process.env.AUTH_USERNAME;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const USERS_FILE = join(__dirname, 'users.json');
const CAMERAS_FILE = join(__dirname, 'cameras.json');

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

// token -> { username, isAdmin }
const sessions = new Map();

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
        const { username, password } = JSON.parse(body);
        if (!username || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Username and password are required' }));
        }
        let isAdmin = false;
        if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
          isAdmin = true;
        } else {
          const users = loadUsers();
          const user = users.find(u => u.username === username && u.password === password);
          if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }));
          }
        }
        const token = randomBytes(32).toString('hex');
        sessions.set(token, { username, isAdmin });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, token, isAdmin }));
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
  const session = sessions.get(token);

  // List users (admin only)
  if (url.pathname === '/api/users' && req.method === 'GET') {
    if (!session.isAdmin) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'Forbidden' })); }
    const users = loadUsers();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(users.map(u => ({ username: u.username }))));
  }

  // Create user (admin only)
  if (url.pathname === '/api/users' && req.method === 'POST') {
    if (!session.isAdmin) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'Forbidden' })); }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        if (!username || !password) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'Username and password are required' })); }
        if (username === AUTH_USERNAME) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'Cannot create user with admin username' })); }
        const users = loadUsers();
        if (users.find(u => u.username === username)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'User already exists' })); }
        users.push({ username, password });
        saveUsers(users);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, message: e.message })); }
    });
    return;
  }

  // Delete user (admin only)
  const deleteUserMatch = url.pathname.match(/^\/api\/users\/(.+)$/);
  if (deleteUserMatch && req.method === 'DELETE') {
    if (!session.isAdmin) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'Forbidden' })); }
    const username = decodeURIComponent(deleteUserMatch[1]);
    const users = loadUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx === -1) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'User not found' })); }
    users.splice(idx, 1);
    saveUsers(users);
    for (const [t, s] of sessions.entries()) { if (s.username === username) sessions.delete(t); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  // Get cameras (all authenticated users)
  if (url.pathname === '/api/cameras' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(loadCameras()));
  }

  // Add camera (admin only)
  if (url.pathname === '/api/cameras' && req.method === 'POST') {
    if (!session.isAdmin) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'Forbidden' })); }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name, rtspUrl } = JSON.parse(body);
        if (!name || !rtspUrl) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'name and rtspUrl are required' })); }
        const cameras = loadCameras();
        const camera = { id: Date.now(), name, rtspUrl, wsPort: 9900 + cameras.length };
        cameras.push(camera);
        saveCameras(cameras);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, camera }));
      } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, message: e.message })); }
    });
    return;
  }

  // Delete camera (admin only)
  const deleteCameraMatch = url.pathname.match(/^\/api\/cameras\/(\d+)$/);
  if (deleteCameraMatch && req.method === 'DELETE') {
    if (!session.isAdmin) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'Forbidden' })); }
    const id = Number(deleteCameraMatch[1]);
    const cameras = loadCameras();
    const idx = cameras.findIndex(c => c.id === id);
    if (idx === -1) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'Camera not found' })); }
    cameras.splice(idx, 1);
    saveCameras(cameras);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
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
