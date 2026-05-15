import { useEffect, useRef, useState, useCallback } from 'react';

export default function WebRTCPlayer({ streamName, rtspUrl, active, onStop }) {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const [status, setStatus] = useState('idle');

  const stop = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
    onStop?.();
  }, [onStop]);

  useEffect(() => {
    if (!active || !streamName || !rtspUrl) return;

    let cancelled = false;

    async function connect() {
      setStatus('connecting');
      try {
        // Register stream in go2rtc
        await fetch(`/api/go2rtc/api/streams?name=${encodeURIComponent(streamName)}&src=${encodeURIComponent(rtspUrl)}`, {
          method: 'PUT',
          headers: { 'x-session-token': localStorage.getItem('auth-token') || '' },
        });

        if (cancelled) return;

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        pcRef.current = pc;

        pc.ontrack = (e) => {
          if (cancelled) return;
          if (videoRef.current) videoRef.current.srcObject = e.streams[0];
        };

        pc.oniceconnectionstatechange = () => {
          if (cancelled) return;
          const s = pc.iceConnectionState;
          if (s === 'connected' || s === 'completed') setStatus('connected');
          if (s === 'disconnected' || s === 'failed') setStatus('disconnected');
        };

        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const res = await fetch(`/api/go2rtc/api/whep?src=${encodeURIComponent(streamName)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/sdp',
            'x-session-token': localStorage.getItem('auth-token') || '',
          },
          body: offer.sdp,
        });

        if (!res.ok) throw new Error(`go2rtc ${res.status}`);

        const answer = await res.text();
        if (cancelled) return;
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      } catch (err) {
        if (!cancelled) {
          console.error('WebRTC:', err);
          setStatus('error');
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [active, streamName, rtspUrl]);

  const statusColor = {
    connected: '#4ade80',
    connecting: '#fbbf24',
    disconnected: '#ef4444',
    error: '#ef4444',
    idle: '#6b7280',
  }[status] ?? '#6b7280';

  if (!active) return null;

  return (
    <div className="absolute inset-0">
      <div className="absolute top-1 left-1 z-10 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px]">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
        <span className="text-white font-medium">{status}</span>
      </div>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-contain"
      />
    </div>
  );
}
