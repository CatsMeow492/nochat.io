"use client";

import { useCallback, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Share, ShareResult } from "@capacitor/share";

export interface ShareOptions {
  title?: string;
  text?: string;
  url?: string;
  dialogTitle?: string;
}

/**
 * Hook for native share sheet on iOS/Android
 * Falls back to clipboard copy on web
 */
export function useShare() {
  const isNative = Capacitor.isNativePlatform();
  const [isSharing, setIsSharing] = useState(false);

  /**
   * Check if share is available on this platform
   */
  const canShare = useCallback(async (): Promise<boolean> => {
    if (!isNative) {
      // Check if web share API is available
      return typeof navigator !== "undefined" && !!navigator.share;
    }
    try {
      const result = await Share.canShare();
      return result.value;
    } catch {
      return false;
    }
  }, [isNative]);

  /**
   * Share content using native share sheet or fallback to clipboard
   * Returns true if shared successfully, false if cancelled or failed
   */
  const share = useCallback(
    async (options: ShareOptions): Promise<{ shared: boolean; method: "native" | "clipboard" | "cancelled" }> => {
      setIsSharing(true);
      try {
        if (isNative) {
          // Use native share sheet
          try {
            const result: ShareResult = await Share.share({
              title: options.title,
              text: options.text,
              url: options.url,
              dialogTitle: options.dialogTitle || "Share",
            });

            // On iOS, activityType is set if user selected an app
            // On Android, result is always returned
            if (result.activityType) {
              return { shared: true, method: "native" };
            }
            // User cancelled
            return { shared: false, method: "cancelled" };
          } catch (error: any) {
            // User cancelled share dialog
            if (error?.message?.includes("canceled") || error?.message?.includes("cancelled")) {
              return { shared: false, method: "cancelled" };
            }
            throw error;
          }
        }

        // Web fallback: try Web Share API first, then clipboard
        if (typeof navigator !== "undefined" && navigator.share) {
          try {
            await navigator.share({
              title: options.title,
              text: options.text,
              url: options.url,
            });
            return { shared: true, method: "native" };
          } catch (error: any) {
            // User cancelled or not supported
            if (error?.name === "AbortError") {
              return { shared: false, method: "cancelled" };
            }
            // Fall through to clipboard
          }
        }

        // Final fallback: clipboard
        const textToShare = options.url || options.text || options.title || "";
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(textToShare);
          return { shared: true, method: "clipboard" };
        }

        // Last resort: fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = textToShare;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        return { shared: true, method: "clipboard" };
      } catch (error) {
        console.error("[Share] Failed to share:", error);
        return { shared: false, method: "cancelled" };
      } finally {
        setIsSharing(false);
      }
    },
    [isNative]
  );

  /**
   * Convenience method for sharing a meeting link
   */
  const shareMeetingLink = useCallback(
    async (meetingCode: string, meetingUrl: string) => {
      return share({
        title: "Join my NoChat meeting",
        text: `Join my secure meeting on NoChat! Meeting code: ${meetingCode}`,
        url: meetingUrl,
        dialogTitle: "Share meeting link",
      });
    },
    [share]
  );

  /**
   * Convenience method for sharing an invite link
   */
  const shareInviteLink = useCallback(
    async (inviteUrl: string, message?: string) => {
      return share({
        title: "Join me on NoChat",
        text: message || "Chat with me on NoChat - private, secure messaging.",
        url: inviteUrl,
        dialogTitle: "Share invite",
      });
    },
    [share]
  );

  return {
    isNative,
    isSharing,
    canShare,
    share,
    shareMeetingLink,
    shareInviteLink,
  };
}
