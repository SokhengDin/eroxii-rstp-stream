import { useEffect, useRef, useState } from 'react';

export default function WebRTCPlayer({ streamName }) {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    if (!streamName || !videoRef.current) return;

    let pc;

    async function start() {
      setStatus('connecting');
      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        pcRef.current = pc;

        pc.ontrack = (e) => {
          if (videoRef.current) {
            videoRef.current.srcObject = e.streams[0];
            setStatus('connected');
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            setStatus('disconnected');
          }
        };

        // Add transceiver so go2rtc knows we want video
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const res = await fetch(`/api/go2rtc/api/webrtc?src=${encodeURIComponent(streamName)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/sdp',
            'x-session-token': localStorage.getItem('auth-token') || '',
          },
          body: offer.sdp,
        });

        if (!res.ok) throw new Error(`go2rtc ${res.status}`);

        const answer = await res.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      } catch (err) {
        console.error('WebRTC error:', err);
        setStatus('error');
      }
    }

    start();

    return () => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [streamName]);

  const statusColor = status === 'connected' ? '#4ade80' : status === 'connecting' ? '#fbbf24' : '#ef4444';

  return (
    <div className="absolute inset-0">
      {/* Status badge */}
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
