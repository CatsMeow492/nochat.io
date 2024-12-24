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
}

export interface IceCandidateContent {
  candidate: RTCIceCandidate;
  from?: string;      // Add this
  target?: string;    // Add this
  targetPeerId?: string;
  targetPeerID?: string;
  fromPeerId?: string;
  fromPeerID?: string;
}

export interface PeerTrackStatus {
    audio: boolean;
    video: boolean;
}

export interface PeerConnection {
    id: string;
    connection: RTCPeerConnection;
    trackStatus: PeerTrackStatus;
    stream?: MediaStream;
    connected: boolean;
    negotiationNeeded: boolean;
}