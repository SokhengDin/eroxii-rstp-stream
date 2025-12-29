import { useEffect, useRef, useState, useCallback } from 'react';

// JSMpeg player component for RTSP streams
export default function RTSPPlayer({ wsUrl, width = 640, height = 480 }) {
  const canvasRef = useRef(null);
  const playerRef = useRef(null);
  const socketRef = useRef(null);
  const frameCountRef = useRef(0);
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState(null);
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);

  const cleanup = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch (e) {
        // Ignore destroy errors
      }
      playerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!wsUrl || !canvasRef.current) return;

    // Reset state
    frameCountRef.current = 0;
    setFrameCount(0);
    setFps(0);
    setError(null);
    setStatus('connecting');

    // FPS calculation interval
    let lastFrameCount = 0;
    const fpsInterval = setInterval(() => {
      const currentFrames = frameCountRef.current;
      setFps(currentFrames - lastFrameCount);
      lastFrameCount = currentFrames;
    }, 1000);

    // Frame counter interval
    const frameUpdateInterval = setInterval(() => {
      setFrameCount(frameCountRef.current);
    }, 100);

    // Wait for JSMpeg to be loaded
    const initPlayer = () => {
      if (typeof window.JSMpeg === 'undefined') {
        console.log('Waiting for JSMpeg to load...');
        setTimeout(initPlayer, 100);
        return;
      }

      console.log('JSMpeg loaded, connecting to:', wsUrl);

      try {
        // Create WebSocket manually without subprotocol
        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';
        socketRef.current = socket;

        socket.onopen = () => {
          console.log('WebSocket opened, creating player...');
          setStatus('connected');

          // Create player with the open socket
          try {
            playerRef.current = new window.JSMpeg.Player(null, {
              canvas: canvasRef.current,
              autoplay: true,
              audio: false,
              videoBufferSize: 1024 * 1024,
              onVideoDecode: () => {
                frameCountRef.current++;
              },
            });

            // Manually inject data into player's demuxer
            if (playerRef.current.demuxer) {
              socket.onmessage = (event) => {
                if (playerRef.current && playerRef.current.demuxer) {
                  playerRef.current.demuxer.write(event.data);
                }
              };
            }
          } catch (err) {
            console.error('Error creating player:', err);
            setError('Failed to create video player');
            setStatus('error');
          }
        };

        socket.onerror = (err) => {
          console.error('WebSocket error:', err);
          setError('Connection error');
          setStatus('error');
        };

        socket.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          if (status !== 'error') {
            setStatus('disconnected');
          }
        };

      } catch (err) {
        console.error('Error initializing:', err);
        setError(err.message);
        setStatus('error');
      }
    };

    initPlayer();

    return () => {
      clearInterval(fpsInterval);
      clearInterval(frameUpdateInterval);
      cleanup();
    };
  }, [wsUrl, cleanup]);

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
