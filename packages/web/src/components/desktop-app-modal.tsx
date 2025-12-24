"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Zap, Bell, Shield, Monitor, Apple } from "lucide-react";

const MODAL_SHOWN_KEY = "nochat-desktop-modal-shown";

interface Props {
  /** Trigger to show the modal (e.g., after first successful sign-in) */
  trigger?: boolean;
}

/**
 * Modal dialog prompting users to download the desktop app.
 * Shows once per user (stored in localStorage).
 * Only shows on web (not in Tauri desktop app).
 */
export function DesktopAppModal({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<"macos" | "windows" | "linux" | null>(null);

  useEffect(() => {
    // Check if we're in Tauri desktop app
    const isTauri =
      typeof window !== "undefined" &&
      (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__);

    if (isTauri) return;

    // Detect platform
    if (typeof window !== "undefined") {
      const userAgent = navigator.userAgent.toLowerCase();
      if (userAgent.includes("mac")) {
        setPlatform("macos");
      } else if (userAgent.includes("win")) {
        setPlatform("windows");
      } else if (userAgent.includes("linux")) {
        setPlatform("linux");
      }
    }

    // Check if modal was already shown
    const wasShown = localStorage.getItem(MODAL_SHOWN_KEY);
    if (wasShown) return;

    // Show modal if triggered
    if (trigger) {
      // Small delay to let the page settle
      const timer = setTimeout(() => {
        setOpen(true);
        localStorage.setItem(MODAL_SHOWN_KEY, "true");
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [trigger]);

  const handleDownload = () => {
    setOpen(false);
    // Navigate to download section
    window.location.href = "/#download";
  };

  const PlatformIcon = platform === "macos" ? Apple : platform === "windows" ? Monitor : Download;
  const platformName = platform === "macos" ? "macOS" : platform === "windows" ? "Windows" : "Linux";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Download className="w-5 h-5 text-primary" />
            Get the NoChat Desktop App
          </DialogTitle>
          <DialogDescription>
            Enjoy an enhanced experience with our native desktop application.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Zap className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Faster Performance</p>
                <p className="text-xs text-muted-foreground">
                  Native app runs faster than the browser version
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Bell className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Native Notifications</p>
                <p className="text-xs text-muted-foreground">
                  Never miss a message with system notifications
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Shield className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Enhanced Security</p>
                <p className="text-xs text-muted-foreground">
                  Isolated app environment for better privacy
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} className="w-full sm:w-auto">
            Maybe Later
          </Button>
          <Button onClick={handleDownload} className="gap-2 w-full sm:w-auto">
            <PlatformIcon className="w-4 h-4" />
            Download for {platformName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
