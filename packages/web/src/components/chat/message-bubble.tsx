"use client";

import { memo } from "react";
import { Lock, AlertCircle } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/stores";

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  showAvatar: boolean;
}

/**
 * MessageBubble component - memoized for virtualization performance.
 * Renders a single message with avatar, content, timestamp, and encryption indicator.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  isOwn,
  showAvatar,
}: MessageBubbleProps) {
  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-1",
        isOwn ? "flex-row-reverse" : "flex-row"
      )}
      data-testid="message-bubble"
    >
      {!isOwn && (
        <div className="w-8 flex-shrink-0">
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
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm italic">Could not decrypt message</span>
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
            <Lock className="w-3 h-3 text-green-500 flex-shrink-0" />
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
});
