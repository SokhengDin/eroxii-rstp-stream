import { useState, useEffect } from 'react';
import { Plus, Play, Square, X, CheckCircle, XCircle, Info, Maximize, Minimize } from 'lucide-react';
import RTSPPlayer from '../components/RTSPPlayer';

// Detect if running in Tauri
const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;

// API base URL for Node.js server (browser mode)
const API_BASE = 'http://127.0.0.1:3001';

// Promise that resolves with invoke function when Tauri is ready
const tauriInvokePromise = isTauri
  ? import('@tauri-apps/api/core').then((module) => module.invoke)
  : Promise.resolve(null);

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

function CameraDisplay() {
  const [cameras, setCameras] = useState(loadCameras);
  const [currentTab, setCurrentTab] = useState(0);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(null);
  const [status, setStatus] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

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
      const invoke = await tauriInvokePromise;
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
      // Silently fail - no error message shown
    }
  };

  const startStream = async (camera) => {
    try {
      let response;
      const invoke = await tauriInvokePromise;
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
      const invoke = await tauriInvokePromise;
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
    <div className="flex-1 flex flex-col bg-gray-50">
      {/* Header - Hidden in fullscreen */}
      {!isFullscreen && (
        <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Camera Display</h1>
            <p className="text-sm text-gray-500 mt-1">Manage and monitor RTSP camera streams</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Tab Navigation */}
            {totalTabs > 1 && (
              <div className="flex gap-2">
                {Array.from({ length: totalTabs }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentTab(i)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      currentTab === i
                        ? 'bg-blue-500 text-white shadow-sm'
                        : 'text-gray-600 hover:bg-gray-100 border border-gray-200'
                    }`}
                  >
                    Page {i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* FFmpeg Status */}
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${
              ffmpegAvailable
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              {ffmpegAvailable ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              <span className="text-sm font-medium">
                FFmpeg {ffmpegAvailable === null ? '...' : ffmpegAvailable ? 'Ready' : 'Not Found'}
              </span>
            </div>

            {/* Start/Stop All Buttons */}
            {cameras.length > 0 && (
              <>
                <button
                  onClick={startAllOnPage}
                  className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium shadow-sm"
                >
                  <Play className="w-4 h-4" />
                  <span>Start All</span>
                </button>
                <button
                  onClick={stopAllOnPage}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium shadow-sm"
                >
                  <Square className="w-4 h-4" />
                  <span>Stop All</span>
                </button>
              </>
            )}

            {/* Add Camera Button */}
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Add Camera</span>
            </button>

            {/* Fullscreen Toggle Button */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium shadow-sm"
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
        </div>
      )}

      {/* Fullscreen Exit Button - Only visible in fullscreen */}
      {isFullscreen && (
        <button
          onClick={() => setIsFullscreen(false)}
          className="absolute top-4 right-4 z-50 flex items-center gap-2 px-4 py-2 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg hover:bg-gray-900 transition-colors font-medium shadow-lg"
        >
          <Minimize className="w-4 h-4" />
          <span>Exit Fullscreen</span>
        </button>
      )}

      {/* Camera Grid Content */}
      <div className={`flex-1 flex flex-col overflow-hidden ${isFullscreen ? 'p-0' : 'p-6'}`}>
        {/* Status Message - Hidden in fullscreen */}
        {status && !isFullscreen && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg">
            <Info className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{status}</span>
          </div>
        )}

        {/* 2x2 Camera Grid - Fixed 2x2 layout */}
        <div className={`flex-1 grid min-h-0 overflow-hidden ${isFullscreen ? 'gap-0' : 'gap-3'}`} style={{ gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }}>
          {getCurrentPageCameras().map((camera) => (
            <div key={camera.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm flex flex-col min-h-0 max-h-full">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 flex-shrink-0">
                <h3 className="font-semibold text-gray-900 text-sm">{camera.name}</h3>
                <div className="flex items-center gap-2">
                  {!camera.active ? (
                    <button
                      onClick={() => startStream(camera)}
                      disabled={!ffmpegAvailable}
                      className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Start stream"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => stopStream(camera)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Stop stream"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => removeCamera(camera)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove camera"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 bg-gray-900 relative overflow-hidden min-h-0">
                {camera.active && camera.wsUrl ? (
                  <RTSPPlayer
                    wsUrl={camera.wsUrl}
                    width={1920}
                    height={1080}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center px-6">
                      <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-3">
                        <Play className="w-6 h-6 text-gray-500" />
                      </div>
                      <p className="text-gray-400 font-medium mb-1 text-sm">{camera.name}</p>
                      <p className="text-xs text-gray-600 break-all line-clamp-2">{camera.rtspUrl}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Empty slots */}
          {getCurrentPageCameras().length < CAMERAS_PER_PAGE &&
            Array.from({ length: CAMERAS_PER_PAGE - getCurrentPageCameras().length }, (_, i) => (
              <button
                key={`empty-${i}`}
                onClick={() => setShowAddForm(true)}
                className="border-2 border-dashed border-gray-300 rounded-xl bg-white hover:border-blue-400 hover:bg-blue-50 transition-all flex items-center justify-center group min-h-0 max-h-full"
              >
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-blue-100 flex items-center justify-center mx-auto mb-3 transition-colors">
                    <Plus className="w-6 h-6 text-gray-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <p className="text-sm font-medium text-gray-500 group-hover:text-blue-600 transition-colors">Add Camera</p>
                </div>
              </button>
            ))
          }
        </div>
      </div>

      {/* Add Camera Modal */}
      {showAddForm && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowAddForm(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Add New Camera</h2>
              <p className="text-sm text-gray-500 mt-1">Configure your RTSP camera stream</p>
            </div>

            <form onSubmit={addCamera} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Camera Name
                </label>
                <input
                  type="text"
                  value={newCamera.name}
                  onChange={e => setNewCamera(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Front Door"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  RTSP URL
                </label>
                <input
                  type="text"
                  value={newCamera.rtspUrl}
                  onChange={e => setNewCamera(prev => ({ ...prev, rtspUrl: e.target.value }))}
                  placeholder="rtsp://user:pass@192.168.1.100:554/stream"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <p className="text-xs font-medium text-gray-700 mb-2">Common RTSP URL Formats:</p>
                <ul className="text-xs text-gray-600 space-y-1">
                  <li>• Hikvision: rtsp://user:pass@ip:554/Streaming/Channels/101</li>
                  <li>• Dahua: rtsp://user:pass@ip:554/cam/realmonitor?channel=1</li>
                  <li>• Generic: rtsp://user:pass@ip:554/stream</li>
                </ul>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!ffmpegAvailable}
                  className="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-sm"
                >
                  Add Camera
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default CameraDisplay;
