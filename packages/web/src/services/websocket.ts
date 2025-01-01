import { WebRTCState } from "../types/chat";

class WebSocketService {
  private socket: WebSocket | null = null;
  private subscribers = new Map<string, Set<(data: any) => void>>();
  private reconnectTimeout: number | null = null;
  private isConnected = false;
  private lastMessageTimestamps = new Map<string, number>();
  private readonly DEDUPE_INTERVAL = 1000; // 1 second
  private state: WebRTCState = {
    isInitiator: false,
    isPeerConnectionReady: false,
    isNegotiating: false,
    meetingStarted: false,
    hasEstablishedConnection: false,
    userId: null,
    messages: [],
    mediaReady: false,
    pendingPeers: [],
    offerQueue: new Map(),
    localStream: null,
    peerConnections: new Map(),
    iceCandidateQueue: new Map(),
    rtcConfig: {},
    activePeers: new Set(),
    remoteStreams: new Map()
  };
  private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' } // Default STUN server
  ];

  private shouldProcessMessage(type: string): boolean {
    const now = Date.now();
    const lastTimestamp = this.lastMessageTimestamps.get(type);
    
    // Always process if no recent message of this type
    if (!lastTimestamp) {
      this.lastMessageTimestamps.set(type, now);
      return true;
    }

    // Check if enough time has passed since last message
    if (now - lastTimestamp > this.DEDUPE_INTERVAL) {
      this.lastMessageTimestamps.set(type, now);
      return true;
    }

    console.log(`[WebSocketService] Deduplicating ${type} message`);
    return false;
  }

  setSocket(socket: WebSocket | null) {
    console.log('[WebSocketService] Setting socket:', socket ? 'new socket' : 'null');
    
    if (this.socket) {
      console.log('[WebSocketService] Closing existing socket connection');
      this.socket.close();
      this.clearSubscribers();
    }

    this.socket = socket;
    this.isConnected = socket !== null;
    this.lastMessageTimestamps.clear(); // Clear deduplication state on new socket

    if (socket) {
      socket.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Deduplicate certain message types
          if (['startMeeting', 'userList'].includes(message.type) && !this.shouldProcessMessage(message.type)) {
            return;
          }

          console.log('[WebSocketService] Processing message:', {
            type: message.type,
            content: message.content
          });
          
          // Update internal state based on message type
          switch (message.type) {
            case 'userID':
              this.state.userId = message.content;
              break;
            case 'initiatorStatus':
              this.state.isInitiator = message.content === true || message.content === 'true';
              break;
            case 'userList':
              if (message.content && Array.isArray(message.content.users)) {
                this.state.activePeers = new Set(message.content.users);
                console.log('[WebSocketService] Updated active peers:', message.content.users);
              }
              break;
            case 'startMeeting':
              if (!this.state.meetingStarted) {
                this.state.meetingStarted = true;
                console.log('[WebSocketService] Meeting started');
              }
              break;
          }
          
          // Notify subscribers
          this.notifySubscribers(message.type, message.content);
          this.notifySubscribers('message', message);
          this.notifySubscribers('stateChange', this.state);
        } catch (error) {
          console.error('[WebSocketService] Error handling message:', error);
        }
      };

      socket.onclose = () => {
        this.isConnected = false;
        this.notifySubscribers('connectionState', { connected: false });
      };

      socket.onopen = () => {
        this.isConnected = true;
        this.notifySubscribers('connectionState', { connected: true });
      };
    }
  }

  send(type: string, content: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket is not connected. Message not sent:', type);
      return false;
    }

    try {
      this.socket.send(JSON.stringify({ type, content }));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }

  subscribe(type: string, callback: (data: any) => void) {
    if (!this.subscribers.has(type)) {
      this.subscribers.set(type, new Set());
    }
    this.subscribers.get(type)?.add(callback);
    
    // If subscribing to state changes, immediately send current state
    if (type === 'stateChange') {
      callback(this.state);
    }
    
    return () => this.subscribers.get(type)?.delete(callback);
  }

  private notifySubscribers(type: string, data: any) {
    this.subscribers.get(type)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in subscriber callback:', error);
      }
    });
  }

  private clearSubscribers() {
    this.subscribers.clear();
  }

  isSocketConnected(): boolean {
    return this.isConnected && this.socket?.readyState === WebSocket.OPEN;
  }

  getSocket(): WebSocket | null {
    return this.socket;
  }

  getState(): WebRTCState {
    return this.state;
  }

  setState(newState: Partial<WebRTCState>) {
    this.state = { ...this.state, ...newState };
    this.notifySubscribers('stateChange', this.state);
  }

  setIceServers(servers: RTCIceServer[]) {
    if (!Array.isArray(servers) || servers.length === 0) {
      console.warn('[WebSocketService] Invalid ICE servers provided, keeping existing configuration');
      return;
    }
    console.log('[WebSocketService] Updating ICE servers:', servers);
    this.iceServers = servers;
    this.state.rtcConfig = {
      ...this.state.rtcConfig,
      iceServers: servers
    };
    this.notifySubscribers('stateChange', this.state);
  }

  getIceServers(): RTCIceServer[] {
    return this.iceServers;
  }

  cleanup() {
    const userId = localStorage.getItem('userId');
    // Remove temporary user IDs on cleanup
    if (userId?.startsWith('anon_')) {
      localStorage.removeItem('userId');
    }
    this.setSocket(null);
  }
}

export default new WebSocketService(); 