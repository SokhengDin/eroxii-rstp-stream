import { useState, useEffect } from 'react';
import RTSPPlayer from './components/RTSPPlayer';
import './App.css';

// Detect if running in Tauri
const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;

// API base URL for Node.js server (browser mode)
const API_BASE = 'http://127.0.0.1:3001';

// Dynamic import for Tauri API (only when running in Tauri)
let invoke = null;
if (isTauri) {
  import('@tauri-apps/api/core').then((module) => {
    invoke = module.invoke;
  });
}

// Cameras per page (2x2 grid)
const CAMERAS_PER_PAGE = 4;

// Starting port for WebSocket connections
const BASE_WS_PORT = 9900;

// Load cameras from localStorage
const loadCameras = () => {
  try {
    const saved = localStorage.getItem('rtsp-cameras');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

// Save cameras to localStorage
const saveCameras = (cameras) => {
  localStorage.setItem('rtsp-cameras', JSON.stringify(cameras));
};

// Get next available port
const getNextPort = (cameras) => {
  if (cameras.length === 0) return BASE_WS_PORT;
  const usedPorts = cameras.map(c => c.wsPort);
  let port = BASE_WS_PORT;
  while (usedPorts.includes(port)) {
    port++;
  }
  return port;
};

function App() {
  const [cameras, setCameras] = useState(loadCameras);
  const [currentTab, setCurrentTab] = useState(0);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(null);
  const [status, setStatus] = useState('');

  // Form state for adding new camera
  const [newCamera, setNewCamera] = useState({
    name: '',
    rtspUrl: '',
  });
  const [showAddForm, setShowAddForm] = useState(false);

  // Calculate total tabs needed
  const totalTabs = Math.max(1, Math.ceil(cameras.length / CAMERAS_PER_PAGE));

  // Get cameras for current tab
  const getCurrentPageCameras = () => {
    const start = currentTab * CAMERAS_PER_PAGE;
    const end = start + CAMERAS_PER_PAGE;
    return cameras.slice(start, end);
  };

  // Check FFmpeg on mount
  useEffect(() => {
    checkFfmpeg();
  }, []);

  // Save cameras whenever they change
  useEffect(() => {
    saveCameras(cameras);
  }, [cameras]);

  const checkFfmpeg = async () => {
    try {
      if (isTauri && invoke) {
        const available = await invoke('check_ffmpeg');
        setFfmpegAvailable(available);
      } else {
        const res = await fetch(`${API_BASE}/api/check-ffmpeg`);
        const data = await res.json();
        setFfmpegAvailable(data.available);
      }
    } catch (err) {
      setFfmpegAvailable(false);
      setStatus(isTauri ? `Error: ${err}` : 'Cannot connect to server. Run: npm run server');
    }
  };

  const startStream = async (camera) => {
    try {
      let response;
      if (isTauri && invoke) {
        response = await invoke('start_stream', {
          rtspUrl: camera.rtspUrl,
          wsPort: camera.wsPort,
        });
      } else {
        const res = await fetch(`${API_BASE}/api/start-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rtspUrl: camera.rtspUrl, wsPort: camera.wsPort }),
        });
        response = await res.json();
      }

      if (response?.success) {
        // Update camera with active stream info
        setCameras(prev => prev.map(c =>
          c.id === camera.id
            ? { ...c, active: true, wsUrl: response.ws_url }
            : c
        ));
        setStatus(`Started: ${camera.name}`);
      } else {
        setStatus(`Error: ${response?.message || 'Failed to start stream'}`);
      }
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  };

  const stopStream = async (camera) => {
    try {
      if (isTauri && invoke) {
        await invoke('stop_stream', { wsPort: camera.wsPort });
      } else {
        await fetch(`${API_BASE}/api/stop-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wsPort: camera.wsPort }),
        });
      }

      setCameras(prev => prev.map(c =>
        c.id === camera.id ? { ...c, active: false, wsUrl: null } : c
      ));
      setStatus(`Stopped: ${camera.name}`);
    } catch (err) {
      setStatus(`Error stopping: ${err}`);
    }
  };

  const addCamera = (e) => {
    e.preventDefault();

    if (!newCamera.name || !newCamera.rtspUrl) {
      setStatus('Please fill in camera name and RTSP URL');
      return;
    }

    // Auto-assign next available port
    const wsPort = getNextPort(cameras);

    const camera = {
      id: Date.now(),
      name: newCamera.name,
      rtspUrl: newCamera.rtspUrl,
      wsPort: wsPort,
      active: false,
      wsUrl: null,
    };

    setCameras(prev => [...prev, camera]);
    setNewCamera({ name: '', rtspUrl: '' });
    setShowAddForm(false);
    setStatus(`Added camera: ${camera.name}`);
  };

  const removeCamera = async (camera) => {
    if (camera.active) {
      await stopStream(camera);
    }
    setCameras(prev => prev.filter(c => c.id !== camera.id));
    setStatus(`Removed: ${camera.name}`);
  };

  const startAllOnPage = async () => {
    const pageCameras = getCurrentPageCameras();
    for (const camera of pageCameras) {
      if (!camera.active) {
        await startStream(camera);
      }
    }
  };

  const stopAllOnPage = async () => {
    const pageCameras = getCurrentPageCameras();
    for (const camera of pageCameras) {
      if (camera.active) {
        await stopStream(camera);
      }
    }
  };

  return (
    <main className="app-container">
      {/* Header */}
      <header className="app-header">
        <h1>RTSP Stream Viewer</h1>
        <div className="header-controls">
          <span className={`ffmpeg-badge ${ffmpegAvailable ? 'available' : 'unavailable'}`}>
            FFmpeg: {ffmpegAvailable === null ? '...' : ffmpegAvailable ? '✓' : '✗'}
          </span>
          <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
            + Add Camera
          </button>
        </div>
      </header>

      {/* Status bar */}
      {status && <div className="status-bar">{status}</div>}

      {/* Tab Navigation */}
      {totalTabs > 1 && (
        <div className="tab-navigation">
          {Array.from({ length: totalTabs }, (_, i) => (
            <button
              key={i}
              className={`tab-btn ${currentTab === i ? 'active' : ''}`}
              onClick={() => setCurrentTab(i)}
            >
              Page {i + 1}
              <span className="tab-camera-count">
                ({Math.min(CAMERAS_PER_PAGE, cameras.length - i * CAMERAS_PER_PAGE)} cameras)
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Page Controls */}
      {cameras.length > 0 && (
        <div className="page-controls">
          <button className="btn btn-success" onClick={startAllOnPage}>
            ▶ Start All
          </button>
          <button className="btn btn-danger" onClick={stopAllOnPage}>
            ■ Stop All
          </button>
        </div>
      )}

      {/* 2x2 Camera Grid */}
      <div className="camera-grid">
        {getCurrentPageCameras().map((camera) => (
          <div key={camera.id} className="camera-cell">
            <div className="camera-header">
              <span className="camera-name">{camera.name}</span>
              <div className="camera-controls">
                {!camera.active ? (
                  <button
                    className="btn btn-sm btn-success"
                    onClick={() => startStream(camera)}
                    disabled={!ffmpegAvailable}
                  >
                    ▶
                  </button>
                ) : (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => stopStream(camera)}
                  >
                    ■
                  </button>
                )}
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => removeCamera(camera)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="camera-view">
              {camera.active && camera.wsUrl ? (
                <RTSPPlayer
                  wsUrl={camera.wsUrl}
                  width={320}
                  height={240}
                />
              ) : (
                <div className="camera-placeholder">
                  <div className="placeholder-text">
                    <p>{camera.name}</p>
                    <small className="rtsp-url">{camera.rtspUrl}</small>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Empty slots */}
        {getCurrentPageCameras().length < CAMERAS_PER_PAGE &&
          Array.from({ length: CAMERAS_PER_PAGE - getCurrentPageCameras().length }, (_, i) => (
            <div key={`empty-${i}`} className="camera-cell empty">
              <div className="camera-placeholder">
                <button
                  className="btn btn-outline"
                  onClick={() => setShowAddForm(true)}
                >
                  + Add Camera
                </button>
              </div>
            </div>
          ))
        }
      </div>

      {/* Add Camera Modal */}
      {showAddForm && (
        <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Add Camera</h2>
            <form onSubmit={addCamera}>
              <div className="form-group">
                <label>Camera Name</label>
                <input
                  type="text"
                  value={newCamera.name}
                  onChange={e => setNewCamera(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Front Door"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>RTSP URL</label>
                <input
                  type="text"
                  value={newCamera.rtspUrl}
                  onChange={e => setNewCamera(prev => ({ ...prev, rtspUrl: e.target.value }))}
                  placeholder="rtsp://user:pass@192.168.1.100:554/stream"
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={!ffmpegAvailable}>
                  Add Camera
                </button>
              </div>
            </form>

            <div className="url-hints">
              <p><strong>Common RTSP URL formats:</strong></p>
              <ul>
                <li>Hikvision: rtsp://user:pass@ip:554/Streaming/Channels/101</li>
                <li>Dahua: rtsp://user:pass@ip:554/cam/realmonitor?channel=1</li>
                <li>Generic: rtsp://user:pass@ip:554/stream</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
