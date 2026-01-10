import { useEffect, useRef, useState, useCallback } from 'react';

// JSMpeg player component for RTSP streams
export default function RTSPPlayer({ wsUrl, width = 640, height = 480 }) {
  const canvasRef = useRef(null);
  const playerRef = useRef(null);
  const frameCountRef = useRef(0);
  const initializingRef = useRef(false);
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState(null);
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);

  const cleanup = useCallback(() => {
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch (e) {
        // Ignore destroy errors
      }
      playerRef.current = null;
    }
    initializingRef.current = false;
  }, []);

  useEffect(() => {
    if (!wsUrl || !canvasRef.current) return;

    // Prevent double initialization (React StrictMode)
    if (initializingRef.current || playerRef.current) {
      console.log('Player already initializing or exists, skipping...');
      return;
    }
    initializingRef.current = true;

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

      // Check if we were cleaned up while waiting
      if (!initializingRef.current) {
        console.log('Initialization cancelled');
        return;
      }

      console.log('JSMpeg loaded, creating player with URL:', wsUrl);

      try {
        // Create player with proper options for binary WebSocket stream
        const player = new window.JSMpeg.Player(wsUrl, {
          canvas: canvasRef.current,
          autoplay: true,
          audio: false,
          video: true,
          loop: false,
          pauseWhenHidden: false,
          disableGl: false,
          disableWebAssembly: false,
          videoBufferSize: 512 * 1024,
          maxAudioLag: 0.25,
          onSourceEstablished: (source) => {
            console.log('Source established:', source);
            setStatus('connected');
          },
          onSourceCompleted: () => {
            console.log('Source completed');
            setStatus('disconnected');
          },
          onVideoDecode: () => {
            frameCountRef.current++;
          },
          onStalled: () => {
            console.log('Stream stalled');
            setStatus('stalled');
          },
          onEnded: () => {
            console.log('Stream ended');
            setStatus('ended');
          },
        });

        playerRef.current = player;
        console.log('Player created successfully:', player);

        // Log player state
        if (player.source) {
          console.log('Source type:', player.source.constructor.name);
        }

      } catch (err) {
        console.error('Error creating player:', err);
        setError(err.message || 'Failed to create player');
        setStatus('error');
        initializingRef.current = false;
      }
    };

    // Delay to allow WebSocket server and FFmpeg to start
    const initTimeout = setTimeout(initPlayer, 500);

    return () => {
      clearTimeout(initTimeout);
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
    <div className="absolute inset-0">
      {/* Stats Overlay */}
      <div className="absolute top-1 left-1 right-1 z-10 flex items-center justify-between">
        <div className="flex items-center gap-1 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px]">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: getStatusColor() }}
          />
          <span className="text-white font-medium">{status}</span>
        </div>
        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px]">
          <span className="text-white">
            <span className="font-medium">Frames:</span> {frameCount.toLocaleString()}
          </span>
          <span className="text-white">
            <span className="font-medium">FPS:</span> {fps}
          </span>
        </div>
      </div>

      {/* Video Canvas - Full Size */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="absolute inset-0 w-full h-full object-contain"
      />

      {/* Error Overlay */}
      {error && (
        <div className="absolute bottom-1 left-1 right-1 bg-red-500/90 backdrop-blur-sm text-white px-1.5 py-0.5 rounded text-[10px]">
          {error}
        </div>
      )}
    </div>
  );
}
