"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { api, AuthError } from "@/lib/api";
import { useAuthStore, useCryptoStore } from "@/stores";
import { cryptoService } from "@/crypto";

// Debug logging helper
const DEBUG_ECDH = true;
const logECDH = (...args: any[]) => {
  if (DEBUG_ECDH) {
    console.log("[ECDH]", ...args);
  }
};

export function useConversations() {
  const { isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.getConversations(),
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
    retry: (failureCount, error) => {
      // Never retry on auth errors
      if (error instanceof AuthError) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const createConversationMutation = useMutation({
    mutationFn: (data: {
      type: "direct" | "group" | "channel";
      name?: string;
      participantIds?: string[];
    }) => api.createConversation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  return {
    conversations: data?.conversations || [],
    isLoading,
    error,
    refetch,
    createConversation: createConversationMutation.mutate,
    isCreating: createConversationMutation.isPending,
  };
}

export function useMessages(conversationId: string | null) {
  const { isAuthenticated, user } = useAuthStore();
  const { status: encryptionStatus } = useCryptoStore();
  const queryClient = useQueryClient();

  const isEncryptionReady = encryptionStatus === "encrypted" && cryptoService.isInitialized();
  const currentUserId = user?.id;

  // Track if we've established sessions for this conversation
  const sessionsEstablishedRef = useRef<Set<string>>(new Set());
  const [sessionReady, setSessionReady] = useState(false);

  // Fetch participants for this conversation (needed for peer-based encryption)
  const {
    data: participantsData,
    isLoading: participantsLoading,
    isSuccess: participantsLoaded,
  } = useQuery({
    queryKey: ["participants", conversationId],
    queryFn: async () => {
      logECDH("Fetching participants for conversation:", conversationId);
      const result = await api.getParticipants(conversationId!);
      logECDH("Participants fetched:", result.participants?.length || 0, "participants");
      return result;
    },
    enabled: isAuthenticated && !!conversationId,
    staleTime: 60 * 1000, // Participants don't change often
    retry: (failureCount, error) => {
      if (error instanceof AuthError) {
        return false;
      }
      return failureCount < 2;
    },
  });

  // Get peer IDs (all participants except current user)
  const peerIds = useMemo(() => {
    if (!participantsData?.participants || !currentUserId) {
      logECDH("No participants or currentUserId:", {
        hasParticipants: !!participantsData?.participants,
        participantCount: participantsData?.participants?.length,
        currentUserId,
      });
      return [];
    }
    const peers = participantsData.participants
      .map((p) => p.user_id)
      .filter((id) => id !== currentUserId);
    logECDH("Computed peerIds:", peers.length, "peers for user:", currentUserId);
    return peers;
  }, [participantsData?.participants, currentUserId]);

  // Is this a 1:1 DM (true peer-to-peer encryption possible)?
  const isDM = peerIds.length === 1;

  // Track session establishment status
  const [sessionStatus, setSessionStatus] = useState<"pending" | "established" | "failed" | "unavailable">("pending");

  // Proactively establish ECDH sessions when a DM conversation is opened
  useEffect(() => {
    const establishSessions = async () => {
      // Wait for participants to load before making any decisions
      if (!participantsLoaded) {
        logECDH("Waiting for participants to load...");
        return;
      }

      if (!isEncryptionReady || !isDM || peerIds.length === 0) {
        logECDH("Skipping session establishment:", {
          isEncryptionReady,
          isDM,
          peerCount: peerIds.length,
          participantsLoaded,
          participantCount: participantsData?.participants?.length,
          currentUserId,
          participantUserIds: participantsData?.participants?.map((p) => p.user_id),
        });
        // Only mark as unavailable if participants ARE loaded and we still have no peers
        if (participantsLoaded && peerIds.length !== 1) {
          setSessionStatus("unavailable");
          setSessionReady(true);
        }
        return;
      }

      const peerId = peerIds[0];
      const sessionKey = `${conversationId}-${peerId}`;

      // Skip if already established in this session
      if (sessionsEstablishedRef.current.has(sessionKey)) {
        logECDH("Session already established for peer:", peerId);
        setSessionStatus("established");
        setSessionReady(true);
        return;
      }

      // Check if we already have a cached session
      if (cryptoService.hasCachedSession(peerId)) {
        logECDH("Using cached ECDH session for peer:", peerId);
        sessionsEstablishedRef.current.add(sessionKey);
        setSessionStatus("established");
        setSessionReady(true);
        return;
      }

      // Proactively establish ECDH session using the safe method
      logECDH("Proactively establishing ECDH session with peer:", peerId);
      setSessionStatus("pending");

      const result = await cryptoService.tryEstablishSession(peerId);

      if (result.success) {
        sessionsEstablishedRef.current.add(sessionKey);
        setSessionStatus("established");
        setSessionReady(true);
        logECDH("ECDH session established successfully with peer:", peerId);
      } else {
        setSessionStatus("failed");
        setSessionReady(true); // Still allow messaging (will fall back to legacy)
        logECDH("ECDH session failed, will use legacy mode. Reason:", result.error);
      }
    };

    establishSessions();
  }, [isEncryptionReady, isDM, peerIds, conversationId, participantsLoaded, participantsData?.participants, currentUserId]);

  // Reset session state when conversation changes
  useEffect(() => {
    setSessionReady(false);
    setSessionStatus("pending");
  }, [conversationId]);

  // Decrypt messages after fetching
  const decryptMessages = useCallback(
    async (messages: any[]): Promise<any[]> => {
      if (!conversationId) {
        return messages.map((m) => ({
          ...m,
          content: m.encrypted_content || m.content,
          encrypted: false,
          decryptionError: false,
        }));
      }

      return Promise.all(
        messages.map(async (message) => {
          // Handle unencrypted messages (encryption_version = 0)
          if (message.encryption_version === 0) {
            return {
              ...message,
              content: message.encrypted_content || message.content || "",
              encrypted: false,
              decryptionError: false,
            };
          }

          // Try to decrypt the message
          let contentToDecrypt = message.encrypted_content;

          // Handle potential double base64 encoding from Go backend
          try {
            const decoded = atob(message.encrypted_content);
            // Check if the decoded content looks like valid base64
            if (/^[A-Za-z0-9+/=]+$/.test(decoded) && decoded.length > 20) {
              contentToDecrypt = decoded;
            }
          } catch {
            // Not valid base64, use as-is
          }

          if (!isEncryptionReady) {
            // Encryption not ready - show placeholder
            return {
              ...message,
              content: "[Encrypted message - initializing...]",
              encrypted: true,
              decryptionError: false,
            };
          }

          try {
            // Determine the peer ID for ECDH decryption:
            // - If sender is a peer (not us): use sender's ID
            // - If sender is us (own message) in a DM: use the single peer's ID
            //   (message was encrypted with peer session key)
            const senderId = message.sender_id;
            let decryptPeerId: string | undefined = senderId;

            if (senderId === currentUserId && isDM && peerIds.length === 1) {
              // Own message in a DM - use the peer's session key
              decryptPeerId = peerIds[0];
              logECDH("Decrypting own message using peer session:", decryptPeerId);
            }

            const decryptedContent = await cryptoService.decryptMessage(
              conversationId,
              contentToDecrypt,
              decryptPeerId // Pass peer ID for proper ECDH key derivation
            );
            return {
              ...message,
              content: decryptedContent,
              encrypted: true,
              decryptionError: false,
            };
          } catch (error) {
            console.warn("[useMessages] Decryption failed:", error);
            // Decryption failed - try to show as-is or indicate error
            let content = message.encrypted_content;

            // Try to decode as plain base64 -> UTF-8 (for legacy plaintext)
            try {
              const decoded = atob(message.encrypted_content);
              if (/^[\x20-\x7E\s]+$/.test(decoded)) {
                content = decoded;
              }
            } catch {
              // Keep as-is
            }

            return {
              ...message,
              content: content || "[Could not decrypt message]",
              encrypted: false,
              decryptionError: true,
            };
          }
        })
      );
    },
    [conversationId, isEncryptionReady]
  );

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["messages", conversationId, isEncryptionReady],
    queryFn: async () => {
      const response = await api.getMessages(conversationId!);
      // Decrypt messages before returning
      const decryptedMessages = await decryptMessages(response.messages);
      return { messages: decryptedMessages };
    },
    enabled: isAuthenticated && !!conversationId,
    staleTime: 0, // Always refetch for real-time feel
    retry: (failureCount, error) => {
      if (error instanceof AuthError) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (messageData: { content: string; encrypted?: boolean }) => {
      // Log current state for debugging
      logECDH("Sending message - Current state:", {
        isEncryptionReady,
        participantsLoaded,
        participantsLoading,
        peerCount: peerIds.length,
        peerIds: peerIds,
        isDM,
        sessionReady,
        sessionStatus,
        currentUserId,
      });

      // Always encrypt if encryption is ready
      if (isEncryptionReady && conversationId) {
        try {
          // For 1:1 DMs with established sessions, use ECDH
          // Otherwise fall back to legacy mode
          const useP2P = isDM && peerIds.length === 1 && sessionStatus === "established";

          logECDH("Encryption decision:", {
            useP2P,
            isDM,
            hasPeers: peerIds.length > 0,
            sessionReady,
            sessionStatus,
            mode: useP2P ? "p2p" : "legacy",
          });

          // Pass peer IDs for proper ECDH encryption
          // For 1:1 DMs, this enables true zero-trust encryption
          const encryptedContent = await cryptoService.encryptMessage(
            conversationId,
            messageData.content,
            useP2P ? peerIds : undefined // Only pass peerIds for P2P mode
          );

          console.log("[useMessages] Sending encrypted message", {
            isDM,
            peerCount: peerIds.length,
            secureMode: useP2P ? "p2p" : "legacy",
            sessionStatus,
          });

          return api.sendMessage(conversationId, {
            content: encryptedContent,
            encrypted: true,
          });
        } catch (error) {
          console.error("[useMessages] Encryption failed, sending as plaintext:", error);
        }
      }

      // Fallback to plaintext if encryption fails or not ready
      console.log("[useMessages] Sending plaintext message");
      return api.sendMessage(conversationId!, {
        content: messageData.content,
        encrypted: false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
    },
  });

  // Transform messages for display
  const messages = useMemo(() => {
    return (data?.messages || []).map((m: any) => ({
      id: m.id,
      content: m.content,
      senderId: m.sender_id,
      senderName: m.sender_name || "Unknown",
      timestamp: m.created_at,
      roomId: conversationId,
      encrypted: m.encrypted,
      decryptionError: m.decryptionError,
    }));
  }, [data?.messages, conversationId]);

  return {
    messages,
    isLoading,
    error,
    refetch,
    sendMessage: sendMessageMutation.mutate,
    isSending: sendMessageMutation.isPending,
    isEncrypted: isEncryptionReady,
    isDM, // Expose whether this is a true P2P encrypted DM
    peerIds, // Expose peer IDs for debugging/display
    sessionReady, // Expose whether ECDH session is ready (any state that allows messaging)
    sessionStatus, // Expose detailed session status: pending | established | failed | unavailable
    participantsLoading, // Expose participants loading state
    participantsLoaded, // Expose whether participants are loaded
    isP2PReady: isDM && sessionStatus === "established", // True zero-trust P2P ready
  };
}
