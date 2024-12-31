import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Stack, Typography } from '@mui/material';
import { Mic, Videocam, CallEnd } from '@mui/icons-material';
import { CallButton } from '../components/button';
import { RTCConfiguration } from '../config/webrtc';
import LobbyOverlay from './lobby';
import { useMediaStore } from '../store/mediaStore';
import websocketService from '../services/websocket';
import { PeerConnectionState } from '../types/chat';


// Max retries allowed for play()
const MAX_PLAY_RETRIES = 3;

const CallView = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { peerConnectionStates, peerTracks } = useMediaStore();

  // Local state for meeting status
  const [isInitiator, setIsInitiator] = useState<boolean>(false);
  const [meetingStarted, setMeetingStarted] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem('userId'));

  // Get media state from store
  const {
    localStream,
    mediaReady,
    audioEnabled,
    videoEnabled,
    toggleAudio,
    toggleVideo,
    cleanup
  } = useMediaStore();

  // Refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Track readiness state
  const trackReadyState = useRef(new Map<string, Set<string>>());

  // Add a stable ref for tracking active peers
  const activePeers = useRef(new Set<string>());

  // Start meeting
  const startMeeting = () => {
    websocketService.send('startMeeting', { roomId });
  };

  // Handle ready state change
  const handleReady = () => {
    // No-op since we're using the global WebSocket service
  };

  // Enhanced attemptPlay function
  const attemptPlay = async (element: HTMLVideoElement | HTMLAudioElement, peerId: string) => {
    try {
      await element.play();
    } catch (error) {
      console.error(`Failed to play ${element.tagName.toLowerCase()} for peer ${peerId}:`, error);
      // Retry with muted if it's a video element
      if (element instanceof HTMLVideoElement && !element.muted) {
        console.log('Retrying with muted video');
        element.muted = true;
        await element.play();
      }
    }
  };

  // Track ready state handler
  const handleTrackReady = (peerId: string, track: MediaStreamTrack) => {
    if (!trackReadyState.current.has(peerId)) {
      trackReadyState.current.set(peerId, new Set());
    }
    const readyTracks = trackReadyState.current.get(peerId)!;
    readyTracks.add(track.kind);
    
    console.log(`Track ${track.kind} ready for peer ${peerId}. Ready tracks:`, Array.from(readyTracks));
  };

  // Clean up track state when peer is removed
  useEffect(() => {
    return () => {
      trackReadyState.current.clear();
    };
  }, []);

  // Pass ICE servers to websocket service when joining room
  useEffect(() => {
    if (roomId && websocketService) {
      websocketService.send('joinRoom', { roomId });

      return () => {
        websocketService.send('leaveRoom', { roomId });
        cleanup();
      };
    }
  }, [roomId, cleanup]);

  // Set up local video
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Subscribe to WebSocket messages for meeting state
  useEffect(() => {
    const unsubscribe = websocketService.subscribe('message', (message) => {
      switch (message.type) {
        case 'startMeeting':
          setMeetingStarted(true);
          break;
        case 'initiatorStatus':
          setIsInitiator(message.content === 'true' || message.content === true);
          break;
        case 'userID':
          setUserId(message.content);
          break;
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Setup media stream
  useEffect(() => {
    const setupMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        useMediaStore.getState().setLocalStream(stream);
        useMediaStore.getState().setMediaReady(true);
      } catch (error) {
        console.error('Failed to get local media:', error);
        useMediaStore.getState().setMediaReady(true); // Allow proceeding even if media fails
      }
    };

    setupMedia();
  }, []);

  // Modify shouldRenderVideo to use the ref
  const shouldRenderVideo = (peerId: string) => {
    // If peer is already active, keep rendering
    if (activePeers.current.has(peerId)) {
        return true;
    }
    
    const peerState = peerConnectionStates.get(peerId);
    const tracks = peerTracks.get(peerId);
    
    // Only consider READY state as valid
    const isConnectionValid = peerState?.connectionState === PeerConnectionState.READY;
    
    // Both tracks must be live
    const hasMediaTracks = tracks?.video?.track?.readyState === 'live' && 
                          tracks?.audio?.track?.readyState === 'live';
    
    // Add some debug logging
    console.debug(`[RENDER] Peer ${peerId} state check:`, {
        connectionState: peerState?.connectionState,
        videoTrack: tracks?.video?.track?.readyState,
        audioTrack: tracks?.audio?.track?.readyState,
        isValid: isConnectionValid && hasMediaTracks
    });
    
    if (isConnectionValid && hasMediaTracks) {
        activePeers.current.add(peerId);
        return true;
    }
    
    return false;
  };

  // Add cleanup for disconnected peers
  useEffect(() => {
    const cleanup = (peerId: string) => {
        const state = peerConnectionStates.get(peerId)?.connectionState;
        if (state === PeerConnectionState.FAILED || 
            state === PeerConnectionState.CLOSED) {
            activePeers.current.delete(peerId);
        }
    };

    // Subscribe to connection state changes
    return () => {
        activePeers.current.clear();
    };
  }, []);

  return (
    <Box
      sx={{
        height: '100vh',
        width: '100vw',
        bgcolor: '#18181A',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Lobby Overlay - Only show when meeting hasn't started */}
      {!meetingStarted && (
        <LobbyOverlay
          isInitiator={isInitiator}
          meetingStarted={meetingStarted}
          onStartMeeting={startMeeting}
          participants={Array.from(peerTracks.keys())}
          userId={userId}
          roomId={roomId}
          onReadyChange={handleReady}
          onCameraToggle={toggleVideo}
          onMicrophoneToggle={toggleAudio}
        />
      )}

      {/* Main video grid container */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 3,
          background: 'rgba(8, 8, 12, 0.95)',
          maxHeight: 'calc(100vh - 100px)',
          overflow: 'auto',
        }}
      >
        <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
          <Box
            id="remote-videos"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 3,
              width: '100%',
              height: '100%',
              padding: 2,
            }}
          >
            {Array.from(peerTracks.entries()).map(([peerId, tracks]) => {
              const videoTrack = tracks.video?.track;
              const audioTrack = tracks.audio?.track;
              const stream = tracks.video?.stream || tracks.audio?.stream;
              
              if (!stream) {
                console.log(`No stream available for peer ${peerId}`);
                return null;
              }

              // Update track ready state
              if (videoTrack) handleTrackReady(peerId, videoTrack);
              if (audioTrack) handleTrackReady(peerId, audioTrack);
              
              console.log(`Rendering video for peer ${peerId}:`, {
                hasVideoTrack: !!videoTrack,
                videoEnabled: videoTrack?.enabled,
                videoState: videoTrack?.readyState,
                hasAudioTrack: !!audioTrack,
                audioEnabled: audioTrack?.enabled,
                audioState: audioTrack?.readyState,
                readyTracks: Array.from(trackReadyState.current.get(peerId) || new Set()),
                connectionState: peerConnectionStates.get(peerId)?.connectionState,
                streamTracks: stream.getTracks().map(t => ({
                  kind: t.kind,
                  enabled: t.enabled,
                  state: t.readyState
                }))
              });
              
              return (
                <Box
                  key={`video-container-${peerId}`}
                  sx={{
                    position: 'relative',
                    width: '100%',
                    paddingTop: '75%',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    backdropFilter: 'blur(12px)',
                  }}
                >
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center'
                    }}
                  >
                    {shouldRenderVideo(peerId) && (
                      <>
                        <video
                          key={`video-${peerId}`}
                          ref={el => {
                            if (!el) return;
                            
                            // Only set srcObject if it's different
                            if (el.srcObject !== stream) {
                                console.log(`Setting stream for video element ${peerId}`, {
                                    streamTracks: stream?.getTracks().map(t => ({
                                        kind: t.kind,
                                        enabled: t.enabled,
                                        state: t.readyState
                                    }))
                                });
                                el.srcObject = stream;
                                el.muted = true;
                                
                                // Debounce play attempts
                                const playPromise = el.play();
                                if (playPromise) {
                                    playPromise.catch(err => {
                                        if (err.name !== 'AbortError') {
                                            console.error(`Failed to play video for peer ${peerId}:`, err);
                                        }
                                    });
                                }
                            }
                          }}
                          autoPlay
                          playsInline
                          muted
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }}
                        />
                        <audio
                          autoPlay
                          ref={el => {
                            if (el && stream) {
                              el.srcObject = stream;
                              el.play().catch(err => console.error('Failed to play audio:', err));
                            }
                          }}
                        />
                      </>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Local video overlay */}
          {localStream && (
            <Box
              sx={{
                position: 'fixed',
                bottom: 100,
                right: 24,
                width: '240px',
                height: '180px',
                zIndex: 10,
              }}
            >
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            </Box>
          )}
        </Box>
      </Box>

      {/* Controls */}
      <Box 
        sx={{ 
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: 3,
          background: 'rgba(8, 8, 12, 0.95)',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          zIndex: 10,
        }}
      >
        <Stack direction="row" justifyContent="center" spacing={3}>
          <CallButton 
            Icon={Mic} 
            active={audioEnabled}
            onClick={toggleAudio}
            sx={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '12px',
              padding: '12px',
              '&:hover': {
                background: 'rgba(255, 255, 255, 0.05)',
              }
            }}
          />
          <CallButton 
            Icon={Videocam}
            active={videoEnabled}
            onClick={toggleVideo}
            sx={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '12px',
              padding: '12px',
              '&:hover': {
                background: 'rgba(255, 255, 255, 0.05)',
              }
            }}
          />
          <CallButton 
            Icon={CallEnd} 
            color="error.main" 
            onClick={() => {
              cleanup();
              navigate('/');
            }}
            sx={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '12px',
              padding: '12px',
              '&:hover': {
                background: 'rgba(239, 68, 68, 0.1)',
              }
            }}
          />
        </Stack>
      </Box>

      {/* Meeting status indicators */}
      {isInitiator ? (
        !meetingStarted && (
          <Box sx={{ 
            padding: 3,
            display: 'flex', 
            justifyContent: 'center',
            background: 'rgba(8, 8, 12, 0.95)',
          }}>
            <button
              onClick={startMeeting}
              style={{
                padding: '12px 24px',
                borderRadius: '12px',
                fontSize: '1.1rem',
                fontWeight: 600,
                background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Start Call
            </button>
          </Box>
        )
      ) : (
        <Box sx={{ 
          padding: 3,
          display: 'flex', 
          justifyContent: 'center',
          background: 'rgba(8, 8, 12, 0.95)',
        }}>
          <Typography
            sx={{
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '1.1rem',
            }}
          >
            Waiting for host to start the call...
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default CallView;
