import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';

interface RemoteVideoProps {
  peerId: string;
  stream: MediaStream;
  onError?: (error: Error | DOMException) => void;
}

const RemoteVideo: React.FC<RemoteVideoProps> = React.memo(({ peerId, stream, onError }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const playAttempts = useRef(0);
  const mountedRef = useRef(true);
  const lastStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !stream) return;

    // Only update srcObject if the stream has changed
    if (lastStreamRef.current !== stream) {
      console.log(`Setting up video for peer ${peerId}:`, {
        streamActive: stream.active,
        tracks: stream.getTracks().map(t => ({
          kind: t.kind,
          enabled: t.enabled,
          readyState: t.readyState
        }))
      });

      lastStreamRef.current = stream;
      videoElement.srcObject = stream;
      setIsPlaying(false);
      playAttempts.current = 0;
    }

    const playVideo = async (attempt = 1) => {
      if (!mountedRef.current) return;
      
      try {
        if (videoElement.paused) {
          await videoElement.play();
          if (mountedRef.current) {
            setIsPlaying(true);
            playAttempts.current = 0;
            console.log(`Video playing for peer ${peerId}`);
          }
        }
      } catch (error) {
        if (!mountedRef.current) return;
        
        playAttempts.current++;
        console.warn(`Play attempt ${playAttempts.current} failed for peer ${peerId}:`, error);
        
        if (playAttempts.current < 5) {
          setTimeout(playVideo, 1000);
        } else {
          onError?.(error instanceof Error ? error : new Error('Failed to play video'));
        }
      }
    };

    // Start playback
    playVideo();

    // Track change monitoring
    const trackChangeHandler = () => {
      if (!mountedRef.current) return;
      
      console.log(`Track state changed for peer ${peerId}:`, {
        tracks: stream.getTracks().map(t => ({
          kind: t.kind,
          enabled: t.enabled,
          readyState: t.readyState
        }))
      });
      
      // Attempt to restart playback if needed
      if (videoElement.paused && isPlaying) {
        playVideo();
      }
    };

    stream.getTracks().forEach(track => {
      track.addEventListener('ended', trackChangeHandler);
      track.addEventListener('mute', trackChangeHandler);
      track.addEventListener('unmute', trackChangeHandler);
    });

    return () => {
      stream.getTracks().forEach(track => {
        track.removeEventListener('ended', trackChangeHandler);
        track.removeEventListener('mute', trackChangeHandler);
        track.removeEventListener('unmute', trackChangeHandler);
      });
    };
  }, [peerId, stream, onError, isPlaying]);

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: isPlaying ? 'transparent' : 'rgba(0,0,0,0.2)',
        borderRadius: '8px',
        overflow: 'hidden'
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain'
        }}
      />
      {!isPlaying && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'white',
            fontSize: '0.8rem'
          }}
        >
          Connecting...
        </Box>
      )}
    </Box>
  );
});

RemoteVideo.displayName = 'RemoteVideo';

export default RemoteVideo; 