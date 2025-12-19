"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuthStore } from "@/stores";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const WS_URL = API_URL.replace(/^http/, "ws");

interface MeetingState {
  isConnected: boolean;
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
    userCount: 0,
    peers: [],
    error: null,
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const myPeerIdRef = useRef<string | null>(null);
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

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

  // Create peer connection for a specific peer
  const createPeerConnection = useCallback(async (peerId: string): Promise<RTCPeerConnection> => {
    // Check if we already have a connection
    const existing = peerConnectionsRef.current.get(peerId);
    if (existing && existing.connectionState !== "closed" && existing.connectionState !== "failed") {
      return existing;
    }

    console.log(`[Meeting] Creating peer connection to ${peerId.slice(0, 8)}`);
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
        console.log(`[Meeting] Sending ICE candidate to ${peerId.slice(0, 8)}`);
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
      console.log(`[Meeting] Received track from ${peerId.slice(0, 8)}`);
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
      if (pc.connectionState === "connected") {
        console.log(`[Meeting] Successfully connected to ${peerId.slice(0, 8)}`);
      }
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
        // Clean up disconnected peer
        peerConnectionsRef.current.delete(peerId);
        setRemoteStreams((prev) => {
          const updated = new Map(prev);
          updated.delete(peerId);
          return updated;
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Meeting] Peer ${peerId.slice(0, 8)} ICE state:`, pc.iceConnectionState);
    };

    peerConnectionsRef.current.set(peerId, pc);

    // Apply any pending ICE candidates
    const pending = pendingCandidatesRef.current.get(peerId);
    if (pending) {
      console.log(`[Meeting] Applying ${pending.length} pending ICE candidates for ${peerId.slice(0, 8)}`);
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn(`[Meeting] Failed to add pending ICE candidate:`, err);
        }
      }
      pendingCandidatesRef.current.delete(peerId);
    }

    return pc;
  }, [roomId, getIceServers]);

  // Create an offer and send it to a peer
  const createAndSendOffer = useCallback(async (peerId: string) => {
    try {
      console.log(`[Meeting] Creating offer for ${peerId.slice(0, 8)}`);
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
      console.log(`[Meeting] Sent offer to ${peerId.slice(0, 8)}`);
    } catch (err) {
      console.error(`[Meeting] Failed to create offer for ${peerId.slice(0, 8)}:`, err);
    }
  }, [createPeerConnection, roomId]);

  // Handle WebSocket messages
  const handleMessage = useCallback(async (event: MessageEvent) => {
    const msg = JSON.parse(event.data);
    console.log("[Meeting] WS message:", msg.type, msg.content);

    switch (msg.type) {
      case "userID":
        myPeerIdRef.current = msg.content;
        console.log(`[Meeting] My peer ID: ${msg.content.slice(0, 8)}`);
        break;

      case "userCount":
        setState((prev) => ({ ...prev, userCount: msg.content }));
        break;

      case "userList": {
        const users: string[] = msg.content.users || [];
        setState((prev) => ({ ...prev, peers: users }));

        // Mesh networking: connect to all peers we don't have connections to
        // Use sorted IDs to determine who initiates (lower ID creates offer)
        const myId = myPeerIdRef.current;
        if (!myId) break;

        for (const peerId of users) {
          if (peerId === myId) continue;

          // Check if we already have a connection
          const existingPc = peerConnectionsRef.current.get(peerId);
          if (existingPc && existingPc.connectionState !== "closed" && existingPc.connectionState !== "failed") {
            continue;
          }

          // Lower ID creates the offer to avoid duplicate connections
          if (myId < peerId) {
            console.log(`[Meeting] I will create offer to ${peerId.slice(0, 8)} (my ID is lower)`);
            // Small delay to ensure both sides are ready
            setTimeout(() => createAndSendOffer(peerId), 500);
          } else {
            console.log(`[Meeting] Waiting for offer from ${peerId.slice(0, 8)} (their ID is lower)`);
          }
        }
        break;
      }

      case "offer": {
        // Received an offer, create answer
        const fromPeerId = msg.content.fromPeerID;
        console.log(`[Meeting] Received offer from ${fromPeerId?.slice(0, 8)}`);

        if (!fromPeerId) {
          console.error("[Meeting] Offer missing fromPeerID");
          break;
        }

        try {
          const pc = await createPeerConnection(fromPeerId);
          await pc.setRemoteDescription(new RTCSessionDescription(msg.content.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          wsRef.current?.send(JSON.stringify({
            type: "answer",
            roomId,
            content: {
              targetPeerID: fromPeerId,
              sdp: answer,
            },
          }));
          console.log(`[Meeting] Sent answer to ${fromPeerId.slice(0, 8)}`);
        } catch (err) {
          console.error(`[Meeting] Failed to handle offer from ${fromPeerId?.slice(0, 8)}:`, err);
        }
        break;
      }

      case "answer": {
        // Received an answer
        const fromPeerId = msg.content.fromPeerId || msg.content.fromPeerID;
        console.log(`[Meeting] Received answer from ${fromPeerId?.slice(0, 8)}`);

        if (!fromPeerId) {
          console.error("[Meeting] Answer missing fromPeerId");
          break;
        }

        const pc = peerConnectionsRef.current.get(fromPeerId);
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.content.sdp));
            console.log(`[Meeting] Set remote description from ${fromPeerId.slice(0, 8)}`);
          } catch (err) {
            console.error(`[Meeting] Failed to set remote description:`, err);
          }
        } else {
          console.warn(`[Meeting] No peer connection for answer from ${fromPeerId?.slice(0, 8)}`);
        }
        break;
      }

      case "iceCandidate": {
        // Received ICE candidate
        const fromPeerId = msg.content.fromPeerId || msg.content.fromPeerID;
        const candidate = msg.content.candidate;

        if (!fromPeerId || !candidate) {
          console.warn("[Meeting] ICE candidate missing data");
          break;
        }

        console.log(`[Meeting] Received ICE candidate from ${fromPeerId.slice(0, 8)}`);

        const pc = peerConnectionsRef.current.get(fromPeerId);
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.warn(`[Meeting] Failed to add ICE candidate:`, err);
          }
        } else {
          // Queue the candidate for later
          console.log(`[Meeting] Queueing ICE candidate for ${fromPeerId.slice(0, 8)}`);
          const pending = pendingCandidatesRef.current.get(fromPeerId) || [];
          pending.push(candidate);
          pendingCandidatesRef.current.set(fromPeerId, pending);
        }
        break;
      }

      // Legacy message types (for compatibility)
      case "initiatorStatus":
      case "createOffer":
      case "startMeeting":
        // Ignore these - mesh networking handles connections automatically
        break;

      default:
        console.log(`[Meeting] Unknown message type: ${msg.type}`);
    }
  }, [createPeerConnection, createAndSendOffer, roomId]);

  // Initialize media and WebSocket
  const connect = useCallback(async (optionalUserId?: string) => {
    try {
      // Get local media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Use provided userId or get from store
      const userId = optionalUserId || useAuthStore.getState().user?.id;

      if (!userId) {
        throw new Error("User not authenticated. Please sign in first.");
      }

      // Connect WebSocket
      const wsUrl = `${WS_URL}/api/signaling?user_id=${userId}&room_id=${roomId}`;
      console.log(`[Meeting] Connecting to ${wsUrl}`);
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
    peerConnectionsRef.current.forEach((pc) => {
      pc.close();
    });
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();

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
      userCount: 0,
      peers: [],
      error: null,
    });
  }, []);

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
    toggleMute,
    toggleVideo,
  };
}
