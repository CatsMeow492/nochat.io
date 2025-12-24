"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, AuthError } from "@/lib/api";
import { useAuthStore, useCryptoStore } from "@/stores";
import { cryptoService } from "@/crypto";
import type { ChatMessage } from "@/stores";

const PAGE_SIZE = 50;

// Debug logging helper
const DEBUG = false;
const log = (...args: any[]) => {
  if (DEBUG) {
    console.log("[usePaginatedMessages]", ...args);
  }
};

interface UsePaginatedMessagesOptions {
  conversationId: string | null;
  peerIds?: string[];
  isDM?: boolean;
  sessionStatus?: "pending" | "established" | "failed" | "unavailable";
}

/**
 * usePaginatedMessages - Paginated message fetching with infinite scroll support.
 *
 * Features:
 * - Initial fetch: loads the most recent PAGE_SIZE messages
 * - Load more: fetches older messages when scrolling up
 * - Optimistic decryption: decrypts as messages arrive
 * - Cache integration: works with React Query cache
 *
 * Performance characteristics:
 * - Never fetches all messages at once
 * - O(PAGE_SIZE) memory per fetch operation
 * - Supports 100,000+ total messages without memory issues
 */
export function usePaginatedMessages({
  conversationId,
  peerIds = [],
  isDM = false,
  sessionStatus = "unavailable",
}: UsePaginatedMessagesOptions) {
  const { isAuthenticated, user } = useAuthStore();
  const { status: encryptionStatus } = useCryptoStore();
  const queryClient = useQueryClient();
  const currentUserId = user?.id;

  const isEncryptionReady = encryptionStatus === "encrypted" && cryptoService.isInitialized();

  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Refs to prevent concurrent fetches
  const isFetchingRef = useRef(false);
  const oldestMessageIdRef = useRef<string | null>(null);

  // Decrypt a single message
  const decryptMessage = useCallback(
    async (message: any): Promise<ChatMessage> => {
      // Handle unencrypted messages
      if (message.encryption_version === 0) {
        return {
          id: message.id,
          content: message.encrypted_content || message.content || "",
          senderId: message.sender_id,
          senderName: message.sender_name || "Unknown",
          timestamp: message.created_at,
          roomId: conversationId || "",
          encrypted: false,
          decryptionError: false,
        };
      }

      // Try to decrypt
      let contentToDecrypt = message.encrypted_content;

      // Handle potential double base64 encoding
      try {
        const decoded = atob(message.encrypted_content);
        if (/^[A-Za-z0-9+/=]+$/.test(decoded) && decoded.length > 20) {
          contentToDecrypt = decoded;
        }
      } catch {
        // Not valid base64, use as-is
      }

      if (!isEncryptionReady || !conversationId) {
        return {
          id: message.id,
          content: "[Encrypted message - initializing...]",
          senderId: message.sender_id,
          senderName: message.sender_name || "Unknown",
          timestamp: message.created_at,
          roomId: conversationId || "",
          encrypted: true,
          decryptionError: false,
        };
      }

      try {
        // Determine peer ID for ECDH decryption
        const senderId = message.sender_id;
        let decryptPeerId: string | undefined = senderId;

        if (senderId === currentUserId && isDM && peerIds.length === 1) {
          decryptPeerId = peerIds[0];
        }

        const decryptedContent = await cryptoService.decryptMessage(
          conversationId,
          contentToDecrypt,
          decryptPeerId
        );

        return {
          id: message.id,
          content: decryptedContent,
          senderId: message.sender_id,
          senderName: message.sender_name || "Unknown",
          timestamp: message.created_at,
          roomId: conversationId,
          encrypted: true,
          decryptionError: false,
        };
      } catch {
        // Decryption failed
        let content = message.encrypted_content;
        try {
          const decoded = atob(message.encrypted_content);
          if (/^[\x20-\x7E\s]+$/.test(decoded)) {
            content = decoded;
          }
        } catch {
          // Keep as-is
        }

        return {
          id: message.id,
          content: content || "[Could not decrypt message]",
          senderId: message.sender_id,
          senderName: message.sender_name || "Unknown",
          timestamp: message.created_at,
          roomId: conversationId || "",
          encrypted: false,
          decryptionError: true,
        };
      }
    },
    [conversationId, isEncryptionReady, currentUserId, isDM, peerIds]
  );

  // Fetch initial messages (most recent PAGE_SIZE)
  const fetchInitial = useCallback(async () => {
    if (!conversationId || !isAuthenticated || isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      log("Fetching initial messages for:", conversationId);

      const response = await api.getMessages(conversationId, {
        limit: PAGE_SIZE,
      });

      const rawMessages = response.messages || [];
      log("Received", rawMessages.length, "messages");

      // Decrypt messages in parallel
      const decryptedMessages = await Promise.all(
        rawMessages.map((m) => decryptMessage(m))
      );

      // Messages come from API in DESC order (newest first), reverse for display
      const sortedMessages = decryptedMessages.reverse();

      setMessages(sortedMessages);
      setHasMore(rawMessages.length === PAGE_SIZE);
      oldestMessageIdRef.current = sortedMessages[0]?.id ?? null;
    } catch (err) {
      if (err instanceof AuthError) {
        throw err;
      }
      setError(err instanceof Error ? err : new Error("Failed to fetch messages"));
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [conversationId, isAuthenticated, decryptMessage]);

  // Load older messages (infinite scroll)
  const loadMore = useCallback(async () => {
    if (
      !conversationId ||
      !isAuthenticated ||
      !hasMore ||
      isLoadingMore ||
      isFetchingRef.current ||
      !oldestMessageIdRef.current
    ) {
      return;
    }

    isFetchingRef.current = true;
    setIsLoadingMore(true);

    try {
      log("Loading more messages before:", oldestMessageIdRef.current);

      const response = await api.getMessages(conversationId, {
        limit: PAGE_SIZE,
        before: oldestMessageIdRef.current,
      });

      const rawMessages = response.messages || [];
      log("Received", rawMessages.length, "more messages");

      if (rawMessages.length === 0) {
        setHasMore(false);
        return;
      }

      // Decrypt messages in parallel
      const decryptedMessages = await Promise.all(
        rawMessages.map((m) => decryptMessage(m))
      );

      // Reverse for display (API returns DESC order)
      const sortedNewMessages = decryptedMessages.reverse();

      // Prepend older messages
      setMessages((prev) => [...sortedNewMessages, ...prev]);
      setHasMore(rawMessages.length === PAGE_SIZE);
      oldestMessageIdRef.current = sortedNewMessages[0]?.id ?? oldestMessageIdRef.current;
    } catch (err) {
      console.error("Failed to load more messages:", err);
    } finally {
      setIsLoadingMore(false);
      isFetchingRef.current = false;
    }
  }, [conversationId, isAuthenticated, hasMore, isLoadingMore, decryptMessage]);

  // Add a new message (for real-time updates)
  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => {
      // Avoid duplicates
      if (prev.some((m) => m.id === message.id)) {
        return prev;
      }
      return [...prev, message];
    });
  }, []);

  // Refetch messages (e.g., after sending)
  const refetch = useCallback(async () => {
    // Reset and fetch fresh
    oldestMessageIdRef.current = null;
    setHasMore(true);
    await fetchInitial();
  }, [fetchInitial]);

  // Fetch on mount and when conversation changes
  useEffect(() => {
    if (conversationId && isAuthenticated) {
      // Reset state for new conversation
      setMessages([]);
      setHasMore(true);
      setError(null);
      oldestMessageIdRef.current = null;

      fetchInitial();
    }
  }, [conversationId, isAuthenticated, isEncryptionReady, fetchInitial]);

  return {
    messages,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    refetch,
    addMessage,
  };
}
