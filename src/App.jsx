import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import RTSPPlayer from './components/RTSPPlayer';
import './App.css';

function App() {
  const [rtspUrl, setRtspUrl] = useState('rtsp://192.168.1.100:554/stream');
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
      const available = await invoke('check_ffmpeg');
      setFfmpegAvailable(available);
      if (!available) {
        setStatus('FFmpeg not found. Please install FFmpeg first.');
      }
    } catch (err) {
      setFfmpegAvailable(false);
      setStatus(`Error checking FFmpeg: ${err}`);
    }
  };

  const refreshStreams = async () => {
    try {
      const activeStreams = await invoke('get_active_streams');
      setStreams(activeStreams);
    } catch (err) {
      console.error('Error fetching streams:', err);
    }
  };

  const startStream = async (e) => {
    e.preventDefault();
    setStatus('Starting stream...');

    try {
      const response = await invoke('start_stream', {
        rtspUrl: rtspUrl,
        wsPort: wsPort,
      });

      if (response.success) {
        setActiveStream({
          wsUrl: response.ws_url,
          port: response.port,
          rtspUrl: rtspUrl,
        });
        setStatus(response.message);
        refreshStreams();
      } else {
        setStatus(`Error: ${response.message}`);
      }
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  };

  const stopStream = async () => {
    if (!activeStream) return;

    try {
      const response = await invoke('stop_stream', {
        wsPort: activeStream.port,
      });
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
