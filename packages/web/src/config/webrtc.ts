import { getWsUrl } from '../utils/url';

// Base URL should be HTTP/HTTPS
export const BASE_URL = process.env.REACT_APP_API_URL || 'https://dev-signaling-service.secpapp.com';

// WebSocket URL for real-time connections
export const SIGNALING_SERVICE_URL = process.env.REACT_APP_SIGNALING_SERVICE_URL || 'https://dev-signaling-service.secpapp.com';

// Debug logs
if (process.env.NODE_ENV === 'development') {
  console.debug('Base URL:', BASE_URL);
  console.debug('Signaling Service URL:', SIGNALING_SERVICE_URL);
}

export const RTCConfiguration: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ]
    }
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: 0,
};

// Add connection timeout
export const ICE_CONNECTION_TIMEOUT = 10000; // Increase timeout to 10 seconds

// Add connection checking
export const checkConnection = (pc: RTCPeerConnection): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'new') {
        console.log('ICE connection taking longer than expected, but continuing...');
        resolve(); // Don't reject, just continue
      }
    }, ICE_CONNECTION_TIMEOUT);

    pc.addEventListener('iceconnectionstatechange', function handler() {
      if (pc.iceConnectionState === 'connected' || 
          pc.iceConnectionState === 'completed' || 
          pc.iceConnectionState === 'checking') { // Allow checking state
        clearTimeout(timeout);
        pc.removeEventListener('iceconnectionstatechange', handler);
        resolve();
      }
    });
  });
};

// Add a function to validate TURN configuration
export const validateTurnConfig = async () => {
  if (!RTCConfiguration.iceServers) {
    console.error('No ICE servers configured');
    return false;
  }

  const turnServers = RTCConfiguration.iceServers.filter(server => 
    server.urls.toString().startsWith('turn:')
  );

  if (turnServers.length === 0) {
    console.error('No TURN servers configured');
    return false;
  }

  return true;
};

export const VERSION = '2024.0.3';

// Use the ALB URL for WebSocket connections
const WS_URL = process.env.REACT_APP_WS_URL || 'wss://k8s-secp-secpsign-8beb446f8f-1006806846.us-east-2.elb.amazonaws.com/ws';

export const getWebSocketURL = (roomId: string, userId?: string) => {
    // Convert http/https to ws/wss
    const wsBase = SIGNALING_SERVICE_URL.replace('http:', 'ws:').replace('https:', 'wss:');
    const url = new URL(`${wsBase}/ws`);
    url.searchParams.append('room_id', roomId);
    if (userId) {
        url.searchParams.append('user_id', userId);
    }
    return url.toString();
};