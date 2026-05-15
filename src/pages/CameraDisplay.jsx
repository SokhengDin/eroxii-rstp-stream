import { useState, useEffect } from 'react';
import { Plus, Play, Square, X, CheckCircle, XCircle, Maximize, Minimize, Radio } from 'lucide-react';
import RTSPPlayer from '../components/RTSPPlayer';
import WebRTCPlayer from '../components/WebRTCPlayer';
import { apiFetch } from '../utils/api';

// Detect if running in Tauri
const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;

// API base URL: empty string = same origin (Docker/web via serve.js), or direct node port for Tauri/dev
const API_BASE = isTauri ? 'http://127.0.0.1:3001' : '';

// Promise that resolves with invoke function when Tauri is ready
const tauriInvokePromise = isTauri
  ? import('@tauri-apps/api/core').then((module) => module.invoke)
  : Promise.resolve(null);

// Max cameras per page
const CAMERAS_PER_PAGE = 9;

// Dynamic grid columns based on camera count
const getGridCols = (count) => {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count <= 4) return 2;
  return 3;
};

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mode, setMode] = useState(() => localStorage.getItem('stream-mode') || 'jsmpeg');

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

  // Save mode to localStorage
  useEffect(() => {
    localStorage.setItem('stream-mode', mode);
  }, [mode]);

  // Check FFmpeg on mount
  useEffect(() => {
    checkFfmpeg();
  }, []);

  // Save cameras whenever they change
  useEffect(() => {
    saveCameras(cameras);
  }, [cameras]);

  // Register / update all cameras in go2rtc when switching to webrtc mode
  useEffect(() => {
    if (mode === 'webrtc') {
      cameras.forEach(registerGo2rtcStream);
    }
  }, [mode]);

  const go2rtcStreamName = (camera) => `cam_${camera.id}`;

  const registerGo2rtcStream = async (camera) => {
    try {
      await apiFetch(`/api/go2rtc/api/streams?name=${encodeURIComponent(go2rtcStreamName(camera))}&src=${encodeURIComponent(camera.rtspUrl)}`, {
        method: 'PUT',
      });
    } catch {
      // go2rtc might not be running in local dev — silently ignore
    }
  };

  const unregisterGo2rtcStream = async (camera) => {
    try {
      await apiFetch(`/api/go2rtc/api/streams?name=${encodeURIComponent(go2rtcStreamName(camera))}`, {
        method: 'DELETE',
      });
    } catch {}
  };

  const checkFfmpeg = async () => {
    try {
      const invoke = await tauriInvokePromise;
      if (isTauri && invoke) {
        const available = await invoke('check_ffmpeg');
        setFfmpegAvailable(available);
      } else {
        const res = await apiFetch(`${API_BASE}/api/check-ffmpeg`);
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
        const res = await apiFetch(`${API_BASE}/api/start-stream`, {
          method: 'POST',
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
      } else {
      }
    } catch (err) {
    }
  };

  const stopStream = async (camera) => {
    try {
      const invoke = await tauriInvokePromise;
      if (isTauri && invoke) {
        await invoke('stop_stream', { wsPort: camera.wsPort });
      } else {
        await apiFetch(`${API_BASE}/api/stop-stream`, {
          method: 'POST',
          body: JSON.stringify({ wsPort: camera.wsPort }),
        });
      }

      setCameras(prev => prev.map(c =>
        c.id === camera.id ? { ...c, active: false, wsUrl: null } : c
      ));
    } catch (err) {
    }
  };

  const addCamera = (e) => {
    e.preventDefault();

    if (!newCamera.name || !newCamera.rtspUrl) {
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
    if (mode === 'webrtc') registerGo2rtcStream(camera);
  };

  const removeCamera = async (camera) => {
    if (camera.active) await stopStream(camera);
    await unregisterGo2rtcStream(camera);
    setCameras(prev => prev.filter(c => c.id !== camera.id));
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
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            {/* Title — hide subtitle on small screens */}
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">Camera Display</h1>
              <p className="hidden sm:block text-sm text-gray-500 mt-0.5">Manage and monitor RTSP camera streams</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Mode Toggle */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 border border-gray-200">
                <button
                  onClick={() => setMode('jsmpeg')}
                  title="JSMpeg mode"
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                    mode === 'jsmpeg'
                      ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Play className="w-3 h-3" />
                  <span className="hidden sm:inline">JSMpeg</span>
                </button>
                <button
                  onClick={() => setMode('webrtc')}
                  title="WebRTC mode"
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                    mode === 'webrtc'
                      ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Radio className="w-3 h-3" />
                  <span className="hidden sm:inline">WebRTC</span>
                </button>
              </div>

              {/* FFmpeg status — icon only on small, with text on large */}
              {mode === 'jsmpeg' && (
                <div className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium ${
                  ffmpegAvailable
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  {ffmpegAvailable ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{ffmpegAvailable === null ? '...' : ffmpegAvailable ? 'Ready' : 'Not Found'}</span>
                </div>
              )}

              {/* Start / Stop All */}
              {cameras.length > 0 && (
                <>
                  <button
                    onClick={mode === 'jsmpeg' ? startAllOnPage : () => setCameras(prev => prev.map(c => ({ ...c, webrtcActive: true })))}
                    title="Start All"
                    className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={mode === 'jsmpeg' ? stopAllOnPage : () => setCameras(prev => prev.map(c => ({ ...c, webrtcActive: false })))}
                    title="Stop All"
                    className="p-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                  >
                    <Square className="w-3.5 h-3.5" />
                  </button>
                </>
              )}

              {/* Add Camera — icon only on small */}
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1.5 px-2 sm:px-4 py-1.5 sm:py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium shadow-sm text-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Add Camera</span>
              </button>

              {/* Fullscreen */}
              <button
                onClick={() => setIsFullscreen(true)}
                title="Fullscreen"
                className="p-1.5 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                <Maximize className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Row 2: Tab pagination — only when needed */}
          {totalTabs > 1 && (
            <div className="flex gap-2 mt-3">
              {Array.from({ length: totalTabs }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentTab(i)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
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

        {/* Dynamic Camera Grid */}
        <div className={`flex-1 grid min-h-0 overflow-hidden ${isFullscreen ? 'gap-0' : 'gap-3'}`} style={{ gridTemplateColumns: `repeat(${getGridCols(getCurrentPageCameras().length)}, 1fr)`, gridAutoRows: '1fr' }}>
          {getCurrentPageCameras().map((camera) => (
            <div key={camera.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm flex flex-col min-h-0 min-w-0">
              {/* Card header */}
              <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 flex-shrink-0 min-w-0">
                <h3 className="font-medium text-gray-900 text-xs truncate flex-1 min-w-0">{camera.name}</h3>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {mode === 'jsmpeg' ? (
                    !camera.active ? (
                      <button
                        onClick={() => startStream(camera)}
                        disabled={!ffmpegAvailable}
                        className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Start"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    ) : (
                      <button
                        onClick={() => stopStream(camera)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Stop"
                      >
                        <Square className="w-3 h-3" />
                      </button>
                    )
                  ) : (
                    !camera.webrtcActive ? (
                      <button
                        onClick={() => setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, webrtcActive: true } : c))}
                        className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                        title="Connect"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    ) : (
                      <button
                        onClick={() => setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, webrtcActive: false } : c))}
                        className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Disconnect"
                      >
                        <Square className="w-3 h-3" />
                      </button>
                    )
                  )}
                  <button
                    onClick={() => removeCamera(camera)}
                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {/* Video area */}
              <div className="flex-1 bg-gray-900 relative overflow-hidden min-h-0">
                {mode === 'webrtc' ? (
                  <WebRTCPlayer
                    streamName={go2rtcStreamName(camera)}
                    rtspUrl={camera.rtspUrl}
                    active={!!camera.webrtcActive}
                    onStop={() => setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, webrtcActive: false } : c))}
                  />
                ) : camera.active && camera.wsUrl ? (
                  <RTSPPlayer wsUrl={camera.wsUrl} width={1920} height={1080} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center px-3">
                      <Play className="w-5 h-5 text-gray-600 mx-auto mb-1" />
                      <p className="text-gray-400 text-xs font-medium truncate max-w-full">{camera.name}</p>
                    </div>
                  </div>
                )}
                {/* WebRTC idle state */}
                {mode === 'webrtc' && !camera.webrtcActive && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center px-3">
                      <Play className="w-5 h-5 text-gray-600 mx-auto mb-1" />
                      <p className="text-gray-400 text-xs font-medium truncate max-w-full">{camera.name}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

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
                  disabled={mode === 'jsmpeg' && !ffmpegAvailable}
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
