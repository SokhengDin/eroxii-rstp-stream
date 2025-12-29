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

// Global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

function App() {
  const [rtspUrl, setRtspUrl] = useState('rtsp://admin:admin@168@192.168.11.12//:8000');
  const [wsPort, setWsPort] = useState(9999);
  const [activeStream, setActiveStream] = useState(null);
  const [status, setStatus] = useState('');
  const [ffmpegAvailable, setFfmpegAvailable] = useState(null);
  const [streams, setStreams] = useState([]);

  // Check FFmpeg on mount
  useEffect(() => {
    checkFfmpeg();
    refreshStreams();
  }, []);

  const checkFfmpeg = async () => {
    try {
      if (isTauri && invoke) {
        const available = await invoke('check_ffmpeg');
        setFfmpegAvailable(available);
        if (!available) {
          setStatus('FFmpeg not found. Please install FFmpeg first.');
        }
      } else {
        // Browser mode - use Node.js server
        const res = await fetch(`${API_BASE}/api/check-ffmpeg`);
        const data = await res.json();
        setFfmpegAvailable(data.available);
        if (!data.available) {
          setStatus('FFmpeg not found. Please install FFmpeg first.');
        }
      }
    } catch (err) {
      setFfmpegAvailable(false);
      const errorMsg = isTauri
        ? `Error checking FFmpeg: ${err}`
        : 'Cannot connect to server. Run: npm run server';
      setStatus(errorMsg);
    }
  };

  const refreshStreams = async () => {
    try {
      if (isTauri && invoke) {
        const activeStreams = await invoke('get_active_streams');
        setStreams(activeStreams);
      } else {
        const res = await fetch(`${API_BASE}/api/streams`);
        const activeStreams = await res.json();
        setStreams(activeStreams);
      }
    } catch (err) {
      console.error('Error fetching streams:', err);
    }
  };

  const startStream = async (e) => {
    e.preventDefault();
    setStatus('Starting stream...');

    try {
      let response;

      if (isTauri && invoke) {
        console.log('Calling start_stream with:', { rtspUrl, wsPort });
        response = await invoke('start_stream', {
          rtspUrl: rtspUrl,
          wsPort: wsPort,
        });
      } else {
        // Browser mode - use Node.js server
        const res = await fetch(`${API_BASE}/api/start-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rtspUrl, wsPort }),
        });
        response = await res.json();
      }

      console.log('Received response:', response);

      if (response && response.success) {
        setActiveStream({
          wsUrl: response.ws_url,
          port: response.port,
          rtspUrl: rtspUrl,
        });
        setStatus(response.message);
        await refreshStreams();
      } else {
        setStatus(`Error: ${response?.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error starting stream:', err);
      setStatus(`Error: ${err}`);
    }
  };

  const stopStream = async () => {
    if (!activeStream) return;

    try {
      let response;

      if (isTauri && invoke) {
        response = await invoke('stop_stream', {
          wsPort: activeStream.port,
        });
      } else {
        const res = await fetch(`${API_BASE}/api/stop-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wsPort: activeStream.port }),
        });
        response = await res.json();
      }

      setStatus(response.message);
      setActiveStream(null);
      refreshStreams();
    } catch (err) {
      setStatus(`Error stopping stream: ${err}`);
    }
  };

  return (
    <main className="container">
      <h1>RTSP Stream Viewer</h1>

      {/* FFmpeg Status */}
      <div className={`ffmpeg-status ${ffmpegAvailable ? 'available' : 'unavailable'}`}>
        FFmpeg: {ffmpegAvailable === null ? 'Checking...' : ffmpegAvailable ? 'Available' : 'Not Found'}
      </div>

      {/* Stream Form */}
      <form onSubmit={startStream} className="stream-form">
        <div className="form-group">
          <label htmlFor="rtsp-url">RTSP URL:</label>
          <input
            id="rtsp-url"
            type="text"
            value={rtspUrl}
            onChange={(e) => setRtspUrl(e.target.value)}
            placeholder="rtsp://192.168.1.100:554/stream"
            disabled={activeStream !== null}
          />
        </div>

        <div className="form-group">
          <label htmlFor="ws-port">WebSocket Port:</label>
          <input
            id="ws-port"
            type="number"
            value={wsPort}
            onChange={(e) => setWsPort(parseInt(e.target.value))}
            min="1024"
            max="65535"
            disabled={activeStream !== null}
          />
        </div>

        <div className="button-group">
          {!activeStream ? (
            <button type="submit" disabled={!ffmpegAvailable}>
              Start Stream
            </button>
          ) : (
            <button type="button" onClick={stopStream} className="stop-btn">
              Stop Stream
            </button>
          )}
        </div>
      </form>

      {/* Status Message */}
      {status && <p className="status-message">{status}</p>}

      {/* Video Player */}
      {activeStream && (
        <div className="player-container">
          <h2>Live Stream</h2>
          <p className="stream-info">
            Source: {activeStream.rtspUrl}<br />
            WebSocket: {activeStream.wsUrl}
          </p>
          <RTSPPlayer
            wsUrl={activeStream.wsUrl}
            width={640}
            height={480}
            autoplay={true}
          />
        </div>
      )}

      {/* Active Streams List */}
      {streams.length > 0 && (
        <div className="streams-list">
          <h3>Active Streams ({streams.length})</h3>
          <ul>
            {streams.map((stream) => (
              <li key={stream.port}>
                Port {stream.port}: {stream.rtsp_url}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Help Section */}
      <div className="help-section">
        <h3>Quick Start</h3>
        <ol>
          <li>Make sure FFmpeg is installed on your system</li>
          <li>Enter your RTSP camera URL (e.g., rtsp://admin:pass@192.168.1.100:554/stream)</li>
          <li>Click "Start Stream" to begin viewing</li>
        </ol>
        <p className="note">
          <strong>Note:</strong> Common RTSP URL formats:
        </p>
        <ul className="url-examples">
          <li>Hikvision: rtsp://user:pass@ip:554/Streaming/Channels/101</li>
          <li>Dahua: rtsp://user:pass@ip:554/cam/realmonitor?channel=1</li>
          <li>Generic: rtsp://user:pass@ip:554/stream</li>
        </ul>
      </div>
    </main>
  );
}

export default App;
