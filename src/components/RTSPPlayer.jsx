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

        playerRef.current = new window.JSMpeg.Player(wsUrl, {
          canvas: canvasRef.current,
          autoplay: autoplay,
          audio: false,
          videoBufferSize: 512 * 1024,
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
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    };

    initPlayer();

    return () => {
      clearInterval(fpsInterval);
      clearInterval(frameUpdateInterval);
      if (playerRef.current) {
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
