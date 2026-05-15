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
          bundlePolicy: 'max-bundle',
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

        // Force H264 only — matches camera codec, no re-encoding
        const videoTrx = pc.addTransceiver('video', { direction: 'recvonly' });
        const { codecs } = RTCRtpReceiver.getCapabilities('video');
        const h264 = codecs.filter(c => c.mimeType === 'video/H264');
        if (h264.length) videoTrx.setCodecPreferences(h264);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Wait for ICE gathering — max 2s then send whatever we have
        await new Promise((resolve) => {
          if (pc.iceGatheringState === 'complete') return resolve();
          const check = () => { if (pc.iceGatheringState === 'complete') resolve(); };
          pc.addEventListener('icegatheringstatechange', check);
          setTimeout(resolve, 2000);
        });

        if (cancelled) return;

        const res = await fetch(`/api/go2rtc/api/webrtc?src=${encodeURIComponent(streamName)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/sdp',
            'x-session-token': localStorage.getItem('auth-token') || '',
          },
          body: pc.localDescription.sdp,
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`go2rtc ${res.status}: ${err}`);
        }

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
