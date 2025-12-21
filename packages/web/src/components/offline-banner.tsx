"use client";

import { WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks";
import { cn } from "@/lib/utils";

/**
 * Offline banner component that displays when the user loses network connectivity.
 * Non-intrusive, appears at the top of the screen with a subtle warning style.
 * Automatically hides when connectivity is restored.
 */
export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-2",
        "bg-amber-500/10 border-b border-amber-500/20",
        "text-amber-600 dark:text-amber-400",
        "text-sm font-medium",
        "animate-in slide-in-from-top duration-300"
      )}
    >
      <WifiOff className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <span>You're offline - messages will send when reconnected</span>
    </div>
  );
}
