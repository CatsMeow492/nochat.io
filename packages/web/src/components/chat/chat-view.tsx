"use client";

import { useRef, useEffect, useState, FormEvent, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  Lock,
  MoreVertical,
  Phone,
  Video,
  Info,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { VirtualizedMessageList, VirtualizedMessageListRef } from "./virtualized-message-list";
import { useMessages, useConversations } from "@/hooks";
import { useAuthStore, useChatStore } from "@/stores";
import { cn } from "@/lib/utils";

interface ChatViewProps {
  conversationId: string;
}

export function ChatView({ conversationId }: ChatViewProps) {
  const router = useRouter();
  const { user } = useAuthStore();
  const { typingUsers, setCurrentRoom } = useChatStore();
  const { deleteConversation, isDeleting } = useConversations();
  const {
    messages,
    isLoading,
    sendMessage,
    isSending,
    isEncrypted,
    isCryptoLoading,
    isP2PReady,
    sessionStatus,
    isDM,
  } = useMessages(conversationId);

  const [newMessage, setNewMessage] = useState("");
  const messageListRef = useRef<VirtualizedMessageListRef>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Call handlers - navigate to meeting room using conversation ID as room ID
  const handleVoiceCall = useCallback(() => {
    // Use conversation ID as the meeting room ID for continuity
    router.push(`/meeting/${conversationId}?mode=audio`);
  }, [router, conversationId]);

  const handleVideoCall = useCallback(() => {
    // Use conversation ID as the meeting room ID for continuity
    router.push(`/meeting/${conversationId}`);
  }, [router, conversationId]);

  const handleDeleteConversation = useCallback(() => {
    if (window.confirm("Are you sure you want to delete this conversation? This action cannot be undone.")) {
      deleteConversation(conversationId, {
        onSuccess: () => {
          router.push("/");
        },
      });
    }
  }, [deleteConversation, conversationId, router]);

  // Set current room for unread tracking
  useEffect(() => {
    setCurrentRoom(conversationId);
    return () => setCurrentRoom(null);
  }, [conversationId, setCurrentRoom]);

  // Scroll to bottom on new messages (handled by VirtualizedMessageList automatically)
  // Keeping manual trigger available via ref for explicit scrolls
  const scrollToBottom = useCallback(() => {
    messageListRef.current?.scrollToBottom("smooth");
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSending) return;

    sendMessage({
      content: newMessage,
      encrypted: isEncrypted,
    });
    setNewMessage("");
  };

  const typing = typingUsers.get(conversationId);
  const typingArray = typing ? Array.from(typing) : [];

  // Use the isEncrypted from useMessages hook (which checks both store status and CryptoService)
  const encryptionReady = isEncrypted;

  // Determine encryption status text
  const getEncryptionStatusText = () => {
    if (!encryptionReady) return "Setting up encryption...";
    if (isP2PReady) return "Zero-trust P2P encrypted";
    if (isDM && sessionStatus === "pending") return "Establishing P2P session...";
    if (isDM && sessionStatus === "failed") return "E2E encrypted (P2P unavailable)";
    return "End-to-end encrypted";
  };

  const getEncryptionStatusColor = () => {
    if (!encryptionReady) return "bg-yellow-500";
    if (isP2PReady) return "bg-green-500";
    if (isDM && sessionStatus === "pending") return "bg-yellow-500";
    return "bg-green-400"; // Legacy mode still green, but lighter
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <header className="h-16 border-b border-border flex items-center justify-between px-4 bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Avatar className="w-10 h-10">
            <AvatarFallback className="bg-primary/20 text-primary">
              C
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="font-semibold">Conversation</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {typingArray.length > 0 ? (
                <span className="text-primary animate-pulse">
                  {typingArray.length === 1
                    ? "Someone is typing..."
                    : `${typingArray.length} people typing...`}
                </span>
              ) : (
                <>
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full",
                      getEncryptionStatusColor()
                    )}
                  />
                  {getEncryptionStatusText()}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleVoiceCall}>
                <Phone className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Voice call</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleVideoCall}>
                <Video className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Video call</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Info className="w-4 h-4 mr-2" />
                Conversation info
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleDeleteConversation}
                disabled={isDeleting}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {isDeleting ? "Deleting..." : "Delete conversation"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Messages Area - Virtualized for performance */}
      <div className="flex-1 overflow-hidden message-list">
        {isLoading || isCryptoLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            {isCryptoLoading && (
              <p className="text-sm text-muted-foreground">
                Initializing encryption...
              </p>
            )}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-semibold mb-2">Start a secure conversation</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Messages in this conversation are secured with end-to-end
              encryption. Only you and the other participants can read them.
            </p>
          </div>
        ) : (
          <VirtualizedMessageList
            ref={messageListRef}
            messages={messages}
            currentUserId={user?.id}
          />
        )}
      </div>

      {/* Message Input */}
      <div className="p-4 border-t border-border bg-card/50 backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <div className="flex-1 relative">
            <Input
              ref={inputRef}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={
                isCryptoLoading
                  ? "Initializing encryption..."
                  : encryptionReady
                  ? "Type an encrypted message..."
                  : "Waiting for encryption..."
              }
              disabled={!encryptionReady || isCryptoLoading}
              className="pr-12 bg-secondary/50 border-border focus-visible:ring-primary"
            />
            {encryptionReady && (
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
            )}
          </div>
          <Button
            type="submit"
            disabled={!newMessage.trim() || isSending || !encryptionReady || isCryptoLoading}
            className="px-4"
          >
            <Send className="w-5 h-5" />
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          {isCryptoLoading ? (
            <span className="flex items-center justify-center gap-1">
              <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
              Initializing encryption...
            </span>
          ) : encryptionReady ? (
            <span className="flex items-center justify-center gap-1">
              <Lock className={cn("w-3 h-3", isP2PReady ? "text-green-500" : "text-green-400")} />
              {isP2PReady
                ? "Messages are zero-trust P2P encrypted"
                : "Messages are end-to-end encrypted"}
            </span>
          ) : (
            "Establishing secure connection..."
          )}
        </p>
      </div>
    </div>
  );
}
