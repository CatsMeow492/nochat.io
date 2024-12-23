import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Stack, Typography, Button } from '@mui/material';
import { Mic, Videocam, CallEnd } from '@mui/icons-material';
import { CallButton } from '../components/button';
import { RTCConfiguration, VERSION, SIGNALING_SERVICE_URL } from '../config/webrtc';
import LobbyOverlay from './lobby';
import { broadcastMessage } from '../services/websocket';
import { createMessageHandler } from '../utils/messageHandler';
import { WebRTCState } from '../types/chat';
import RemoteVideo from '../components/RemoteVideo';
import { PeerConnection } from '../types/chat';
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

const CallView = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();

  // State management
  const [logs, setLogs] = useState<string[]>([]);
  const [isInitiator, setIsInitiator] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | null>(() => {
    // Try to get existing userId from localStorage
    const stored = localStorage.getItem(`userId_${roomId}`);
    return stored || null;
  });
  const [meetingStarted, setMeetingStarted] = useState<boolean>(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [connectionReady, setConnectionReady] = useState<boolean>(false);
  const [peerConnections, setPeerConnections] = useState<Map<string, PeerConnection>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [participantCount, setParticipantCount] = useState<number>(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [pendingPeers, setPendingPeers] = useState<string[]>([]);
  const [offerQueue, setOfferQueue] = useState<Map<string, RTCSessionDescriptionInit>>(new Map());
  const [iceCandidateQueue, setIceCandidateQueue] = useState<Map<string, RTCIceCandidateInit[]>>(new Map());
  const [mediaSetupComplete, setMediaSetupComplete] = useState(false);
  const [mediaSetupStage, setMediaSetupStage] = useState<'initial' | 'getting-media' | 'setting-video' | 'complete'>('initial');
  const [activePeers, setActivePeers] = useState<Set<string>>(new Set());
  const [videoTracks, setVideoTracks] = useState<{ [key: string]: MediaStreamTrack[] }>({});
  const [peerStates, setPeerStates] = useState<Map<string, any>>(new Map());
  const [peerUpdateCounter, setPeerUpdateCounter] = useState(0);

  // const { data: participants } = useUserList({ roomId: String(roomId), enabled: !!roomId && !meetingStarted} )
  console.debug(`User list enabled `, !!roomId && !meetingStarted)
  // console.debug(`Participants: `, participants)

  // Refs
  const socketRef = useRef<WebSocket | null>(null);
  const userIdRef = useRef<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaReadyRef = useRef(mediaReady);
  const localStreamRef = useRef(localStream);
  const activePeersRef = useRef<Set<string>>(new Set());
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  
  // Keep refs in sync with state
  useEffect(() => {
    mediaReadyRef.current = mediaReady;
    localStreamRef.current = localStream;
    console.log('Media state updated:', { 
      mediaReady, 
      hasLocalStream: !!localStream,
      mediaSetupStage 
    });
  }, [mediaReady, localStream, mediaSetupStage]);

  // Logging helper
  const log = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    // const logMessage = `[${timestamp}] ${message}`;
    // setLogs((prevLogs) => [...prevLogs, logMessage]);
    // console.log(logMessage);
  }, []);

  // WebSocket initialization and management
  const connectWebSocket = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    const wsUrl = `${SIGNALING_SERVICE_URL}/ws?room_id=${roomId}${userIdRef.current ? `&user_id=${userIdRef.current}` : ''}`;
    console.log('Connecting to WebSocket:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connection opened');
      setConnectionReady(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.warn('WebSocket received message:', message);
        messageHandler(message);
        broadcastMessage(message);
      } catch (error) {
        log(`Error parsing WebSocket message: ${error}`);
      }
    };

    ws.onerror = (error) => {
      // log(`WebSocket error: ${error}`);
    };

    ws.onclose = () => {
      log('WebSocket connection closed');
      setConnectionReady(false);
      setTimeout(() => {
        if (socketRef.current?.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
      }, 3000);
    };
  }, [roomId, setConnectionReady]);

  const sendMessage = useCallback(
    (type: string, content: any) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({ type, room_id: roomId, content });
        socketRef.current.send(message);
        // log(`Sent message: ${type}`);
      } else {
        // log('WebSocket is not open');
      }
    },
    [log, roomId],
  );
  // Finally the message handler
  const messageHandler = useMemo(() => {
    const getState = () => ({
      isInitiator,
      isPeerConnectionReady: !!peerConnections.size,
      isNegotiating: false,
      meetingStarted,
      hasEstablishedConnection: false,
      userId: userIdRef.current,
      messages: [],
      mediaReady: mediaReadyRef.current,
      pendingPeers,
      offerQueue: new Map(),
      localStream: localStreamRef.current,
      peerConnections: new Map(Array.from(peerConnections.entries()).map(([id, pc]) => [
        id,
        {
          id,
          connection: pc.connection,
          trackStatus: pc.trackStatus,
          connected: pc.connection.connectionState === 'connected',
          negotiationNeeded: false
        }
      ])),
      iceCandidateQueue: new Map<string, RTCIceCandidate[]>(),
      rtcConfig: RTCConfiguration,
      activePeers: activePeersRef.current,
      remoteStreams: remoteStreamsRef.current
    });

    return createMessageHandler({
      queuedCandidates: new Map(),
      log: (message: string) => console.log(message),
      sendMessage: (type: string, content: any) => {
        if (!roomId) return;
        sendMessage(type, content);
      },
      peerConnections,
      getState,
      setState: {
        setMeetingStarted: (value) => {
          console.log('Setting meeting started:', value);
          setMeetingStarted(value);
        },
        setIsNegotiating: () => {},
        setHasEstablishedConnection: () => {},
        setIsInitiator,
        setUserId: (value) => {
          console.log('[USERID] Setting userId:', value);
          userIdRef.current = value;
          setUserId(value);
          console.log('[USERID] State after setting userId:', userIdRef.current);
        },
        setMessages: () => {},
        setPendingPeers,
        setOfferQueue,
        setLocalStream: (stream: MediaStream | null) => {
          console.log('Setting local stream:', stream);
          setLocalStream(stream);
        },
        setIceCandidateQueue: (queue: Map<string, RTCIceCandidate[]>) => {
          setIceCandidateQueue(queue);
        },
        setActivePeers: (peers: Set<string>) => {
          activePeersRef.current = new Set(peers);
          setActivePeers(new Set(peers));
          checkPeerConnections(Array.from(peers));
        },
        setRemoteStreams: (streams: Map<string, MediaStream>) => {
          console.log('Setting remote streams:', Array.from(streams.entries()));
          const newStreams = new Map();
          streams.forEach((stream, peerId) => {
            const newStream = new MediaStream();
            stream.getTracks().forEach(track => {
              newStream.addTrack(track);
            });
            newStreams.set(peerId, newStream);
          });
          remoteStreamsRef.current = newStreams;
          setRemoteStreams(newStreams);
        },
      },
      summarizeSDP: (sdp: string) => sdp,
      setWindowState: (state: string) => {},
      renegotiatePeerConnection: (peerId: string) => {
        const pc = peerConnections.get(peerId);
        if (pc) {
          pc.connection.restartIce();
        }
      },
      activePeers: activePeersRef.current,
      checkPeerConnections: (peerIds: string[]) => {
        peerIds.forEach(peerId => {
          const pc = peerConnections.get(peerId);
          if (pc && pc.connection.connectionState !== 'connected') {
            console.log(`Checking connection for peer ${peerId}`);
            if (!pc.negotiationNeeded) {
              pc.negotiationNeeded = true;
              pc.connection.restartIce();
            }
          }
        });
      }
    });
  }, [
    isInitiator,
    meetingStarted,
    userId,
    pendingPeers,
    peerConnections.size,
    sendMessage,
    setMeetingStarted,
    setIsInitiator,
    setPendingPeers,
    setOfferQueue,
    activePeers,
    setActivePeers,
    remoteStreamsRef,
  ]);

  // Keep these utility functions for video element management
  const attachHandlers = (videoElement: HTMLVideoElement) => {
    return new Promise<void>((resolve, reject) => {
        if (videoElement.readyState >= 3) {
            resolve();
            return;
        }

        const cleanupHandlers = () => {
            videoElement.removeEventListener('loadeddata', onLoadData);
            videoElement.removeEventListener('canplay', onLoadData);
            videoElement.removeEventListener('error', onError);
        }

        const onLoadData = () => {
            if (videoElement.readyState >= 3) {
                resolve();
                cleanupHandlers();
            }
        }

        const onError = (event: Event) => {
            reject(new Error(`Video playback rejected: ${event}`));
            cleanupHandlers();
        }

        videoElement.addEventListener('loadeddata', onLoadData);
        videoElement.addEventListener('canplay', onLoadData);
        videoElement.addEventListener('error', onError);
    });
  };

  const attemptPlay = async (videoElement: HTMLVideoElement, retryCount = 0) => {
    const videoElementId = videoElement.id;

    if (!document.getElementById(videoElementId)) {
        return;
    }

    try {
        await attachHandlers(videoElement);
        await videoElement.play();
    } catch (error) {
        if (retryCount < MAX_PLAY_RETRIES && document.getElementById(videoElementId)) {
            setTimeout(() => {
                attemptPlay(videoElement, retryCount + 1);
            }, 2000);
        }
    }
  };

  const startMeeting = useCallback(() => {
    console.log('Starting meeting...');
    sendMessage('startMeeting', {});
  }, [sendMessage]);

  // Component lifecycle
  useEffect(() => {
    if (!roomId) return;
    
    // Always try to connect when roomId changes or connection is lost
    connectWebSocket();
    
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [roomId, connectWebSocket]);

  useEffect(() => {
    if (connectionReady) {
      console.log('WebSocket connection ready, sending initial ready message');
      // Send initial ready message when connection is established
      sendMessage('ready', { userId, initiator: isInitiator });
    }
  }, [connectionReady, userId, isInitiator, sendMessage]);

  const ensureLocalMedia = async () => {
    if (!localStream) {
      try {
        console.log('Requesting local media access...');
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        setLocalStream(stream);
        console.log('Local media access granted:', {
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length
        });
        return stream;
      } catch (error) {
        console.error('Failed to get local media:', error);
        // Still allow the call to proceed even if media fails
        setMediaReady(true);
        return null;
      }
    }
    return localStream;
  };

  // Update useEffect for media setup
  useEffect(() => {
    const setupMedia = async () => {
      try {
        await ensureLocalMedia();
        setMediaReady(true);
      } catch (error) {
        console.error('Media setup failed:', error);
        setMediaReady(true); // Allow proceeding even if media fails
      }
    };

    setupMedia();
  }, []); // Run once on component mount

  useEffect(() => {
    if (mediaReady && pendingPeers.length > 0) {
      console.log('Media ready, processing pending peers:', pendingPeers);
      
      // Send createOffer message instead of direct call
      sendMessage('createOffer', { peers: pendingPeers });
      
      setPendingPeers([]); // Clear pending peers after processing
    }
  }, [mediaReady, pendingPeers, sendMessage]);

  // Add a ref to track if we've processed the queue
  const hasProcessedQueueRef = useRef(false);

  // Update the media setup effect
  useEffect(() => {
    if (mediaSetupStage === 'complete' && !hasProcessedQueueRef.current) {
      console.log('Processing queued operations after media setup completion');
      hasProcessedQueueRef.current = true;
      
      // Delegate offer processing to message handler
      offerQueue.forEach((sdp, peerId) => {
        messageHandler({ 
          type: 'offer',
          room_id: roomId!,
          content: { 
            sdp,
            fromPeerId: peerId,
            targetPeerId: userId
          }
        });
      });
      
      setOfferQueue(new Map());
    }
  }, [mediaSetupStage, messageHandler, roomId, userId]);

  useEffect(() => {
    console.log('Media state updated:', {
      mediaReady,
      mediaSetupStage,
      hasLocalStream: !!localStream
    });
  }, [mediaReady, mediaSetupStage, localStream]);

  const handleReady = () => {}

  // Add an effect to process queued operations when media becomes ready
  useEffect(() => {
    if (mediaReady && localStream) {
      console.log('Media is ready, processing any queued operations');
      // Process any queued offers
      offerQueue.forEach((offer, peerId) => {
        console.log(`Processing queued offer for peer: ${peerId}`);
        messageHandler({ 
          type: 'offer', 
          room_id: roomId!, 
          content: { offer, peerId } 
        });
      });
      setOfferQueue(new Map());

      // Process any queued ICE candidates
      iceCandidateQueue.forEach((candidates, peerId) => {
        console.log(`Processing queued ICE candidates for peer: ${peerId}`);
        candidates.forEach(candidate => {
          messageHandler({
            type: 'iceCandidate',
            room_id: roomId!,
            content: { candidate, peerId }
          });
        });
      });
      setIceCandidateQueue(new Map());
    }
  }, [mediaReady, localStream]);

  // Add debug logging for mediaReady changes
  useEffect(() => {
    console.log('Media ready state changed:', mediaReady);
  }, [mediaReady]);

  // Update the video element effect to handle both offering and answering peers
  useEffect(() => {
    // Create/update video elements for active peers
    Array.from(remoteStreams.entries())
      .filter(([peerId, stream]) => activePeers.has(peerId))
      .map(([peerId, stream]) => {
        const hasVideoTracks = stream.getVideoTracks().length > 0;
        const hasAudioTracks = stream.getAudioTracks().length > 0;
        
        console.log(`Rendering stream for peer ${peerId}:`, {
            hasVideo: hasVideoTracks,
            hasAudio: hasAudioTracks,
            isActive: activePeers.has(peerId)
        });
        
        return (
          <Box
            key={`video-container-${peerId}`}
            sx={{
              position: 'relative',
              width: '100%',
              paddingTop: '75%',
              backgroundColor: 'background.paper',
              borderRadius: 1,
              overflow: 'hidden'
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
      });

    // Cleanup removed peers from videoRefs
    videoRefs.current.forEach((_, peerId) => {
        if (!remoteStreams.has(peerId)) {
            videoRefs.current.delete(peerId);
        }
    });
  }, [activePeers, remoteStreams, userId]);

  // Add debug logging for stream updates
  useEffect(() => {
    console.log('Remote streams updated:', Array.from(remoteStreams.entries()).map(([peerId, stream]) => ({
        peerId,
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length,
        isActive: activePeers.has(peerId)
    })));
  }, [remoteStreams, activePeers]);

  // Add state update effect
  useEffect(() => {
    if (meetingStarted) {
      console.log('Meeting started, updating state and connections');
      // Force a re-render of video elements
      setRemoteStreams(new Map(remoteStreams));
    }
  }, [meetingStarted]);

  // Update ref when state changes
  useEffect(() => {
    activePeersRef.current = activePeers;
  }, [activePeers]);

  useEffect(() => {
    console.log('Active peers updated:', Array.from(activePeers));
    console.log('Remote streams:', Array.from(remoteStreams.entries()).map(([id, stream]) => ({
        id: short(id),
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length
    })));
  }, [activePeers, remoteStreams]);

  useEffect(() => {
    console.log('Peer Connections:', Array.from(peerConnections.entries()).map(([id, pc]) => ({
        id: short(id),
        connected: pc.connected,
        trackStatus: pc.trackStatus,
        connectionState: pc.connection.connectionState
    })));
  }, [peerConnections]);

  useEffect(() => {
    setPeerStates(new Map(peerConnections));
  }, [peerConnections]);

  // Update when peerConnections or tracks change
  useEffect(() => {
    const handlePeerUpdate = () => {
      setPeerUpdateCounter(prev => prev + 1);
    };

    // Subscribe to peer connection updates
    peerConnections.forEach((peer) => {
      peer.connection.addEventListener('connectionstatechange', handlePeerUpdate);
      peer.connection.addEventListener('track', handlePeerUpdate);
    });

    return () => {
      // Cleanup listeners
      peerConnections.forEach((peer) => {
        peer.connection.removeEventListener('connectionstatechange', handlePeerUpdate);
        peer.connection.removeEventListener('track', handlePeerUpdate);
      });
    };
  }, [peerConnections]);

  // Add effect to monitor peer connection states
  useEffect(() => {
    const handleConnectionStateChange = (peerId: string) => {
      const pc = peerConnections.get(peerId);
      if (pc) {
        console.log(`Peer ${peerId} connection state:`, pc.connection.connectionState);
        if (pc.connection.connectionState === 'failed') {
          // Attempt to recover failed connections
          pc.connection.restartIce();
        }
      }
    };

    // Add listeners for all peer connections
    peerConnections.forEach((pc, peerId) => {
      pc.connection.addEventListener('connectionstatechange', 
        () => handleConnectionStateChange(peerId)
      );
    });

    return () => {
      // Cleanup listeners
      peerConnections.forEach((pc, peerId) => {
        pc.connection.removeEventListener('connectionstatechange',
          () => handleConnectionStateChange(peerId)
        );
      });
    };
  }, [peerConnections]);

  // Add to your peer connection setup
  const pc = new RTCPeerConnection(RTCConfiguration);
  pc.oniceconnectionstatechange = () => {
    console.log(`ICE connection state for peer: ${pc.iceConnectionState}`);
  };

  const checkPeerConnections = useCallback((peerIds: string[]) => {
    peerIds.forEach(peerId => {
      const pc = peerConnections.get(peerId);
      if (pc && pc.connection.connectionState !== 'connected') {
        console.log(`Checking connection for peer ${peerId}`);
        if (!pc.negotiationNeeded) {
          pc.negotiationNeeded = true;
          pc.connection.restartIce();
        }
      }
    });
  }, [peerConnections]);

  // Add/update a peer
  const updatePeer = (peerId: string, peerData: Partial<PeerConnection>) => {
    setPeerConnections(prev => {
        const next = new Map(prev);
        const existing = next.get(peerId);
        if (!existing) return prev; // Return if no existing peer
        next.set(peerId, {
            ...existing,  // Spread existing first to maintain required properties
            ...peerData,
            id: peerId,
        });
        return next;
    });
  };

  // Check peer status
  const isPeerActive = (peerId: string) => {
    const peer = peerConnections.get(peerId);
    return peer?.connected && (peer.trackStatus.audio || peer.trackStatus.video);
  };

  // Get active peers
  const getActivePeers = () => 
    Array.from(peerConnections.values())
      .filter(peer => peer.connected);

  useEffect(() => {
    const streamDetails = Array.from(remoteStreams.entries()).map(([id, stream]) => {
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        return {
            id,
            isActive: activePeers.has(id),
            video: {
                present: videoTracks.length > 0,
                enabled: videoTracks.some(track => track.enabled),
                readyState: videoTracks.map(track => track.readyState)
            },
            audio: {
                present: audioTracks.length > 0,
                enabled: audioTracks.some(track => track.enabled),
                readyState: audioTracks.map(track => track.readyState)
            }
        };
    });

    console.log('Peer Status Report:\n' + 
        streamDetails.map(peer => 
            `  Peer ${short(peer.id)}:\n` +
            `    Active: ${peer.isActive}\n` +
            `    Video: ${peer.video.present ? '✓' : '✗'} ` +
            `(Enabled: ${peer.video.enabled}, State: ${peer.video.readyState})\n` +
            `    Audio: ${peer.audio.present ? '✓' : '✗'} ` +
            `(Enabled: ${peer.audio.enabled}, State: ${peer.audio.readyState})`
        ).join('\n\n')
    );
  }, [activePeers, remoteStreams]);

  // Add this new effect to debug stream updates
  useEffect(() => {
    console.log('Stream update:', Array.from(remoteStreams.entries()).map(([id, stream]) => ({
        id: short(id),
        tracks: stream.getTracks().map(track => ({
            kind: track.kind,
            enabled: track.enabled,
            state: track.readyState,
            id: track.id
        }))
    })));
  }, [remoteStreams]);

  return (
    <Box
      sx={{
        height: '100vh',
        width: '100vw',
        bgcolor: '#18181A',
        display: 'flex',
        flexDirection: 'column',
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

      

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 3,
          background: 'rgba(8, 8, 12, 0.95)',
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
                position: 'absolute',
                bottom: 24,
                right: 24,
                width: '240px',
                height: '180px',
                borderRadius: '12px',
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                background: 'rgba(255, 255, 255, 0.02)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
                zIndex: 10
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

      <Box 
        sx={{ 
          padding: 3,
          background: 'rgba(8, 8, 12, 0.95)',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
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
