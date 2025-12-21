"use client";

import { useCrypto } from "@/hooks/use-crypto";

/**
 * CryptoInitializer component
 *
 * Initializes the E2EE crypto system when the user is authenticated.
 * This should be rendered alongside AuthInitializer.
 */
export function CryptoInitializer() {
  useCrypto();
  return null;
}
