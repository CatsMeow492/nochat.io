import { useCallback, useRef, useState } from 'react';

export const useMedia = (log: (message: string) => void) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [isReady, setIsReady] = useState(false);

  const startLocalVideo = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      log('Local video stream started');
      setIsReady(true);
      return stream;
    } catch (error) {
      log(`Error accessing media devices: ${error}`);
      return null;
    }
  }, [log]);

  const handleRemoteStream = useCallback((stream: MediaStream) => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
    }
  }, []);

  return {
    localVideoRef,
    remoteVideoRef,
    isReady,
    startLocalVideo,
    handleRemoteStream
  };
}; 