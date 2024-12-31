import { create } from 'zustand';
import { PeerConnectionState } from '../types/chat';

interface Track {
  track: MediaStreamTrack;
  stream: MediaStream;
  enabled: boolean;
}

interface PeerTracks {
  audio?: Track;
  video?: Track;
}

interface MediaState {
  // Local media state
  localStream: MediaStream | null;
  mediaReady: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;

  // Remote peers' media state
  peerTracks: Map<string, PeerTracks>;
  
  // Actions for local media
  setLocalStream: (stream: MediaStream | null) => void;
  setMediaReady: (ready: boolean) => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  
  // Actions for remote peers
  addPeerTrack: (peerId: string, track: MediaStreamTrack, stream: MediaStream) => void;
  removePeerTrack: (peerId: string, track: MediaStreamTrack) => void;
  removePeer: (peerId: string) => void;
  
  // Cleanup
  cleanup: () => void;

  // Connection states
  peerConnectionStates: Map<string, {
    connectionState: PeerConnectionState;
    trackStatus: {
      audio: boolean;
      video: boolean;
    };
    lastTrackUpdate: number;
  }>;

  // Add actions
  updatePeerState: (peerId: string, state: PeerConnectionState) => void;
  updateTrackStatus: (peerId: string, kind: 'audio' | 'video', ready: boolean) => void;
}

export const useMediaStore = create<MediaState>()((set, get) => ({
  // Initial state
  localStream: null,
  mediaReady: false,
  audioEnabled: true,
  videoEnabled: true,
  peerTracks: new Map(),
  peerConnectionStates: new Map(),

  // Local media actions
  setLocalStream: (stream: MediaStream | null) => {
    const currentStream = get().localStream;
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
    }
    set({ localStream: stream });
  },

  setMediaReady: (ready: boolean) => set({ mediaReady: ready }),

  toggleAudio: () => {
    const { localStream } = get();
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        set({ audioEnabled: audioTrack.enabled });
      }
    }
  },

  toggleVideo: () => {
    const { localStream } = get();
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        set({ videoEnabled: videoTrack.enabled });
      }
    }
  },

  // Remote peer actions
  addPeerTrack: (peerId: string, track: MediaStreamTrack, stream: MediaStream) => {
    const peerTracks = new Map(get().peerTracks);
    const currentPeerTracks = peerTracks.get(peerId) || {};
    
    peerTracks.set(peerId, {
      ...currentPeerTracks,
      [track.kind]: { track, stream, enabled: true }
    });
    
    set({ peerTracks });
  },

  removePeerTrack: (peerId: string, track: MediaStreamTrack) => {
    const peerTracks = new Map(get().peerTracks);
    const currentPeerTracks = peerTracks.get(peerId);
    
    if (currentPeerTracks) {
      const { [track.kind as keyof PeerTracks]: removed, ...remaining } = currentPeerTracks;
      if (Object.keys(remaining).length === 0) {
        peerTracks.delete(peerId);
      } else {
        peerTracks.set(peerId, remaining);
      }
      set({ peerTracks });
    }
  },

  removePeer: (peerId: string) => {
    const peerTracks = new Map(get().peerTracks);
    peerTracks.delete(peerId);
    set({ peerTracks });
  },

  updatePeerState: (peerId, state) => {
    const states = new Map(get().peerConnectionStates);
    const current = states.get(peerId) || {
      connectionState: PeerConnectionState.NEW,
      trackStatus: { audio: false, video: false },
      lastTrackUpdate: Date.now()
    };
    states.set(peerId, { ...current, connectionState: state });
    set({ peerConnectionStates: states });
  },

  updateTrackStatus: (peerId, kind, ready) => {
    const states = new Map(get().peerConnectionStates);
    const current = states.get(peerId) || {
      connectionState: PeerConnectionState.NEW,
      trackStatus: { audio: false, video: false },
      lastTrackUpdate: Date.now()
    };
    current.trackStatus[kind] = ready;
    current.lastTrackUpdate = Date.now();
    states.set(peerId, current);
    set({ peerConnectionStates: states });
  },

  cleanup: () => {
    const { localStream, peerTracks } = get();
    
    // Cleanup local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    // Cleanup peer tracks
    peerTracks.forEach(tracks => {
      Object.values(tracks).forEach(({ track }) => track.stop());
    });
    
    set({
      localStream: null,
      mediaReady: false,
      audioEnabled: true,
      videoEnabled: true,
      peerTracks: new Map(),
      peerConnectionStates: new Map()
    });
  }
})); 