"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, AuthError } from "@/lib/api";
import { useAuthStore } from "@/stores";

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
  const { isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => api.getMessages(conversationId!),
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
    mutationFn: (data: { content: string; encrypted?: boolean }) =>
      api.sendMessage(conversationId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
    },
  });

  return {
    messages: data?.messages || [],
    isLoading,
    error,
    refetch,
    sendMessage: sendMessageMutation.mutate,
    isSending: sendMessageMutation.isPending,
  };
}
