"use client";

import { Download, X, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppUpdate } from "@/hooks/use-app-update";
import { cn } from "@/lib/utils";

/**
 * Update notification banner for the desktop app
 * Shows when a new version is available and allows one-click installation
 */
export function UpdateBanner() {
  const {
    updateAvailable,
    updateInfo,
    isDownloading,
    downloadProgress,
    isInstalled,
    error,
    installUpdate,
    restartApp,
    dismiss,
    currentVersion,
    isTauri,
  } = useAppUpdate();

  // Only show on desktop app
  if (!isTauri) return null;

  // Show restart banner if update is installed
  if (isInstalled) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-green-600 text-white px-4 py-3 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5" />
            <span className="text-sm font-medium">
              Update installed! Restart NoChat to apply the changes.
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={restartApp}
            className="bg-white text-green-600 hover:bg-green-50"
          >
            Restart Now
          </Button>
        </div>
      </div>
    );
  }

  // Show error banner if update failed
  if (error) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-destructive text-destructive-foreground px-4 py-3 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm font-medium">
              Update failed: {error}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={installUpdate}
              className="bg-white/20 hover:bg-white/30"
            >
              Retry
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={dismiss}
              className="h-8 w-8 hover:bg-white/20"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Show downloading banner
  if (isDownloading) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-primary text-primary-foreground px-4 py-3 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm font-medium">
              Downloading update... {downloadProgress}%
            </span>
          </div>
          <div className="w-32 h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Don't show if no update available
  if (!updateAvailable || !updateInfo) return null;

  // Show update available banner
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-primary text-primary-foreground px-4 py-3 shadow-lg">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Download className="w-5 h-5" />
          <span className="text-sm font-medium">
            NoChat v{updateInfo.version} is available!
            {currentVersion && (
              <span className="text-primary-foreground/70 ml-1">
                (You have v{currentVersion})
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={installUpdate}
            className="bg-white text-primary hover:bg-primary-foreground/90"
          >
            Install Now
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={dismiss}
            className="h-8 w-8 hover:bg-white/20"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
