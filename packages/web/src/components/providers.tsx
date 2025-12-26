"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthInitializer } from "@/components/auth-initializer";
import { CryptoInitializer } from "@/components/crypto-initializer";
import { SentryInitializer } from "@/components/sentry-initializer";
import { TauriOAuthHandler } from "@/components/tauri-oauth-handler";
import { UpdateBanner } from "@/components/update-banner";
import { SentryErrorBoundary } from "@/lib/sentry";

/**
 * Error fallback component displayed when an unhandled error occurs.
 * This provides a user-friendly error message while Sentry captures the error.
 */
function ErrorFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-foreground">
      <div className="max-w-md text-center">
        <h1 className="mb-4 text-2xl font-bold">Something went wrong</h1>
        <p className="mb-6 text-muted-foreground">
          We encountered an unexpected error. The issue has been reported and we
          are working to fix it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-primary px-6 py-2 text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Reload Page
        </button>
      </div>
    </div>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <SentryErrorBoundary fallback={<ErrorFallback />}>
      <SentryInitializer />
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={300}>
            <AuthInitializer />
            <CryptoInitializer />
            <TauriOAuthHandler />
            <UpdateBanner />
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SentryErrorBoundary>
  );
}
