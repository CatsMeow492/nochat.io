"use client";

import { useState, useEffect } from "react";
import { X, Download, Zap, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PROMPT_DISMISSED_KEY = "nochat-meeting-desktop-prompt-dismissed";
const PROMPT_DISMISS_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface Props {
  className?: string;
}

/**
 * Prompt shown during meetings to encourage desktop app download.
 * Only shows on web (not in Tauri desktop app).
 * Remembers dismissal for 24 hours.
 */
export function MeetingDesktopPrompt({ className }: Props) {
  const [dismissed, setDismissed] = useState(true);
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

    // Check if prompt was previously dismissed
    const dismissedAt = localStorage.getItem(PROMPT_DISMISSED_KEY);
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10);
      if (Date.now() - dismissedTime < PROMPT_DISMISS_DURATION) {
        setDismissed(true);
        return;
      }
    }

    // Show after a short delay
    const timer = setTimeout(() => {
      setDismissed(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(PROMPT_DISMISSED_KEY, Date.now().toString());
    setDismissed(true);
  };

  if (isTauri || dismissed) return null;

  return (
    <Card
      className={cn(
        "relative p-4 bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20",
        "animate-in slide-in-from-top duration-500",
        className
      )}
    >
      <button
        onClick={handleDismiss}
        className="absolute right-2 top-2 p-1 rounded-md hover:bg-foreground/10 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
          <Video className="w-4 h-4 text-primary" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Get better video quality with our desktop app
          </p>
          <p className="text-xs text-muted-foreground">
            Native performance, lower latency, and system notifications
          </p>
          <Button
            size="sm"
            variant="default"
            className="gap-1.5 h-7 text-xs mt-1"
            asChild
          >
            <a href="/#download" target="_blank" rel="noopener noreferrer">
              <Download className="w-3 h-3" />
              Download Desktop App
            </a>
          </Button>
        </div>
      </div>
    </Card>
  );
}
