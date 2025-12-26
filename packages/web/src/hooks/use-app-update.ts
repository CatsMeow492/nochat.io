"use client";

import { useState, useEffect, useCallback } from "react";

interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

interface UseAppUpdateReturn {
  /** Whether an update is available */
  updateAvailable: boolean;
  /** Information about the available update */
  updateInfo: UpdateInfo | null;
  /** Whether an update is currently downloading */
  isDownloading: boolean;
  /** Download progress (0-100) */
  downloadProgress: number;
  /** Whether the update has been installed and restart is needed */
  isInstalled: boolean;
  /** Error message if update failed */
  error: string | null;
  /** Check for updates manually */
  checkForUpdate: () => Promise<void>;
  /** Install the available update */
  installUpdate: () => Promise<void>;
  /** Restart the app to apply the update */
  restartApp: () => Promise<void>;
  /** Dismiss the update notification */
  dismiss: () => void;
  /** Current app version */
  currentVersion: string | null;
  /** Whether running in Tauri desktop app */
  isTauri: boolean;
}

/**
 * Hook for managing desktop app updates via Tauri
 * Only active when running in the Tauri desktop app
 */
export function useAppUpdate(): UseAppUpdateReturn {
  const [isTauri, setIsTauri] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isInstalled, setIsInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Detect Tauri environment
  useEffect(() => {
    const hasTauri = typeof window !== "undefined" &&
      (!!((window as any).__TAURI_INTERNALS__) || !!((window as any).__TAURI__));
    setIsTauri(hasTauri);

    if (hasTauri) {
      // Get current version
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke<string>("get_version").then(setCurrentVersion).catch(console.error);
      });
    }
  }, []);

  // Listen for update events from Tauri backend
  useEffect(() => {
    if (!isTauri) return;

    let unlistenAvailable: (() => void) | undefined;
    let unlistenInstalled: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        // Listen for update-available event (emitted by background checker)
        unlistenAvailable = await listen<UpdateInfo>("update-available", (event) => {
          console.log("Update available:", event.payload);
          setUpdateInfo(event.payload);
          setUpdateAvailable(true);
          setDismissed(false);
          setError(null);
        });

        // Listen for update-installed event
        unlistenInstalled = await listen("update-installed", () => {
          console.log("Update installed, restart required");
          setIsDownloading(false);
          setIsInstalled(true);
        });
      } catch (err) {
        console.error("Failed to set up update listeners:", err);
      }
    };

    setupListeners();

    return () => {
      if (unlistenAvailable) unlistenAvailable();
      if (unlistenInstalled) unlistenInstalled();
    };
  }, [isTauri]);

  // Check for updates manually
  const checkForUpdate = useCallback(async () => {
    if (!isTauri) return;

    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const info = await invoke<UpdateInfo | null>("check_update");

      if (info) {
        setUpdateInfo(info);
        setUpdateAvailable(true);
        setDismissed(false);
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
      setError(err instanceof Error ? err.message : "Failed to check for updates");
    }
  }, [isTauri]);

  // Install the update
  const installUpdate = useCallback(async () => {
    if (!isTauri || !updateAvailable) return;

    setError(null);
    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      const { invoke } = await import("@tauri-apps/api/core");

      // Simulate progress (Tauri updater doesn't expose granular progress)
      const progressInterval = setInterval(() => {
        setDownloadProgress((prev) => Math.min(prev + 10, 90));
      }, 500);

      await invoke("install_update");

      clearInterval(progressInterval);
      setDownloadProgress(100);
      setIsInstalled(true);
      setIsDownloading(false);
    } catch (err) {
      console.error("Failed to install update:", err);
      setError(err instanceof Error ? err.message : "Failed to install update");
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  }, [isTauri, updateAvailable]);

  // Restart the app
  const restartApp = useCallback(async () => {
    if (!isTauri) return;

    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      // Fallback: try using exit and letting the OS restart
      console.error("Failed to relaunch:", err);
      try {
        const { exit } = await import("@tauri-apps/plugin-process");
        await exit(0);
      } catch {
        // Last resort: just reload the window
        window.location.reload();
      }
    }
  }, [isTauri]);

  // Dismiss the update notification
  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  return {
    updateAvailable: updateAvailable && !dismissed,
    updateInfo,
    isDownloading,
    downloadProgress,
    isInstalled,
    error,
    checkForUpdate,
    installUpdate,
    restartApp,
    dismiss,
    currentVersion,
    isTauri,
  };
}
