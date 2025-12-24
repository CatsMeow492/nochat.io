"use client";

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { useVirtualizer, VirtualItem } from "@tanstack/react-virtual";
import { MessageBubble } from "./message-bubble";
import type { ChatMessage } from "@/stores";

interface VirtualizedMessageListProps {
  messages: ChatMessage[];
  currentUserId: string | undefined;
  onLoadMore?: () => Promise<void>;
  hasMore?: boolean;
  isLoading?: boolean;
}

export interface VirtualizedMessageListRef {
  scrollToBottom: (behavior?: "smooth" | "auto") => void;
}

/**
 * VirtualizedMessageList - High-performance message list using TanStack Virtual.
 *
 * Features:
 * - Only renders visible items + overscan buffer (O(1) DOM nodes)
 * - Dynamic row heights with measurement
 * - Infinite scroll to load older messages
 * - CSS containment for layout isolation
 *
 * Performance targets:
 * - 60 FPS scrolling with 100,000+ messages
 * - <100ms initial render
 * - <30 DOM nodes rendered at any time
 */
export const VirtualizedMessageList = forwardRef<
  VirtualizedMessageListRef,
  VirtualizedMessageListProps
>(function VirtualizedMessageList(
  { messages, currentUserId, onLoadMore, hasMore = false, isLoading = false },
  ref
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(false);
  const lastMessageCountRef = useRef(messages.length);

  // Virtualizer with dynamic height measurement
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => 72, []), // Estimated row height (px)
    overscan: 5, // Render 5 extra items above/below viewport
    getItemKey: useCallback((index: number) => messages[index]?.id ?? index, [messages]),
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Expose scroll methods via ref
  useImperativeHandle(ref, () => ({
    scrollToBottom: (behavior?: "smooth" | "auto") => {
      if (messages.length > 0) {
        virtualizer.scrollToIndex(messages.length - 1, {
          align: "end",
          behavior: behavior ?? "smooth",
        });
      }
    },
  }), [messages.length, virtualizer]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > lastMessageCountRef.current) {
      // New message added - scroll to bottom
      virtualizer.scrollToIndex(messages.length - 1, {
        align: "end",
        behavior: "smooth",
      });
    }
    lastMessageCountRef.current = messages.length;
  }, [messages.length, virtualizer]);

  // Infinite scroll: load more when near top
  const handleScroll = useCallback(async () => {
    if (!parentRef.current || isLoading || !hasMore || loadMoreRef.current || !onLoadMore) {
      return;
    }

    const { scrollTop } = parentRef.current;

    // Load more when within 200px of top
    if (scrollTop < 200) {
      loadMoreRef.current = true;
      try {
        await onLoadMore();
      } finally {
        loadMoreRef.current = false;
      }
    }
  }, [onLoadMore, hasMore, isLoading]);

  // Helper to determine if avatar should be shown
  const shouldShowAvatar = useCallback(
    (index: number): boolean => {
      if (index === 0) return true;
      const currentMessage = messages[index];
      const previousMessage = messages[index - 1];
      return currentMessage?.senderId !== previousMessage?.senderId;
    },
    [messages]
  );

  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className="h-full overflow-auto virtual-list-container scrollbar-thin"
      style={{ contain: "strict" }} // CSS containment for performance
    >
      {/* Loading indicator at top */}
      {isLoading && (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Spacer to maintain scroll height */}
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {/* Absolutely positioned virtual items */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
          }}
        >
          {virtualItems.map((virtualRow: VirtualItem) => {
            const message = messages[virtualRow.index];
            if (!message) return null;

            const isOwn = message.senderId === currentUserId;
            const showAvatar = !isOwn && shouldShowAvatar(virtualRow.index);

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="message-bubble-container"
              >
                <MessageBubble
                  message={message}
                  isOwn={isOwn}
                  showAvatar={showAvatar}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
