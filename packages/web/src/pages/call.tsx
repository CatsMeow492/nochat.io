import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Stack, Typography, Button } from '@mui/material';
import { Mic, Videocam, CallEnd } from '@mui/icons-material';
import { CallButton } from '../components/button';
import { RTCConfiguration, VERSION, SIGNALING_SERVICE_URL } from '../config/webrtc';
import LobbyOverlay from './lobby';
import { createMessageHandler } from '../utils/messageHandler';
import { WebRTCState } from '../types/chat';
import RemoteVideo from '../components/RemoteVideo';
import { PeerConnection } from '../types/chat';
import websocketService from '../services/websocket';
// import { useUserList } from '../hooks/useRoomList';

// Max retries allowed for play()
const MAX_PLAY_RETRIES = 3;

const short = (id: string) => id.slice(0, 4);

const checkTurnServer = async (turnConfig: RTCIceServer): Promise<boolean> => {
  const pc = new RTCPeerConnection({
    iceServers: [turnConfig],
    iceTransportPolicy: 'relay'
  });
  
  try {
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        pc.close();
        resolve(false);
      }, 5000);

      pc.onicecandidate = (e) => {
        if (e.candidate && e.candidate.type === 'relay') {
          clearTimeout(timeout);
          pc.close();
          resolve(true);
        }
      };

      const dc = pc.createDataChannel('test');
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timeout);
          pc.close();
          resolve(false);
        });
    });
  } catch (err) {
    console.error('TURN server check failed:', err);
    return false;
  }
};

const handleReady = () => {
  // No-op since we're using the global WebSocket service
};

const CallView = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();

  // State management
  const [isInitiator, setIsInitiator] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem('userId'));
  const [meetingStarted, setMeetingStarted] = useState<boolean>(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [peerConnections, setPeerConnections] = useState<Map<string, PeerConnection>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [activePeers, setActivePeers] = useState<Set<string>>(new Set());

  // Refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Setup media stream
  useEffect(() => {
    const setupMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        setMediaReady(true);
      } catch (error) {
        console.error('Failed to get local media:', error);
        setMediaReady(true); // Allow proceeding even if media fails
      }
    };

    setupMedia();
  }, []);

  // Handle peer connection setup
  const setupPeerConnection = useCallback((peerId: string) => {
    const pc = new RTCPeerConnection(RTCConfiguration);
    
    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        websocketService.send('iceCandidate', {
          candidate: event.candidate,
          peerId,
          roomId
        });
      }
    };

    // Handle remote tracks
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.set(peerId, stream);
        return next;
      });
      setActivePeers(prev => new Set(prev).add(peerId));
    };

    // Store the peer connection
    setPeerConnections(prev => {
      const next = new Map(prev);
      next.set(peerId, {
        id: peerId,
        connection: pc,
        connected: false,
        trackStatus: { audio: false, video: false },
        negotiationNeeded: false
      });
      return next;
    });

    return pc;
  }, [localStream, roomId]);

  // Handle offer creation
  const createAndSendOffer = useCallback(async (peerId: string) => {
    const pc = peerConnections.get(peerId)?.connection || setupPeerConnection(peerId);
    
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      websocketService.send('offer', {
        sdp: offer,
        peerId,
        roomId
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  }, [peerConnections, setupPeerConnection, roomId]);

  // Handle received offer
  const handleOffer = useCallback(async (content: any) => {
    const { sdp, peerId } = content;
    const pc = peerConnections.get(peerId)?.connection || setupPeerConnection(peerId);
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      websocketService.send('answer', {
        sdp: answer,
        peerId,
        roomId
      });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }, [peerConnections, setupPeerConnection, roomId]);

  // Handle received answer
  const handleAnswer = useCallback(async (content: any) => {
    const { sdp, peerId } = content;
    const pc = peerConnections.get(peerId)?.connection;
    
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    }
  }, [peerConnections]);

  // Handle ICE candidate
  const handleIceCandidate = useCallback(async (content: any) => {
    const { candidate, peerId } = content;
    const pc = peerConnections.get(peerId)?.connection;
    
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error handling ICE candidate:', error);
      }
    }
  }, [peerConnections]);

  // Subscribe to WebSocket messages
  useEffect(() => {
    const unsubscribe = websocketService.subscribe('message', (message) => {
      // Handle WebRTC signaling messages
      switch (message.type) {
        case 'offer':
          handleOffer(message.content);
          break;
        case 'answer':
          handleAnswer(message.content);
          break;
        case 'iceCandidate':
          handleIceCandidate(message.content);
          break;
        case 'startMeeting':
          setMeetingStarted(true);
          break;
        // ... handle other message types ...
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [handleOffer, handleAnswer, handleIceCandidate]);

  // Start meeting
  const startMeeting = useCallback(() => {
    websocketService.send('startMeeting', { roomId });
  }, [roomId]);

  // Add attemptPlay function
  const attemptPlay = async (videoElement: HTMLVideoElement, retryCount = 0) => {
    if (!videoElement) return;

    try {
      await videoElement.play();
    } catch (error) {
      if (retryCount < MAX_PLAY_RETRIES) {
        setTimeout(() => {
          attemptPlay(videoElement, retryCount + 1);
        }, 2000);
      }
    }
  };

  // Handle room join/leave
  useEffect(() => {
    if (roomId && websocketService) {
      // Explicitly send join room message
      websocketService.send('joinRoom', { roomId });

      // Cleanup when leaving
      return () => {
        websocketService.send('leaveRoom', { roomId });
      };
    }
  }, [roomId]);

  // Render video grid and controls
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
          participants={Array.from(peerConnections.keys())}
          userId={userId}
          roomId={roomId}
          onReadyChange={handleReady}
          mediaReady={mediaReady}
          onCameraToggle={(enabled) => {
            if (localStream) {
              localStream.getVideoTracks().forEach(track => track.enabled = enabled);
            }
          }}
          onMicrophoneToggle={(enabled) => {
            if (localStream) {
              localStream.getAudioTracks().forEach(track => track.enabled = enabled);
            }
          }}
        />
      )}

      {/* Main video grid container - add max height */}
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
            {Array.from(remoteStreams.entries())
              .filter(([peerId, stream]) => activePeers.has(peerId))
              .map(([peerId, stream]) => {
                const hasVideoTracks = stream.getVideoTracks().length > 0;
                const hasAudioTracks = stream.getAudioTracks().length > 0;
                
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
                      {hasVideoTracks ? (
                        <video
                          ref={el => {
                            if (el) {
                              videoRefs.current.set(peerId, el);
                              if (el.srcObject !== stream) {
                                console.log(`Setting stream for video element ${peerId}`);
                                el.srcObject = stream;
                                attemptPlay(el);
                              }
                            }
                          }}
                          autoPlay
                          playsInline
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }}
                        />
                      ) : (
                        <Typography variant="h6" sx={{ color: 'white' }}>
                          {hasAudioTracks ? 'Audio Only' : 'No Media'}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
          </Box>

          {/* Add local video overlay */}
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
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
                ref={el => {
                  if (el) {
                    el.srcObject = localStream;
                  }
                }}
              />
            </Box>
          )}
        </Box>
      </Box>

      {/* Controls - ensure they stay at bottom */}
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
            onClick={() => navigate('/')}
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

      {isInitiator ? (
        !meetingStarted && (
          <Box sx={{ 
            padding: 3,
            display: 'flex', 
            justifyContent: 'center',
            background: 'rgba(8, 8, 12, 0.95)',
          }}>
            <Button
              variant="contained"
              onClick={startMeeting}
              sx={{
                py: 2,
                px: 6,
                borderRadius: '12px',
                fontSize: '1.1rem',
                fontWeight: 600,
                textTransform: 'none',
                background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                '&:hover': {
                  background: 'linear-gradient(45deg, #4f46e5, #7c3aed)',
                },
              }}
            >
              Start Call
            </Button>
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

      {/* {userId && <ChatComponent
        messages={messages}
        userId={userId}
        onSendMessage={handleSendMessage}
      />} */}
    </Box>
  );
};

export default CallView;
