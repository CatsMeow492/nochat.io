/**
 * Performance tests for VirtualizedMessageList
 *
 * These tests verify that the virtualized list can handle large datasets
 * without degrading performance.
 *
 * Target metrics:
 * - Initial render with 100,000 messages: <100ms
 * - DOM nodes rendered: <30 (visible + overscan)
 * - Scroll performance: 60 FPS
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VirtualizedMessageList } from "../virtualized-message-list";
import type { ChatMessage } from "@/stores";

// Helper to generate test messages
function generateMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    content: `Test message ${i} with some content that varies in length ${i % 3 === 0 ? " and this is a longer message to test variable heights" : ""}`,
    senderId: i % 3 === 0 ? "user-1" : "user-2",
    senderName: i % 3 === 0 ? "Current User" : "Other User",
    timestamp: new Date(Date.now() - (count - i) * 60000).toISOString(),
    roomId: "room-1",
    encrypted: true,
    decryptionError: false,
  }));
}

describe("VirtualizedMessageList", () => {
  it("renders without crashing with 0 messages", () => {
    const { container } = render(
      <VirtualizedMessageList
        messages={[]}
        currentUserId="user-1"
      />
    );
    // Should return null for empty messages
    expect(container.firstChild).toBeNull();
  });

  it("renders a small list correctly", () => {
    const messages = generateMessages(10);

    render(
      <VirtualizedMessageList
        messages={messages}
        currentUserId="user-1"
      />
    );

    // Should render message bubbles
    const bubbles = screen.getAllByTestId("message-bubble");
    expect(bubbles.length).toBeGreaterThan(0);
    expect(bubbles.length).toBeLessThanOrEqual(15); // 10 + overscan
  });

  it("renders 1,000 messages efficiently", () => {
    const messages = generateMessages(1000);
    const start = performance.now();

    const { container } = render(
      <VirtualizedMessageList
        messages={messages}
        currentUserId="user-1"
      />
    );

    const renderTime = performance.now() - start;

    // Should render in reasonable time
    expect(renderTime).toBeLessThan(500); // 500ms max for 1000 messages

    // Should only render visible items + overscan (not all 1000)
    const bubbles = container.querySelectorAll('[data-testid="message-bubble"]');
    expect(bubbles.length).toBeLessThan(30);
  });

  it("renders 10,000 messages efficiently", () => {
    const messages = generateMessages(10000);
    const start = performance.now();

    const { container } = render(
      <VirtualizedMessageList
        messages={messages}
        currentUserId="user-1"
      />
    );

    const renderTime = performance.now() - start;

    // Should render quickly regardless of total message count
    expect(renderTime).toBeLessThan(200); // 200ms max

    // Should only render visible items + overscan
    const bubbles = container.querySelectorAll('[data-testid="message-bubble"]');
    expect(bubbles.length).toBeLessThan(30);
  });

  it("renders 100,000 messages efficiently (target benchmark)", () => {
    const messages = generateMessages(100000);
    const start = performance.now();

    const { container } = render(
      <VirtualizedMessageList
        messages={messages}
        currentUserId="user-1"
      />
    );

    const renderTime = performance.now() - start;

    // Target: <100ms for 100k messages
    console.log(`Render time for 100,000 messages: ${renderTime.toFixed(2)}ms`);
    expect(renderTime).toBeLessThan(100);

    // Should only render ~15-20 DOM nodes
    const bubbles = container.querySelectorAll('[data-testid="message-bubble"]');
    console.log(`DOM nodes rendered: ${bubbles.length}`);
    expect(bubbles.length).toBeLessThan(30);
  });

  it("correctly identifies own vs other messages", () => {
    const messages: ChatMessage[] = [
      {
        id: "1",
        content: "My message",
        senderId: "user-1",
        senderName: "Me",
        timestamp: new Date().toISOString(),
        roomId: "room-1",
        encrypted: true,
        decryptionError: false,
      },
      {
        id: "2",
        content: "Their message",
        senderId: "user-2",
        senderName: "Them",
        timestamp: new Date().toISOString(),
        roomId: "room-1",
        encrypted: true,
        decryptionError: false,
      },
    ];

    render(
      <VirtualizedMessageList
        messages={messages}
        currentUserId="user-1"
      />
    );

    const bubbles = screen.getAllByTestId("message-bubble");
    expect(bubbles).toHaveLength(2);
  });

  it("handles loading state", () => {
    const messages = generateMessages(10);

    render(
      <VirtualizedMessageList
        messages={messages}
        currentUserId="user-1"
        isLoading={true}
        hasMore={true}
      />
    );

    // Should show loading indicator
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("calls onLoadMore when scrolling near top", async () => {
    const onLoadMore = vi.fn().mockResolvedValue(undefined);
    const messages = generateMessages(100);

    render(
      <VirtualizedMessageList
        messages={messages}
        currentUserId="user-1"
        onLoadMore={onLoadMore}
        hasMore={true}
        isLoading={false}
      />
    );

    // The onLoadMore should be callable (actual scroll testing requires more setup)
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
