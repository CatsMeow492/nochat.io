"use client";

import { useRef, useEffect, useState, FormEvent } from "react";
import {
  Send,
  Lock,
  AlertCircle,
  MoreVertical,
  Phone,
  Video,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMessages } from "@/hooks";
import { useAuthStore, useCryptoStore, useChatStore } from "@/stores";
import { cn } from "@/lib/utils";

interface ChatViewProps {
  conversationId: string;
}

export function ChatView({ conversationId }: ChatViewProps) {
  const { user } = useAuthStore();
  const { status: encryptionStatus } = useCryptoStore();
  const { typingUsers, setCurrentRoom } = useChatStore();
  const { messages, isLoading, sendMessage, isSending } =
    useMessages(conversationId);

  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Set current room for unread tracking
  useEffect(() => {
    setCurrentRoom(conversationId);
    return () => setCurrentRoom(null);
  }, [conversationId, setCurrentRoom]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSending) return;

    sendMessage({
      content: newMessage,
      encrypted: encryptionStatus === "encrypted",
    });
    setNewMessage("");
  };

  const typing = typingUsers.get(conversationId);
  const typingArray = typing ? Array.from(typing) : [];

  const isEncrypted = encryptionStatus === "encrypted";

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
                      isEncrypted ? "bg-green-500" : "bg-yellow-500"
                    )}
                  />
                  {isEncrypted ? "End-to-end encrypted" : "Setting up encryption..."}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon">
                <Phone className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Voice call</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon">
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4 scrollbar-thin">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
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
          <div className="space-y-4">
            {messages.map((message: any, index: number) => {
              const isOwn = message.senderId === user?.id;
              const showAvatar =
                !isOwn &&
                (index === 0 || messages[index - 1]?.senderId !== message.senderId);

              return (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-3",
                    isOwn ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  {!isOwn && (
                    <div className="w-8">
                      {showAvatar && (
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className="text-xs bg-secondary">
                            {message.senderName?.[0]?.toUpperCase() || "U"}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[70%] flex flex-col",
                      isOwn ? "items-end" : "items-start"
                    )}
                  >
                    <div
                      className={cn(
                        "px-4 py-2.5 rounded-2xl",
                        isOwn
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-secondary rounded-bl-md",
                        message.decryptionError && "bg-destructive/20"
                      )}
                    >
                      {message.decryptionError ? (
                        <div className="flex items-center gap-2 text-destructive">
                          <AlertCircle className="w-4 h-4" />
                          <span className="text-sm italic">
                            Could not decrypt message
                          </span>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {message.content}
                        </p>
                      )}
                    </div>
                    <div
                      className={cn(
                        "flex items-center gap-1.5 mt-1 px-1",
                        isOwn ? "flex-row-reverse" : "flex-row"
                      )}
                    >
                      {message.encrypted && (
                        <Lock className="w-3 h-3 text-green-500" />
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(message.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Message Input */}
      <div className="p-4 border-t border-border bg-card/50 backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <div className="flex-1 relative">
            <Input
              ref={inputRef}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={
                isEncrypted
                  ? "Type an encrypted message..."
                  : "Waiting for encryption..."
              }
              disabled={!isEncrypted}
              className="pr-12 bg-secondary/50 border-border focus-visible:ring-primary"
            />
            {isEncrypted && (
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
            )}
          </div>
          <Button
            type="submit"
            disabled={!newMessage.trim() || isSending || !isEncrypted}
            className="px-4"
          >
            <Send className="w-5 h-5" />
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          {isEncrypted ? (
            <span className="flex items-center justify-center gap-1">
              <Lock className="w-3 h-3" />
              Messages are end-to-end encrypted
            </span>
          ) : (
            "Establishing secure connection..."
          )}
        </p>
      </div>
    </div>
  );
}
