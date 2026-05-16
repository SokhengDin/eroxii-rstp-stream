import { useState, useEffect } from 'react';
import { Play, Square, CheckCircle, XCircle, Maximize, Minimize, Radio } from 'lucide-react';
import RTSPPlayer from '../components/RTSPPlayer';
import WebRTCPlayer from '../components/WebRTCPlayer';
import { apiFetch } from '../utils/api';

const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;
const API_BASE = isTauri ? 'http://127.0.0.1:3001' : '';

const tauriInvokePromise = isTauri
  ? import('@tauri-apps/api/core').then((m) => m.invoke)
  : Promise.resolve(null);

const CAMERAS_PER_PAGE = 9;

const getGridCols = (count) => {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count <= 4) return 2;
  return 3;
};

function CameraDisplay() {
  const [cameras, setCameras] = useState([]);
  const [currentTab, setCurrentTab] = useState(0);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mode, setMode] = useState(() => localStorage.getItem('stream-mode') || 'jsmpeg');

  const totalTabs = Math.max(1, Math.ceil(cameras.length / CAMERAS_PER_PAGE));

  const getCurrentPageCameras = () => {
    const start = currentTab * CAMERAS_PER_PAGE;
    return cameras.slice(start, start + CAMERAS_PER_PAGE);
  };

  useEffect(() => {
    localStorage.setItem('stream-mode', mode);
  }, [mode]);

  useEffect(() => {
    fetchCameras();
    checkFfmpeg();
  }, []);

  useEffect(() => {
    if (mode === 'webrtc') cameras.forEach(registerGo2rtcStream);
  }, [mode]);

  const fetchCameras = async () => {
    try {
      const res = await apiFetch('/api/cameras');
      const data = await res.json();
      if (Array.isArray(data)) setCameras(data.map(c => ({ ...c, active: false, wsUrl: null, webrtcActive: false })));
    } catch {}
  };

  const go2rtcStreamName = (camera) => `cam_${camera.id}`;

  const registerGo2rtcStream = async (camera) => {
    try {
      await apiFetch(`/api/go2rtc/api/streams?name=${encodeURIComponent(go2rtcStreamName(camera))}&src=${encodeURIComponent(camera.rtspUrl)}`, { method: 'PUT' });
    } catch {}
  };

  const checkFfmpeg = async () => {
    try {
      const invoke = await tauriInvokePromise;
      if (isTauri && invoke) {
        setFfmpegAvailable(await invoke('check_ffmpeg'));
      } else {
        const res = await apiFetch(`${API_BASE}/api/check-ffmpeg`);
        const data = await res.json();
        setFfmpegAvailable(data.available);
      }
    } catch {
      setFfmpegAvailable(false);
    }
  };

  const startStream = async (camera) => {
    try {
      const invoke = await tauriInvokePromise;
      let response;
      if (isTauri && invoke) {
        response = await invoke('start_stream', { rtspUrl: camera.rtspUrl, wsPort: camera.wsPort });
      } else {
        const res = await apiFetch(`${API_BASE}/api/start-stream`, {
          method: 'POST',
          body: JSON.stringify({ rtspUrl: camera.rtspUrl, wsPort: camera.wsPort }),
        });
        response = await res.json();
      }
      if (response?.success) {
        const wsPath = response.ws_url;
        const wsUrl = wsPath.startsWith('ws')
          ? wsPath
          : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${wsPath}`;
        setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, active: true, wsUrl } : c));
      }
    } catch {}
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
      setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, active: false, wsUrl: null } : c));
    } catch {}
  };

  const startAllOnPage = async () => {
    for (const camera of getCurrentPageCameras()) {
      if (!camera.active) await startStream(camera);
    }
  };

  const stopAllOnPage = async () => {
    for (const camera of getCurrentPageCameras()) {
      if (camera.active) await stopStream(camera);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50">
      {!isFullscreen && (
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">Camera Display</h1>
              <p className="hidden sm:block text-sm text-gray-500 mt-0.5">Monitor RTSP camera streams</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Mode Toggle */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 border border-gray-200">
                <button
                  onClick={() => setMode('jsmpeg')}
                  title="JSMpeg mode"
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                    mode === 'jsmpeg' ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Play className="w-3 h-3" />
                  <span className="hidden sm:inline">JSMpeg</span>
                </button>
                <button
                  onClick={() => setMode('webrtc')}
                  title="WebRTC mode"
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                    mode === 'webrtc' ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Radio className="w-3 h-3" />
                  <span className="hidden sm:inline">WebRTC</span>
                </button>
              </div>

              {mode === 'jsmpeg' && (
                <div className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium ${
                  ffmpegAvailable ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  {ffmpegAvailable ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{ffmpegAvailable === null ? '...' : ffmpegAvailable ? 'Ready' : 'Not Found'}</span>
                </div>
              )}

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

              <button
                onClick={() => setIsFullscreen(true)}
                title="Fullscreen"
                className="p-1.5 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                <Maximize className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {totalTabs > 1 && (
            <div className="flex gap-2 mt-3">
              {Array.from({ length: totalTabs }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentTab(i)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    currentTab === i ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  Page {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isFullscreen && (
        <button
          onClick={() => setIsFullscreen(false)}
          className="absolute top-4 right-4 z-50 flex items-center gap-2 px-4 py-2 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg hover:bg-gray-900 transition-colors font-medium shadow-lg"
        >
          <Minimize className="w-4 h-4" />
          <span>Exit Fullscreen</span>
        </button>
      )}

      <div className={`flex-1 flex flex-col overflow-hidden ${isFullscreen ? 'p-0' : 'p-6'}`}>
        {cameras.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-gray-400 text-sm font-medium">No cameras configured</p>
              <p className="text-gray-400 text-xs mt-1">Admin can add cameras in Settings</p>
            </div>
          </div>
        ) : (
          <div
            className={`flex-1 grid min-h-0 overflow-hidden ${isFullscreen ? 'gap-0' : 'gap-3'}`}
            style={{ gridTemplateColumns: `repeat(${getGridCols(getCurrentPageCameras().length)}, 1fr)`, gridAutoRows: '1fr' }}
          >
            {getCurrentPageCameras().map((camera) => (
              <div key={camera.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm flex flex-col min-h-0 min-w-0">
                <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 flex-shrink-0 min-w-0">
                  <h3 className="font-medium text-gray-900 text-xs truncate flex-1 min-w-0">{camera.name}</h3>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {mode === 'jsmpeg' ? (
                      !camera.active ? (
                        <button onClick={() => startStream(camera)} disabled={!ffmpegAvailable}
                          className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Start">
                          <Play className="w-3 h-3" />
                        </button>
                      ) : (
                        <button onClick={() => stopStream(camera)}
                          className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors" title="Stop">
                          <Square className="w-3 h-3" />
                        </button>
                      )
                    ) : (
                      !camera.webrtcActive ? (
                        <button onClick={() => setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, webrtcActive: true } : c))}
                          className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors" title="Connect">
                          <Play className="w-3 h-3" />
                        </button>
                      ) : (
                        <button onClick={() => setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, webrtcActive: false } : c))}
                          className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors" title="Disconnect">
                          <Square className="w-3 h-3" />
                        </button>
                      )
                    )}
                  </div>
                </div>
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
                  ) : null}
                  {((mode === 'jsmpeg' && !camera.active) || (mode === 'webrtc' && !camera.webrtcActive)) && (
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
        )}
      </div>
    </div>
  );
}

export default CameraDisplay;
