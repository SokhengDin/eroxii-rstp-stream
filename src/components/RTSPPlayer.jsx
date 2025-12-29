import { useEffect, useRef, useState } from 'react';

// JSMpeg player component for RTSP streams
export default function RTSPPlayer({ wsUrl, width = 640, height = 480, autoplay = true }) {
  const canvasRef = useRef(null);
  const playerRef = useRef(null);
  const frameCountRef = useRef(0);
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState(null);
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    if (!wsUrl || !canvasRef.current) return;

    // Reset frame counter
    frameCountRef.current = 0;
    setFrameCount(0);
    setFps(0);

    // FPS calculation interval
    let lastFrameCount = 0;
    const fpsInterval = setInterval(() => {
      const currentFrames = frameCountRef.current;
      setFps(currentFrames - lastFrameCount);
      lastFrameCount = currentFrames;
    }, 1000);

    // Frame counter interval (update UI every 100ms to avoid too many re-renders)
    const frameUpdateInterval = setInterval(() => {
      setFrameCount(frameCountRef.current);
    }, 100);

    // Wait for JSMpeg to be loaded
    const initPlayer = () => {
      if (typeof window.JSMpeg === 'undefined') {
        setTimeout(initPlayer, 100);
        return;
      }

      try {
        setStatus('connecting');
        setError(null);

        // Create WebSocket without protocol to avoid handshake issues
        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';

        playerRef.current = new window.JSMpeg.Player(null, {
          canvas: canvasRef.current,
          autoplay: autoplay,
          audio: false,
          videoBufferSize: 512 * 1024,
          source: window.JSMpeg.Source.WebSocket,
          onSourceEstablished: () => {
            setStatus('connected');
          },
          onSourceCompleted: () => {
            setStatus('disconnected');
          },
          onVideoDecode: () => {
            frameCountRef.current++;
          },
        });

        // Connect our custom socket to the player
        socket.onopen = () => {
          console.log('WebSocket connected');
          setStatus('connected');
        };

        socket.onmessage = (event) => {
          if (playerRef.current && playerRef.current.source) {
            playerRef.current.source.onMessage({ data: event.data });
          }
        };

        socket.onerror = (err) => {
          console.error('WebSocket error:', err);
          setError('WebSocket connection error');
          setStatus('error');
        };

        socket.onclose = () => {
          console.log('WebSocket closed');
          setStatus('disconnected');
        };

        // Store socket reference for cleanup
        playerRef.current._customSocket = socket;
      } catch (err) {
        console.error('Player error:', err);
        setError(err.message);
        setStatus('error');
      }
    };

    initPlayer();

    return () => {
      clearInterval(fpsInterval);
      clearInterval(frameUpdateInterval);
      if (playerRef.current) {
        // Close custom socket if exists
        if (playerRef.current._customSocket) {
          playerRef.current._customSocket.close();
        }
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [wsUrl, autoplay]);

  const getStatusColor = () => {
    switch (status) {
      case 'connected': return '#4ade80';
      case 'connecting': return '#fbbf24';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  return (
    <div className="rtsp-player">
      <div className="player-stats">
        <div className="player-status">
          <span
            className="status-dot"
            style={{ backgroundColor: getStatusColor() }}
          />
          <span className="status-text">{status}</span>
        </div>
        <div className="frame-stats">
          <span className="stat-item">
            <strong>Frames:</strong> {frameCount.toLocaleString()}
          </span>
          <span className="stat-item">
            <strong>FPS:</strong> {fps}
          </span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="video-canvas"
      />
      {error && <div className="player-error">{error}</div>}
    </div>
  );
}
