"use client";

import { useState, useEffect } from "react";
import { X, Download, Zap, Shield, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BANNER_DISMISSED_KEY = "nochat-desktop-banner-dismissed";
const BANNER_DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

interface Props {
  className?: string;
}

/**
 * Dismissable banner prompting web users to download the desktop app.
 * Only shows on web (not in Tauri desktop app).
 * Remembers dismissal for 7 days.
 */
export function DesktopAppBanner({ className }: Props) {
  const [dismissed, setDismissed] = useState(true); // Start hidden to avoid flash
  const [isTauri, setIsTauri] = useState(false);

  useEffect(() => {
    // Check if we're in Tauri desktop app
    const tauri =
      typeof window !== "undefined" &&
      (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__);
    setIsTauri(tauri);

    if (tauri) {
      setDismissed(true);
      return;
    }

    // Check if banner was previously dismissed
    const dismissedAt = localStorage.getItem(BANNER_DISMISSED_KEY);
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10);
      if (Date.now() - dismissedTime < BANNER_DISMISS_DURATION) {
        setDismissed(true);
        return;
      }
    }

    setDismissed(false);
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(BANNER_DISMISSED_KEY, Date.now().toString());
    setDismissed(true);
  };

  // Don't render on desktop app or if dismissed
  if (isTauri || dismissed) return null;

  return (
    <div
      role="banner"
      className={cn(
        "relative flex items-center justify-center gap-4 px-4 py-3",
        "bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10",
        "border-b border-primary/20",
        "animate-in slide-in-from-top duration-300",
        className
      )}
    >
      <div className="flex items-center gap-6 flex-wrap justify-center">
        <div className="flex items-center gap-2 text-sm">
          <Zap className="w-4 h-4 text-primary" />
          <span className="text-foreground/80">
            Get the <strong className="text-foreground">desktop app</strong> for
            faster performance & native notifications
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            className="gap-2 h-8"
            asChild
          >
            <a href="/#download" onClick={() => window.scrollTo(0, 0)}>
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
          </Button>
        </div>
      </div>

      <button
        onClick={handleDismiss}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-foreground/10 transition-colors"
        aria-label="Dismiss banner"
      >
        <X className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
  );
}
