import './index.css';

import React, { useEffect, useCallback, useMemo } from 'react';
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
  // Create message handler instance
  const messageHandler = useMemo(() => createMessageHandler({
    log: (message: string) => console.log(message),
    sendMessage: (type: string, content: any) => {
      websocketService.send(type, content);
    },
    getState: () => ({
      userId: localStorage.getItem('userId'),
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
      rtcConfig: {},
      offerQueue: new Map(),
      iceCandidateQueue: new Map()
    } as WebRTCState),
    setState: {
      setUserId: (value: string | null) => {
        if (value) localStorage.setItem('userId', value);
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
    peerConnections: new Map(),
    summarizeSDP: (sdp: string) => sdp,
    setWindowState: (state: string) => {
      (window as any).secpChatState = state;
    },
    queuedCandidates: new Map(),
    activePeers: new Set(),
    checkPeerConnections: () => {},
    renegotiatePeerConnection: () => {}
  }), []);

  // Establish WebSocket connection when user is logged in
  const connectWebSocket = useCallback(() => {
    const userId = localStorage.getItem('userId');
    if (!userId) {
      console.log('[App] No userId found, skipping WebSocket connection');
      return;
    }

    console.log('[App] Initializing WebSocket connection for user:', userId);
    const wsUrl = getWebSocketURL({ userId });
    console.log('[App] WebSocket URL:', wsUrl);

    const socket = new WebSocket(wsUrl);
    
    // Set up WebSocket event handlers
    socket.onopen = () => {
      console.log('[App] WebSocket connection established');
      websocketService.setSocket(socket);
    };

    socket.onclose = () => {
      console.log('[App] WebSocket disconnected, attempting to reconnect in 3s...');
      // Attempt to reconnect after a delay
      setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (error) => {
      console.error('[App] WebSocket connection error:', error);
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[App] WebSocket message received:', message.type);
        // Use global message handler
        messageHandler(message);
      } catch (error) {
        console.error('[App] Error parsing WebSocket message:', error);
      }
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
    console.log('[App] Setting up WebSocket connection');
    connectWebSocket();
    return () => {
      console.log('[App] Unmounting App, cleaning up WebSocket');
      websocketService.setSocket(null);
    };
  }, [connectWebSocket]);

  return <RouterProvider router={router} />;
}

export default WrappedApp;
