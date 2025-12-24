"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores";

// Helper to log to Rust console (visible in terminal)
async function debugLog(message: string) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("debug_log", { message });
  } catch {
    // Ignore errors if not in Tauri
  }
}

/**
 * Global handler for Tauri OAuth deep link callbacks.
 * This component should be mounted at the app level (in providers)
 * so it can receive OAuth callbacks regardless of which page the user is on.
 */
export function TauriOAuthHandler() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setUser } = useAuthStore();
  const [isDesktop, setIsDesktop] = useState(false);
  const processingRef = useRef(false);

  // Process an OAuth callback URL
  const processOAuthUrl = useCallback(async (url: string) => {
    // Prevent duplicate processing
    if (processingRef.current) {
      await debugLog("Already processing, skipping duplicate");
      return;
    }
    processingRef.current = true;

    await debugLog(`Step 1: Processing OAuth URL: ${url}`);

    // Parse the URL to get token or error
    let token: string | null = null;
    let error: string | null = null;

    try {
      const urlObj = new URL(url);
      token = urlObj.searchParams.get("token");
      error = urlObj.searchParams.get("error");
      await debugLog(`Step 2: Parsed URL - token exists: ${!!token}, error: ${error}`);
    } catch (e) {
      await debugLog(`Step 2 FAILED: Could not parse URL: ${e}`);
      processingRef.current = false;
      return;
    }

    if (error) {
      await debugLog(`OAuth error received: ${error}`);
      router.push(`/signin?error=${encodeURIComponent(error)}`);
      return;
    }

    if (token) {
      try {
        await debugLog("Step 3: Calling handle_oauth_callback...");
        const { invoke } = await import("@tauri-apps/api/core");
        const response = await invoke<{
          success: boolean;
          user?: any;
          token?: string;
          error?: string;
        }>("handle_oauth_callback", { token });

        await debugLog(`Step 4: Got response - success: ${response.success}, has user: ${!!response.user}, has token: ${!!response.token}`);

        if (response.success && response.user) {
          await debugLog("Step 5: Calling setUser...");
          try {
            setUser(
              {
                id: response.user.id,
                username: response.user.username,
                email: response.user.email,
                isAnonymous: response.user.isAnonymous ?? false,
                walletAddress: response.user.walletAddress,
                createdAt: response.user.createdAt,
              },
              response.token!
            );
            await debugLog("Step 6: setUser completed");
          } catch (e) {
            await debugLog(`Step 5 FAILED: setUser threw: ${e}`);
            throw e;
          }

          await debugLog("Step 7: Setting localStorage...");
          try {
            localStorage.setItem("token", response.token!);
            await debugLog("Step 8: localStorage set");
          } catch (e) {
            await debugLog(`Step 7 FAILED: localStorage threw: ${e}`);
            throw e;
          }

          // Set React Query cache - transform to match expected backend format
          await debugLog("Step 8.5: Setting React Query cache...");
          queryClient.setQueryData(["me"], {
            user: {
              id: response.user.id,
              username: response.user.username,
              email: response.user.email,
              is_anonymous: response.user.isAnonymous ?? false,
              wallet_address: response.user.walletAddress,
              created_at: response.user.createdAt,
            }
          });

          // Verify auth state
          const storedToken = localStorage.getItem("token");
          await debugLog(`Step 9: Verification - localStorage token: ${!!storedToken}, Zustand updated`);

          // Auth is FULLY COMPLETE at this point:
          // - Rust validated the token via API (in handle_oauth_callback)
          // - Zustand has user + token (setUser called)
          // - localStorage has token
          // - React Query cache has user data
          //
          // Following Artifex pattern: navigate IMMEDIATELY after auth completes
          // Don't wait for React Query to re-fetch - we already validated in Rust
          await debugLog("Step 10: Auth complete! Navigating to chat...");

          // Small delay to ensure state is flushed
          await new Promise(resolve => setTimeout(resolve, 50));

          // Navigate using window.location for reliability in Tauri
          const origin = window.location.origin;
          const chatUrl = `${origin}/chat.html`;
          await debugLog(`Step 11: Navigating to: ${chatUrl}`);
          window.location.href = chatUrl;

        } else {
          await debugLog(`Step 4 FAILED: Auth not successful - error: ${response.error}`);
          router.push(`/signin?error=${encodeURIComponent(response.error || "Authentication failed")}`);
        }
      } catch (err) {
        await debugLog(`EXCEPTION in OAuth processing: ${err}`);
        router.push("/signin?error=Failed+to+complete+sign+in");
      }
    }
  }, [router, setUser, queryClient]);

  // Detect Tauri desktop app
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__;
    setIsDesktop(isTauri);
    if (isTauri) {
      debugLog("TauriOAuthHandler initialized in desktop app");
    }
  }, []);

  // Check for pending OAuth URLs on mount (handles race condition)
  useEffect(() => {
    if (!isDesktop) return;

    const checkPendingUrls = async () => {
      try {
        await debugLog("Checking for pending OAuth URLs...");
        const { invoke } = await import("@tauri-apps/api/core");
        const pendingUrls = await invoke<string[]>("get_pending_oauth_urls");

        if (pendingUrls && pendingUrls.length > 0) {
          await debugLog(`Found ${pendingUrls.length} pending OAuth URL(s)`);
          for (const url of pendingUrls) {
            await processOAuthUrl(url);
          }
        } else {
          await debugLog("No pending OAuth URLs");
        }
      } catch (err) {
        await debugLog(`Failed to check pending URLs: ${err}`);
      }
    };

    checkPendingUrls();
  }, [isDesktop, processOAuthUrl]);

  // Listen for OAuth callbacks from Tauri deep links (for when app is already running)
  useEffect(() => {
    if (!isDesktop) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        await debugLog("Setting up OAuth callback event listener...");
        const { listen } = await import("@tauri-apps/api/event");

        unlisten = await listen<string>("oauth-callback", async (event) => {
          await debugLog(`Received oauth-callback event with URL: ${event.payload}`);
          await processOAuthUrl(event.payload);
        });

        await debugLog("OAuth callback listener ready");
      } catch (err) {
        await debugLog(`Failed to set up listener: ${err}`);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        debugLog("Cleaning up OAuth listener");
        unlisten();
      }
    };
  }, [isDesktop, processOAuthUrl]);

  // This component doesn't render anything
  return null;
}
