"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuthStore } from "@/stores";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const WS_URL = API_URL.replace(/^http/, "ws");

interface PeerConnection {
  peerId: string;
  connection: RTCPeerConnection;
  stream?: MediaStream;
}

interface MeetingState {
  isConnected: boolean;
  isInitiator: boolean;
  userCount: number;
  peers: string[];
  error: string | null;
}

export function useMeeting(roomId: string) {
  const { token } = useAuthStore();
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [state, setState] = useState<MeetingState>({
    isConnected: false,
    isInitiator: false,
    userCount: 0,
    peers: [],
    error: null,
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, PeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const myPeerIdRef = useRef<string | null>(null);

  // Get ICE servers from backend
  const getIceServers = useCallback(async (): Promise<RTCIceServer[]> => {
    try {
      const response = await fetch(`${API_URL}/api/ice-servers`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json();
      return data.iceServers || [{ urls: "stun:stun.l.google.com:19302" }];
    } catch {
      return [{ urls: "stun:stun.l.google.com:19302" }];
    }
  }, [token]);

  // Create peer connection
  const createPeerConnection = useCallback(async (peerId: string): Promise<RTCPeerConnection> => {
    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "iceCandidate",
          roomId,
          content: {
            targetPeerID: peerId,
            candidate: event.candidate.toJSON(),
          },
        }));
      }
    };

    // Handle remote tracks
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        setRemoteStreams((prev) => {
          const updated = new Map(prev);
          updated.set(peerId, remoteStream);
          return updated;
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`[Meeting] Peer ${peerId.slice(0, 8)} connection state:`, pc.connectionState);
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setRemoteStreams((prev) => {
          const updated = new Map(prev);
          updated.delete(peerId);
          return updated;
        });
      }
    };

    peerConnectionsRef.current.set(peerId, { peerId, connection: pc });
    return pc;
  }, [roomId, getIceServers]);

  // Handle WebSocket messages
  const handleMessage = useCallback(async (event: MessageEvent) => {
    const msg = JSON.parse(event.data);
    console.log("[Meeting] WS message:", msg.type);

    switch (msg.type) {
      case "userID":
        myPeerIdRef.current = msg.content;
        break;

      case "initiatorStatus":
        setState((prev) => ({ ...prev, isInitiator: msg.content }));
        break;

      case "userCount":
        setState((prev) => ({ ...prev, userCount: msg.content }));
        break;

      case "userList":
        setState((prev) => ({ ...prev, peers: msg.content.users || [] }));
        break;

      case "createOffer":
        // We need to create offers to specified peers
        const targetPeers = msg.content?.peers || [];
        for (const peerId of targetPeers) {
          const pc = await createPeerConnection(peerId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          wsRef.current?.send(JSON.stringify({
            type: "offer",
            roomId,
            content: {
              targetPeerID: peerId,
              sdp: offer,
            },
          }));
        }
        break;

      case "offer":
        // Received an offer, create answer
        const offerFromPeerId = msg.content.fromPeerID;
        let pc = peerConnectionsRef.current.get(offerFromPeerId)?.connection;
        if (!pc) {
          pc = await createPeerConnection(offerFromPeerId);
        }
        await pc.setRemoteDescription(new RTCSessionDescription(msg.content.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        wsRef.current?.send(JSON.stringify({
          type: "answer",
          roomId,
          content: {
            targetPeerID: offerFromPeerId,
            sdp: answer,
          },
        }));
        break;

      case "answer":
        // Received an answer
        const answerFromPeerId = msg.content.fromPeerId;
        const answerPc = peerConnectionsRef.current.get(answerFromPeerId)?.connection;
        if (answerPc) {
          await answerPc.setRemoteDescription(new RTCSessionDescription(msg.content.sdp));
        }
        break;

      case "iceCandidate":
        // Received ICE candidate
        const icePeerId = msg.content.fromPeerId;
        const icePc = peerConnectionsRef.current.get(icePeerId)?.connection;
        if (icePc && msg.content.candidate) {
          await icePc.addIceCandidate(new RTCIceCandidate(msg.content.candidate));
        }
        break;

      case "startMeeting":
        // Meeting started by initiator
        console.log("[Meeting] Meeting started");
        break;
    }
  }, [createPeerConnection, roomId]);

  // Initialize media and WebSocket
  const connect = useCallback(async () => {
    try {
      // Get local media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Get the latest user from store (synchronous, always up-to-date)
      const currentUser = useAuthStore.getState().user;

      if (!currentUser?.id) {
        throw new Error("User not authenticated. Please sign in first.");
      }

      // Connect WebSocket
      const wsUrl = `${WS_URL}/api/signaling?user_id=${currentUser.id}&room_id=${roomId}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("[Meeting] WebSocket connected");
        setState((prev) => ({ ...prev, isConnected: true, error: null }));
      };

      ws.onmessage = handleMessage;

      ws.onerror = (error) => {
        console.error("[Meeting] WebSocket error:", error);
        setState((prev) => ({ ...prev, error: "Connection error" }));
      };

      ws.onclose = () => {
        console.log("[Meeting] WebSocket closed");
        setState((prev) => ({ ...prev, isConnected: false }));
      };

      wsRef.current = ws;
    } catch (error) {
      console.error("[Meeting] Failed to initialize:", error);
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Failed to access camera/microphone",
      }));
    }
  }, [roomId, handleMessage]);

  // Disconnect and cleanup
  const disconnect = useCallback(() => {
    // Close peer connections
    peerConnectionsRef.current.forEach(({ connection }) => {
      connection.close();
    });
    peerConnectionsRef.current.clear();

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    setLocalStream(null);
    setRemoteStreams(new Map());
    setState({
      isConnected: false,
      isInitiator: false,
      userCount: 0,
      peers: [],
      error: null,
    });
  }, []);

  // Start the meeting (initiator only)
  const startMeeting = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "startMeeting",
        roomId,
        content: {},
      }));
    }
  }, [roomId]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!audioTracks[0]?.enabled);
    }
  }, []);

  // Toggle video
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!videoTracks[0]?.enabled);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    localStream,
    remoteStreams,
    state,
    isMuted,
    isVideoOff,
    connect,
    disconnect,
    startMeeting,
    toggleMute,
    toggleVideo,
  };
}
