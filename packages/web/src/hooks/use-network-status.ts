"use client";

import { useState, useEffect, useCallback } from "react";

interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
}

/**
 * Hook to track network connectivity status.
 * Uses the browser's online/offline events for detection.
 *
 * @returns Object with isOnline boolean and wasOffline to track recent disconnection
 */
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(() => {
    // Default to true during SSR, check navigator.onLine on client
    if (typeof window === "undefined") return true;
    return navigator.onLine;
  });
  const [wasOffline, setWasOffline] = useState(false);

  const handleOnline = useCallback(() => {
    setIsOnline(true);
    // Track that we were recently offline (useful for showing reconnection message)
    // wasOffline will be reset after a short delay
    setTimeout(() => setWasOffline(false), 3000);
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    setWasOffline(true);
  }, []);

  useEffect(() => {
    // Sync state with actual navigator status on mount
    setIsOnline(navigator.onLine);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return { isOnline, wasOffline };
}
