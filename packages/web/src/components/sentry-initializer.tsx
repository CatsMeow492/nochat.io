"use client";

import { useEffect, useRef } from "react";
import { initSentry } from "@/lib/sentry";

/**
 * SentryInitializer Component
 *
 * Client-side Sentry initialization for Next.js App Router.
 * This component initializes Sentry once on mount with privacy-safe configuration.
 *
 * Place this component in the Providers tree to ensure Sentry is initialized
 * before the application renders.
 */
export function SentryInitializer(): null {
  const initialized = useRef(false);

  useEffect(() => {
    // Initialize only once
    if (!initialized.current) {
      initialized.current = true;
      initSentry();
    }
  }, []);

  // This component renders nothing
  return null;
}
