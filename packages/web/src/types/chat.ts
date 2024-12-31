export interface ChatMessage {
  content: string;
  sender: string;
  senderName: string;
  timestamp: number;
  roomId: string;
}

export interface WebRTCState {
  isInitiator: boolean;
  isPeerConnectionReady: boolean;
  isNegotiating: boolean;
  meetingStarted: boolean;
  hasEstablishedConnection: boolean;
  userId: string | null;
  messages: ChatMessage[];
  mediaReady: boolean;
  pendingPeers: string[];
  offerQueue: Map<string, RTCSessionDescription>;
  localStream: MediaStream | null;
  peerConnections: Map<string, PeerConnection>;
  iceCandidateQueue: Map<string, RTCIceCandidate[]>;
  rtcConfig: RTCConfiguration;
  activePeers: Set<string>;
  remoteStreams: Map<string, MediaStream>;
}

export interface MessageHandlerDependencies {
  log: (message: string) => void;
  sendMessage: (type: string, content: any) => void;
  peerConnections: Map<string, PeerConnection>;
  getState: () => WebRTCState;
  setState: {
    setMeetingStarted: (value: boolean) => void;
    setIsNegotiating: (value: boolean) => void;
    setHasEstablishedConnection: (value: boolean) => void;
    setIsInitiator: (value: boolean) => void;
    setUserId: (value: string | null) => void;
    setMessages: (messages: ChatMessage[]) => void;
    setPendingPeers: (peers: string[]) => void;
    setOfferQueue: (queue: Map<string, RTCSessionDescription>) => void;
    setLocalStream: (stream: MediaStream | null) => void;
    setIceCandidateQueue: (queue: Map<string, RTCIceCandidate[]>) => void;
    setActivePeers: (peers: Set<string>) => void;
    setRemoteStreams: (streams: Map<string, MediaStream>) => void;
    setRtcConfig: (config: RTCConfiguration) => void;
  };
  summarizeSDP: (sdp: string) => any;
  setWindowState: (state: string) => void;
  queuedCandidates: Map<string, RTCIceCandidateInit[]>;
  renegotiatePeerConnection: (peerId: string) => void;
  activePeers: Set<string>;
  checkPeerConnections: (peerIds: string[]) => void;
  iceServers: RTCIceServer[];
}

export interface WebSocketMessage {
  type: string;
  content: any;
  room_id?: string;
}

export type VideoPlayError = DOMException | Error;

export interface VideoElementHandlerProps {
  peerId: string;
  stream: MediaStream;
  onError?: (error: VideoPlayError) => void;
}

export interface RemoteVideoProps {
  peerId: string;
  stream: MediaStream;
  onError?: (error: Error) => void;
}

export interface AnswerContent {
    sdp: RTCSessionDescription;
    fromPeerId?: string;
    fromPeerID?: string;
    targetPeerId?: string;
    targetPeerID?: string;
} 

export interface OfferContent {
  sdp: RTCSessionDescription;
  fromPeerId?: string;
  fromPeerID?: string;
  targetPeerId?: string;
  targetPeerID?: string;
  fromPeer?: string;
}

export interface IceCandidateContent {
    candidate: RTCIceCandidate;
    fromPeerId?: string;    // Preferred
    fromPeerID?: string;    // Legacy support
    targetPeerId?: string;  // Preferred
    targetPeerID?: string;  // Legacy support
}

export interface PeerTrackStatus {
    audio: boolean;
    video: boolean;
}

export interface TrackReadyState {
    audio?: {
        track: MediaStreamTrack;
        ready: boolean;
        timestamp: number;
    };
    video?: {
        track: MediaStreamTrack;
        ready: boolean;
        timestamp: number;
    };
}

export enum PeerConnectionState {
    NEW = 'new',                    // Initial state
    CONNECTING = 'connecting',      // Offer/Answer exchange started
    CONNECTED = 'connected',        // ICE connection established
    READY = 'ready',               // Media tracks received and ready
    FAILED = 'failed',             // Connection failed
    CLOSED = 'closed',             // Connection closed
    OFFER_RECEIVED = 'offer_received',    // Received offer, waiting for answer
    ANSWER_RECEIVED = 'answer_received'   // Received answer, ready for ICE
}

export interface PeerConnection {
    id: string;
    connection: RTCPeerConnection;
    connectionState: PeerConnectionState;
    trackStatus: PeerTrackStatus;
    trackReadyState: TrackReadyState;
    stream: MediaStream | null;
    negotiationNeeded: boolean;
    lastTrackUpdate: number;      // Timestamp of last track update
    retryCount: number;           // Number of connection retry attempts
    iceRetryCount: number;        // Number of ICE retry attempts
}

// Helper function to create a new PeerConnection object with default values
export const createPeerConnection = (
    id: string, 
    connection: RTCPeerConnection
): PeerConnection => ({
    id,
    connection,
    connectionState: PeerConnectionState.NEW,
    trackStatus: { audio: false, video: false },
    trackReadyState: { audio: undefined, video: undefined },
    stream: null,
    negotiationNeeded: false,
    lastTrackUpdate: Date.now(),
    retryCount: 0,
    iceRetryCount: 0
});