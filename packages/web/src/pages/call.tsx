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
      username: 'f8602f65bc07f21f90edcd52cbec7602165d4aa5fc848c5973f22d817f9722e0',
      urls: 'turn:global.turn.twilio.com:3478?transport=udp',
      credential: 'HOSmCNH1JvExHuPG61xAeezdw/94jcw1pFAMpXludF0='
    },
    {
      url: 'turn:global.turn.twilio.com:3478?transport=tcp',
      username: 'f8602f65bc07f21f90edcd52cbec7602165d4aa5fc848c5973f22d817f9722e0',
      urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
      credential: 'HOSmCNH1JvExHuPG61xAeezdw/94jcw1pFAMpXludF0='
    },
    {
      url: 'turn:global.turn.twilio.com:443?transport=tcp',
      username: 'f8602f65bc07f21f90edcd52cbec7602165d4aa5fc848c5973f22d817f9722e0',
      urls: 'turn:global.turn.twilio.com:443?transport=tcp',
      credential: 'HOSmCNH1JvExHuPG61xAeezdw/94jcw1pFAMpXludF0='
    }
  ],
  iceCandidatePoolSize: 10,
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

  const createAndSendOffer = useCallback(async (options?: RTCOfferOptions) => {
    if (!peerConnectionRef.current) {
        console.error('No peer connection when creating offer');
        return;
    }

    try {
        const offer = await peerConnectionRef.current.createOffer(options);
        await peerConnectionRef.current.setLocalDescription(offer);
        sendMessage('offer', JSON.stringify(offer));
        log('Offer created and sent');
    } catch (error) {
        log(`Error creating offer: ${error}`);
    }
  }, [sendMessage, log]);

  const restartIce = useCallback(() => {
    if (!peerConnectionRef.current) return;
    
    if (isInitiator) {
        console.log('Initiator restarting ICE');
        createAndSendOffer({ iceRestart: true });
    }
  }, [isInitiator, createAndSendOffer]);

  const createPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
        console.log('Peer connection already exists, skipping creation');
        return;
    }

    console.log('Creating new peer connection');
    peerConnectionRef.current = new RTCPeerConnection(configuration);

    // Add local tracks
    if (localVideoRef.current?.srcObject) {
        console.log('Adding local tracks to peer connection');
        (localVideoRef.current.srcObject as MediaStream).getTracks().forEach(track => {
            console.log('Adding track:', track.kind);
            peerConnectionRef.current.addTrack(track, localVideoRef.current.srcObject as MediaStream);
        });
    }

    // Connection state monitoring
    peerConnectionRef.current.onconnectionstatechange = () => {
        const state = peerConnectionRef.current.connectionState;
        console.log('Connection state changed:', state);
        if (state === 'connected') {
            console.log('Peer connection established successfully');
        } else if (state === 'failed') {
            console.log('Peer connection failed, attempting restart');
            restartIce();
        }
    };

    peerConnectionRef.current.oniceconnectionstatechange = () => {
        const state = peerConnectionRef.current.iceConnectionState;
        console.log('ICE connection state changed:', state);
        if (state === 'connected') {
            console.log('ICE connection established');
        } else if (state === 'failed') {
            console.log('ICE connection failed, attempting restart');
            restartIce();
        }
    };

    // Track handling
    peerConnectionRef.current.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        if (remoteVideoRef.current && event.streams[0]) {
            console.log('Setting remote stream');
            remoteVideoRef.current.srcObject = event.streams[0];
        }
    };

    setIsPeerConnectionReady(true);
  }, []);

  const handleMessage = useCallback((message: any) => {
    console.log(`Parsed message: ${JSON.stringify(message, null, 2).slice(0, 200)}`);

    switch (message.type) {
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
          createPeerConnection();
        }
        handleOffer(message.content);
        break;
      case 'createOffer':
        console.log('DEBUG - Entered createOffer case');
        log('Received createOffer request');
        if (!isPeerConnectionReady) {
          log('Creating peer connection before creating offer');
          createPeerConnection();
        }
        
        log('Creating and sending offer');
        createAndSendOffer();
        break;
      case 'answer':
        const answerContent = JSON.parse(message.content);
        console.log('Received answer:', summarizeSDP(answerContent.sdp));
        handleAnswer(message.content);
        break;
      case 'iceCandidate':
        const candidate = JSON.parse(message.content);
        console.log('ICE candidate:', {
            type: candidate.candidate?.split(' ')[7], // typ host/srflx/relay
            protocol: candidate.candidate?.includes('tcp') ? 'TCP' : 'UDP',
            mid: candidate.sdpMid
        });
        handleIceCandidate(JSON.parse(message.content));
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
      case 'allReady':
        log('Received allReady message');
        if (!isPeerConnectionReady) {
          log('Creating peer connection after allReady');
          createPeerConnection();
        }
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
      case 'meetingStarted':
        log('Meeting has started');
        setMeetingStarted(true);
        if (!isPeerConnectionReady) {
          createPeerConnection();
        }
        break;
      case 'startMeeting':
        log('Meeting starting');
        if (!isPeerConnectionReady) {
          createPeerConnection();
        }
        
        if (isInitiator) {
          // Give time for peer connection to initialize
          setTimeout(() => {
            console.log('Initiator creating offer');
            createAndSendOffer();
          }, 1000);
        }
        break;
      default:
        log(`Unhandled message type: ${message.type}`);
    }
  }, [log, sendMessage, createPeerConnection, createAndSendOffer, isPeerConnectionReady]);

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
        return;
      }

      const answer = new RTCSessionDescription(JSON.parse(answerSDP));
      await peerConnectionRef.current.setRemoteDescription(answer);
      console.log('Answer received and set successfully');
    } catch (error) {
      console.log(`Error handling answer: ${error}`);
    }
  }, [log]);

  const handleIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    try {
        if (!peerConnectionRef.current) {
            console.error('No peer connection when handling ICE candidate');
            return;
        }

        console.log('Adding ICE candidate:', {
            type: candidate.candidate?.split(' ')[7],  // 'typ host/srflx/relay'
            protocol: candidate.candidate?.includes('tcp') ? 'TCP' : 'UDP',
            state: peerConnectionRef.current.iceConnectionState
        });

        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        log('ICE candidate added');
    } catch (error) {
        log(`Error adding ICE candidate: ${error}`);
    }
  }, [log]);

  const startMeeting = useCallback(() => {
    if (!localVideoRef.current?.srcObject) {
      console.error('No local stream available');
      return;
    }
    
    // Create peer connection first
    createPeerConnection();
    
    // Notify server to start meeting
    sendMessage('startMeeting', {});
  }, [sendMessage]);

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

