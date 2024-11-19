// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Stack, Typography, Button } from '@mui/material';
import { Mic, MicOff, Videocam, VideocamOff, CallEnd } from '@mui/icons-material';
import { CallButton } from '../components/button';
import { ChatComponent } from '../components/ChatComponent';

const SIGNALING_SERVICE_URL = `wss://k8s-secp-secpsign-8beb446f8f-1006806846.us-east-2.elb.amazonaws.com`;

const configuration = {
  iceServers: [
    {
      url: 'stun:global.stun.twilio.com:3478',
      urls: 'stun:global.stun.twilio.com:3478'
    },
    {
      url: 'turn:global.turn.twilio.com:3478?transport=udp',
      username: 'fae7ef162b3cb044e62b279ae44fea4919b07f8d256e96e6f89434a747322e28',
      urls: 'turn:global.turn.twilio.com:3478?transport=udp',
      credential: 'Ir+x5TXEr8t9zMevKfnyKhtc2DsSdBJ6UvhDImK5XWM='
    },
    {
      url: 'turn:global.turn.twilio.com:3478?transport=tcp',
      username: 'fae7ef162b3cb044e62b279ae44fea4919b07f8d256e96e6f89434a747322e28',
      urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
      credential: 'Ir+x5TXEr8t9zMevKfnyKhtc2DsSdBJ6UvhDImK5XWM='
    },
    {
      url: 'turn:global.turn.twilio.com:443?transport=tcp',
      username: 'fae7ef162b3cb044e62b279ae44fea4919b07f8d256e96e6f89434a747322e28',
      urls: 'turn:global.turn.twilio.com:443?transport=tcp',
      credential: 'Ir+x5TXEr8t9zMevKfnyKhtc2DsSdBJ6UvhDImK5XWM='
    }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceTransportPolicy: 'all',
};

// Helper function to summarize SDP
const summarizeSDP = (sdp: string) => {
    const lines = sdp.split('\n');
    return {
        type: lines.find(line => line.startsWith('m=audio')) ? 'audio+video' : 'unknown',
        iceUfrag: lines.find(line => line.includes('ice-ufrag'))?.split(':')[1].trim(),
        fingerprint: lines.find(line => line.includes('fingerprint'))?.split(' ')[1],
        setup: lines.find(line => line.includes('setup:'))?.split(':')[1].trim(),
    };
};

const CallView = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<string[]>([]);
  const [isInitiator, setIsInitiator] = useState<boolean>(false);
  const [isPeerConnectionReady, setIsPeerConnectionReady] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const [hasCreatedOffer, setHasCreatedOffer] = useState<boolean>(false);
  const setWindowState = (state: string) => {
    (window as any).secpChatState = (window as any).secpChatState || {};
    (window as any).secpChatState.userId = state;
    console.log(`Updated window state: userId = ${state}`);
  }

  const [messages, setMessages] = useState<Array<{
    content: string;
    sender: string;
    senderName: string;
    timestamp: number;
    roomId: string;
  }>>([]);

  const [meetingStarted, setMeetingStarted] = useState<boolean>(false);
  const [connectionStarted, setConnectionStarted] = useState<boolean>(false);
  const [offerCreated, setOfferCreated] = useState<boolean>(false);
  const [hasEstablishedConnection, setHasEstablishedConnection] = useState(false);
  const [isNegotiating, setIsNegotiating] = useState(false);
  const [isGatheringIce, setIsGatheringIce] = useState(false);
  const [iceCandidates, setIceCandidates] = useState<RTCIceCandidate[]>([]);

  const log = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;
    setLogs((prevLogs) => [...prevLogs, logMessage]);
    console.log(logMessage);
  }, []);

  const sendMessage = useCallback((type: string, content: any) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ type, room_id: roomId, content });
      socketRef.current.send(message);
      console.log(`Sent message type: ${type}`);
      if (type === 'chatMessage') {
        setMessages(prev => [...prev, content]);
      }
      if (type === 'iceCandidate') {
        console.log('ICE candidate sent successfully');
      }
    } else {
      console.log(`WebSocket not ready. Message not sent: ${type}`);
    }
  }, [roomId]);

  const connectWebSocket = useCallback(() => {
    if (socketRef.current) {
      console.log("WebSocket already initialized.");
      return;
    }

    console.log("Initializing WebSocket connection...");
    const wsUrl = `${SIGNALING_SERVICE_URL}/ws?room_id=${roomId}`;
    console.log("Attempting to connect to WebSocket at:", wsUrl);

    socketRef.current = new WebSocket(wsUrl);
    socketRef.current.onopen = () => {
      console.log("WebSocket connection established");
      sendMessage('requestInitialState', '');
    };

    socketRef.current.onclose = (event) => {
      console.log("WebSocket connection closed");
      socketRef.current = null; // Reset the ref on close
    };

    socketRef.current.onerror = (event) => {
      console.log("WebSocket error: " + JSON.stringify(event));
    };

    socketRef.current.onmessage = (event) => {
      console.log('Message received:', event.data.slice(0, 100) + (event.data.length > 100 ? '...' : ''));

      try {
        const message = JSON.parse(event.data);
        log(`Parsed message type: ${message.type}`);
        handleMessage(message); // Handle the parsed message
      } catch (error) {
        log(`Error parsing message: ${error}`);
      }
    };
  }, [roomId, sendMessage, log]);

  const createAndSendOffer = useCallback(async () => {
    if (!peerConnectionRef.current || isNegotiating) {
      return;
    }

    try {
      setIsNegotiating(true);
      setIsGatheringIce(true);
      setIceCandidates([]); // Reset candidates

      // Create offer
      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      
      // Wait for ICE gathering to complete
      await new Promise<void>((resolve) => {
        if (peerConnectionRef.current.iceGatheringState === 'complete') {
          resolve();
        } else {
          peerConnectionRef.current.onicegatheringstatechange = () => {
            if (peerConnectionRef.current.iceGatheringState === 'complete') {
              resolve();
            }
          };
        }
      });

      log('ICE gathering completed, sending offer');
      sendMessage('offer', JSON.stringify(offer));
    } catch (error) {
      log(`Error creating offer: ${error}`);
      setIsNegotiating(false);
      setIsGatheringIce(false);
    }
  }, [isNegotiating]);

  const restartIce = useCallback(async () => {
    if (!peerConnectionRef.current || !isInitiator) return;

    try {
      setOfferCreated(false); // Reset offer state
      const offer = await peerConnectionRef.current.createOffer({ iceRestart: true });
      await peerConnectionRef.current.setLocalDescription(offer);
      sendMessage('offer', JSON.stringify(offer));
      log('ICE restart offer sent');
    } catch (error) {
      log(`Error during ICE restart: ${error}`);
    }
  }, [isInitiator, sendMessage]);

  const setupPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      console.log('Peer connection already exists');
      return;
    }

    console.log('Creating new peer connection');
    peerConnectionRef.current = new RTCPeerConnection(configuration);

    // Set up ICE handling first
    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('ICE candidate generated:', event.candidate.type);
        sendMessage('iceCandidate', JSON.stringify(event.candidate));
      }
    };

    // Add connection state monitoring
    peerConnectionRef.current.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peerConnectionRef.current.iceConnectionState);
    };

    peerConnectionRef.current.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnectionRef.current.connectionState);
    };

    // Add tracks
    if (localVideoRef.current?.srcObject) {
      const stream = localVideoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => {
        console.log('Adding track:', track.kind);
        peerConnectionRef.current.addTrack(track, stream);
      });
    }
  }, []);

  const handleMessage = useCallback((message: any) => {
    console.log(`Handling message type: ${message.type}, States:`, {
      hasEstablishedConnection,
      isNegotiating,
      signalingState: peerConnectionRef.current?.signalingState
    });

    switch (message.type) {
      case 'meetingStarted':
        if (meetingStarted) {
          log('Meeting already started, ignoring');
          return;
        }
        log('Meeting has started');
        setMeetingStarted(true);
        break;

      case 'createOffer':
        // Skip if we already have a connection
        if (hasEstablishedConnection) {
          log('Connection already established, ignoring createOffer');
          return;
        }
        
        if (isNegotiating) {
          log('Already negotiating, ignoring createOffer');
          return;
        }

        log('Creating initial offer');
        setIsNegotiating(true);
        createAndSendOffer();
        break;

      case 'answer':
        if (hasEstablishedConnection) {
          log('Connection already established, ignoring answer');
          return;
        }

        handleAnswer(message.content);
        setHasEstablishedConnection(true);
        setIsNegotiating(false);
        break;

      case 'allReady':
        // Don't trigger new connection if we already have one
        console.log('Ignoring allReady - connection already established');
        break;

      case 'initiatorStatus':
        const isInitiatorValue = message.content === 'true' || message.content === true;
        console.log('Setting initiator status to:', isInitiatorValue, 'from value:', message.content);
        setIsInitiator(isInitiatorValue);
        break;
      case 'initialState':
        const initialState = JSON.parse(message.content);
        setUserId(initialState.userId);
        setWindowState(initialState.userId);
        console.log('Setting initiator from initial state:', initialState.isInitiator);
        setIsInitiator(initialState.isInitiator);
        break;
      case 'offer':
        const offerContent = JSON.parse(message.content);
        console.log('Received offer:', summarizeSDP(offerContent.sdp));
        if (!isPeerConnectionReady) {
          setupPeerConnection();
        }
        handleOffer(message.content);
        break;
      case 'iceCandidate':
        if (!peerConnectionRef.current) {
          log('Cannot handle ICE candidate - no peer connection');
          return;
        }
        const candidate = JSON.parse(message.content);
        peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate))
          .catch(err => console.error('Error adding ICE candidate:', err));
        break;
      case 'userID':
        setUserId(message.content);
        setWindowState(message.content);
        log(`User ID received: ${message.content}`);
        sendMessage('ready', { userId: message.content, initiator: isInitiator });
        break;
      case 'newInitiator':
        setIsInitiator(message.content === userId);
        log(`New initiator: ${message.content}`);
        break;
      case 'userCount':
        console.log(`User count received: ${message.content}`);
        break;
      case 'chatMessage':
        try {
          const chatMessage = typeof message.content === 'string'
            ? JSON.parse(message.content)
            : message.content;

          setMessages(prev => [...prev, chatMessage]);
          log(`Chat message received from ${chatMessage.senderName}`);
        } catch (error) {
          log(`Error parsing chat message: ${error}`);
        }
        break;
      case 'startMeeting':
        log('Meeting starting');
        if (!isPeerConnectionReady) {
          setupPeerConnection();
        }
        break;
      default:
        log(`Unhandled message type: ${message.type}`);
    }
  }, [hasEstablishedConnection, isNegotiating, isInitiator]);

  const handleSendMessage = useCallback((content: string) => {
    const message = {
      content,
      sender: userId,
      senderName: userId?.slice(0, 6) || 'Unknown',
      timestamp: Date.now(),
      roomId: roomId
    };
    sendMessage('chatMessage', message);
  }, [userId, roomId, sendMessage]);

  const startLocalVideo = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      log('Local video stream started');
      setIsReady(true);
    } catch (error) {
      log(`Error accessing media devices: ${error}`);
    }
  }, [log]);

  const handleOffer = useCallback(async (offerSDP: string) => {
    try {
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(offerSDP)));
      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);
      sendMessage('answer', JSON.stringify(answer));
      log('Answer created and sent');
    } catch (error) {
      log(`Error handling offer: ${error}`);
    }
  }, [log, sendMessage]);

  const handleAnswer = useCallback(async (answerSDP: string) => {
    try {
      const currentState = peerConnectionRef.current.signalingState;
      if (currentState !== "have-local-offer") {
        log(`Invalid state for handling answer: ${currentState}`);
        return;
      }

      const answer = new RTCSessionDescription(JSON.parse(answerSDP));
      await peerConnectionRef.current.setRemoteDescription(answer);
      log('Answer set successfully, starting ICE');
      
      // Now start ICE connection
      iceCandidates.forEach(candidate => {
        try {
          peerConnectionRef.current.addIceCandidate(candidate);
        } catch (e) {
          log(`Error adding stored ICE candidate: ${e}`);
        }
      });
    } catch (error) {
      log(`Error handling answer: ${error}`);
    }
  }, [iceCandidates]);

  const handleIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    try {
      if (!peerConnectionRef.current) {
        log('No peer connection when handling ICE candidate');
        return;
      }

      if (peerConnectionRef.current.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        log('ICE candidate added successfully');
      } else {
        setIceCandidates(prev => [...prev, new RTCIceCandidate(candidate)]);
        log('ICE candidate stored for later');
      }
    } catch (error) {
      log(`Error handling ICE candidate: ${error}`);
    }
  }, []);

  const startMeeting = useCallback(() => {
    if (!localVideoRef.current?.srcObject || meetingStarted) {
      return;
    }

    // Setup peer connection before starting meeting
    setupPeerConnection();
    
    // Then start the meeting
    setMeetingStarted(true);
    sendMessage('startMeeting', {});
  }, [meetingStarted, setupPeerConnection]);

  useEffect(() => {
    connectWebSocket();
    startLocalVideo();
  }, [connectWebSocket, startLocalVideo]);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        log('Closing WebSocket connection');
        socketRef.current.close();
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, [log]);

  useEffect(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = (event) => {
        if (event.candidate) {
          sendMessage('iceCandidate', JSON.stringify(event.candidate));
        }
      };
    }
  }, [sendMessage]);

  useEffect(() => {
    if (peerConnectionRef.current) {
      const timeout = setTimeout(() => {
        if (peerConnectionRef.current?.iceConnectionState === 'checking') {
          log('ICE connection timeout - restarting');
          restartIce();
        }
      }, 10000); // 10 second timeout
      
      return () => clearTimeout(timeout);
    }
  }, [restartIce, log]);

  useEffect(() => {
    return () => {
      setMeetingStarted(false);
      setConnectionStarted(false);
      setOfferCreated(false);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.oniceconnectionstatechange = () => {
        const state = peerConnectionRef.current?.iceConnectionState;
        log(`ICE connection state changed: ${state}`);
        
        if (state === 'failed') {
          // Only restart if we're the initiator
          if (isInitiator) {
            log('Connection failed, initiator attempting restart');
            restartIce();
          }
        }
      };
    }
  }, [isInitiator]);

  useEffect(() => {
    if (!peerConnectionRef.current) return;

    peerConnectionRef.current.onnegotiationneeded = () => {
      console.log('Negotiation needed');
      setIsNegotiating(true);
    };

    peerConnectionRef.current.onsignalingstatechange = () => {
      console.log('Signaling state:', peerConnectionRef.current.signalingState);
      if (peerConnectionRef.current.signalingState === 'stable') {
        setIsNegotiating(false);
      }
    };
  }, []);

  return (
    <Box sx={{ height: '100vh', width: '100vw', bgcolor: '#18181A', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ position: 'absolute', top: 10, right: 10, bgcolor: 'rgba(255,255,255,0.1)', padding: 1 }}>
        <Typography variant="caption" sx={{ color: 'white' }}>
          UserID: {userId || 'Not set'}
        </Typography>
        <Typography variant="caption" sx={{ color: 'white' }}>
          RoomID: {roomId || 'Not set'}
        </Typography>
        <Typography variant="caption" sx={{ color: 'white' }}>
          Initiator: {isInitiator ? 'Yes' : 'No'}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 2 }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <video ref={localVideoRef} autoPlay muted playsInline style={{ width: '40%' }} />
          <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '40%' }} />
        </Box>
      </Box>

      <Box sx={{ padding: 2 }}>
        <Stack direction="row" justifyContent="center" spacing={2}>
          <CallButton Icon={Mic} />
          <CallButton Icon={Videocam} />
          <CallButton Icon={CallEnd} color="error.main" onClick={() => navigate('/')} />
        </Stack>
      </Box>

      {isInitiator && !meetingStarted && (
        <Box sx={{ padding: 2, display: 'flex', justifyContent: 'center' }}>
          <Button 
            variant="contained"
            onClick={startMeeting} 
            sx={{ 
              bgcolor: 'primary.main',
              '&:hover': { bgcolor: 'primary.dark' }
            }}
          >
            Start Meeting
          </Button>
        </Box>
      )}

      {userId && <ChatComponent
        messages={messages}
        userId={userId}
        onSendMessage={handleSendMessage}
      />}
    </Box>
  );
};

export default CallView;

