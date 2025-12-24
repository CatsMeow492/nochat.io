"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks";
import { useAuthStore } from "@/stores";
import { ChatSidebar } from "@/components/chat/sidebar";
import { OfflineBanner } from "@/components/offline-banner";
import { DesktopAppBanner } from "@/components/desktop-app-banner";
import { DesktopAppModal } from "@/components/desktop-app-modal";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthVerified, isLoading } = useAuth();
  // For desktop app, trust Zustand's isAuthenticated directly
  // because Rust already validated the token via API in handle_oauth_callback
  const { isAuthenticated, token, _hasHydrated } = useAuthStore();

  // Check if we're in Tauri desktop app
  const isTauri = typeof window !== 'undefined' &&
    (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__);

  // For desktop: trust isAuthenticated after hydration (Rust validated token)
  // For web: require isAuthVerified (API call verification)
  const isAuthorized = isTauri
    ? (_hasHydrated && isAuthenticated && !!token)
    : isAuthVerified;

  const isCheckingAuth = isTauri
    ? !_hasHydrated
    : isLoading;

  useEffect(() => {
    // Redirect to home if:
    // 1. Not checking auth anymore AND
    // 2. Not authorized
    if (!isCheckingAuth && !isAuthorized) {
      router.push("/");
    }
  }, [isAuthorized, isCheckingAuth, router]);

  // Show loading while checking auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If not authorized (redirect will happen via useEffect)
  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <OfflineBanner />
      <DesktopAppBanner />
      <div className="flex flex-1 overflow-hidden">
        <ChatSidebar />
        <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
      </div>
      {/* Show modal on first sign-in (only on web, not desktop app) */}
      <DesktopAppModal trigger={!isTauri && isAuthorized} />
    </div>
  );
}
