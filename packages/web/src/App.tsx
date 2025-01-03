import './index.css';

import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { CssBaseline } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { RouterProvider } from 'react-router-dom';
import theme from './theme';
import store from './services/redux';
import queryClient from './services/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { Provider } from 'react-redux';
import router from './services/react-router';
import { getWebSocketURL } from './config/webrtc';
import { createMessageHandler } from './utils/messageHandler';
import websocketService from './services/websocket';
import { WebRTCState } from './types/chat';
import { useMediaStore } from './store/mediaStore';

declare global {
  interface Window {
    debugState: {
      getMediaStore: () => any;
    };
  }
}

const generateTempUserId = () => {
  return 'anon_' + Math.random().toString(36).substr(2, 9);
};

function WrappedApp() {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <App />
        </ThemeProvider>
      </QueryClientProvider>
    </Provider>
  );
}

function App() {
  // Safe localStorage access utility
  const safeGetStorage = (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('localStorage access failed:', error);
      return null;
    }
  };

  const safeSetStorage = (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn('localStorage write failed:', error);
    }
  };

  // Add state for ICE servers
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([
    { urls: 'stun:stun.l.google.com:19302' } // Default STUN server while loading
  ]);

  // Fetch ICE servers on mount and initialize WebSocket service
  useEffect(() => {
    const fetchIceServers = async () => {
      try {
        const url = 'https://nochat.io/api/ice-servers';
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        setIceServers(data.iceServers);
        websocketService.setIceServers(data.iceServers);
        console.log('[ICE] Servers initialized:', data.iceServers);
      } catch (error) {
        console.error('[ICE] Failed to fetch servers:', error);
        // Keep using default STUN server
        websocketService.setIceServers(iceServers);
      }
    };

    fetchIceServers();
  }, []);

  // Create message handler instance with iceServers
  const messageHandler = useMemo(() => createMessageHandler({
    log: (message: string) => console.log(message),
    sendMessage: (type: string, content: any) => {
      websocketService.send(type, content);
    },
    getState: () => ({
      userId: safeGetStorage('userId'),
      isInitiator: false,
      isPeerConnectionReady: false,
      isNegotiating: false,
      hasEstablishedConnection: false,
      mediaReady: false,
      meetingStarted: false,
      messages: [],
      pendingPeers: [],
      localStream: null,
      remoteStreams: new Map(),
      activePeers: new Set(),
      peerConnections: new Map(),
      iceServers,
      rtcConfig: {},
      offerQueue: new Map(),
      iceCandidateQueue: new Map()
    } as WebRTCState),
    setState: {
      setUserId: (value: string | null) => {
        if (value) safeSetStorage('userId', value);
      },
      setIsInitiator: (value: boolean) => {},
      setMeetingStarted: (value: boolean) => {},
      setIsNegotiating: (value: boolean) => {},
      setHasEstablishedConnection: (value: boolean) => {},
      setMessages: () => {},
      setPendingPeers: () => {},
      setLocalStream: () => {},
      setRemoteStreams: () => {},
      setActivePeers: () => {},
      setRtcConfig: (config: RTCConfiguration) => {},
      setOfferQueue: () => {},
      setIceCandidateQueue: () => {}
    },
    iceServers,
    peerConnections: new Map(),
    summarizeSDP: (sdp: string) => sdp,
    setWindowState: (state: string) => {
      (window as any).secpChatState = state;
    },
    queuedCandidates: new Map(),
    activePeers: new Set(),
    checkPeerConnections: () => {},
    renegotiatePeerConnection: () => {}
  }), [iceServers]);

  // Establish WebSocket connection when user is logged in
  const connectWebSocket = useCallback(() => {
    let userId = safeGetStorage('userId');
    
    // If no userId exists, create a temporary one
    if (!userId) {
      userId = generateTempUserId();
      safeSetStorage('userId', userId);
      console.log('[App] Generated temporary userId:', userId);
    }

    console.log('[App] Initializing WebSocket connection for user:', userId);
    const wsUrl = getWebSocketURL({ userId });
    console.log('[App] WebSocket URL:', wsUrl);

    // Create WebSocket without strict protocol requirement
    let connectionTimeout: NodeJS.Timeout;
    const socket = new WebSocket(wsUrl);
    
    // Set connection timeout
    connectionTimeout = setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        console.error('[App] WebSocket connection timeout');
        socket.close();
      }
    }, 5000);

    // Set up WebSocket event handlers
    socket.onopen = () => {
      clearTimeout(connectionTimeout);
      console.log('[App] WebSocket connection established');
      
      // Send initial ping to verify connection
      try {
        socket.send(JSON.stringify({ type: 'ping' }));
        websocketService.setSocket(socket);
      } catch (error) {
        console.error('[App] Failed to send initial ping:', error);
      }
    };

    socket.onclose = (event) => {
      clearTimeout(connectionTimeout);
      console.log('[App] WebSocket disconnected with code:', event.code, 'reason:', event.reason);
      
      // Don't reconnect if closed normally or if user logged out
      if (event.code === 1000 || !safeGetStorage('userId')) {
        console.log('[App] Clean disconnection or user logged out, not reconnecting');
        return;
      }

      console.log('[App] Attempting to reconnect in 3s...');
      // Attempt to reconnect after a delay with exponential backoff
      setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (error) => {
      console.error('[App] WebSocket connection error:', error);
    };

    // Store socket in global service
    websocketService.setSocket(socket);

    return () => {
      console.log('[App] Cleaning up WebSocket connection');
      socket.close();
    };
  }, [messageHandler]);

  // Connect WebSocket when component mounts
  useEffect(() => {
    console.log('[App] Setting up WebSocket connection and message handler');
    // Subscribe message handler to all messages
    const unsubscribe = websocketService.subscribe('message', messageHandler);
    connectWebSocket();
    
    return () => {
      console.log('[App] Unmounting App, cleaning up WebSocket and message handler');
      unsubscribe();
      websocketService.setSocket(null);
    };
  }, [connectWebSocket, messageHandler]);

  useEffect(() => {
    window.debugState = {
      getMediaStore: () => useMediaStore.getState()
    };
  }, []);

  return <RouterProvider router={router} />;
}

export default WrappedApp;
