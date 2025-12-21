"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useAuthStore, useCryptoStore } from "@/stores";
import { cryptoService } from "@/crypto";
import { api } from "@/lib/api";

/**
 * useCrypto hook - Handles E2EE initialization and key management
 *
 * This hook:
 * 1. Initializes CryptoService when user authenticates
 * 2. Generates keys if they don't exist (stored in IndexedDB)
 * 3. Uploads public keys to the server
 * 4. Provides encryption status to the UI
 */
export function useCrypto() {
  const { user, isAuthenticated, token } = useAuthStore();
  const {
    status,
    setStatus,
    setError,
    setIdentityFingerprint,
    setPreKeyCount,
  } = useCryptoStore();

  const initializingRef = useRef(false);
  const keysUploadedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);

  const uploadKeysToServer = useCallback(async () => {
    try {
      console.log("[useCrypto] Uploading keys to server...");

      const keys = await cryptoService.getKeysForUpload();
      if (!keys) {
        console.warn("[useCrypto] No keys available for upload");
        return;
      }

      // Upload identity public key
      try {
        await api.uploadIdentityKey(keys.identityPublicKey);
        console.log("[useCrypto] Identity key uploaded");
      } catch (error) {
        // Server may not have crypto endpoints yet - that's okay
        console.warn("[useCrypto] Failed to upload identity key:", error);
      }

      // Upload signed prekey
      try {
        await api.uploadSignedPreKey({
          key_id: keys.signedPreKey.keyId,
          kyber_public_key: keys.signedPreKey.publicKey,
          signature: keys.signedPreKey.signature,
        });
        console.log("[useCrypto] Signed prekey uploaded");
      } catch (error) {
        console.warn("[useCrypto] Failed to upload signed prekey:", error);
      }

      console.log("[useCrypto] Key upload attempts complete");
    } catch (error) {
      // Don't fail initialization if key upload fails
      console.error("[useCrypto] Failed to upload keys:", error);
    }
  }, []);

  const initializeCrypto = useCallback(async () => {
    if (!user?.id || !token) {
      return;
    }

    // Prevent double initialization
    if (initializingRef.current) {
      return;
    }
    initializingRef.current = true;

    try {
      setStatus("initializing");
      console.log("[useCrypto] Initializing E2EE for user:", user.id);

      // Initialize CryptoService (loads or generates keys from IndexedDB)
      await cryptoService.initialize(user.id);

      // Get identity fingerprint
      const fingerprint = await cryptoService.getIdentityFingerprint();
      if (fingerprint) {
        setIdentityFingerprint(fingerprint);
      }

      // Update prekey count
      const prekeyCount = cryptoService.getPreKeyCount();
      setPreKeyCount(prekeyCount);

      setStatus("ready");
      console.log("[useCrypto] E2EE initialized, keys loaded/generated");

      // Upload keys to server if not already uploaded
      if (!keysUploadedRef.current) {
        await uploadKeysToServer();
        keysUploadedRef.current = true;
      }

      // Mark as encrypted (ready for messaging)
      setStatus("encrypted");
      setIsReady(true);
      console.log("[useCrypto] E2EE ready for messaging");
    } catch (error) {
      console.error("[useCrypto] Failed to initialize E2EE:", error);
      setError(error instanceof Error ? error.message : "Failed to initialize encryption");
      setStatus("error");
    } finally {
      initializingRef.current = false;
    }
  }, [user?.id, token, setStatus, setError, setIdentityFingerprint, setPreKeyCount, uploadKeysToServer]);

  // Initialize when user authenticates
  useEffect(() => {
    if (isAuthenticated && user?.id && token && status === "uninitialized") {
      initializeCrypto();
    }
  }, [isAuthenticated, user?.id, token, status, initializeCrypto]);

  // Reset session state on logout (but DON'T clear crypto keys!)
  // Keys must persist in IndexedDB to decrypt messages sent by others
  // who derived sessions using our public keys. Clearing keys would
  // break decryption of any messages encrypted before re-login.
  useEffect(() => {
    if (!isAuthenticated) {
      initializingRef.current = false;
      keysUploadedRef.current = false;
      setIsReady(false);
      useCryptoStore.getState().reset();
      // Clear memory caches but preserve IndexedDB keys
      // This prevents cross-user cache contamination while maintaining
      // the ability to decrypt old messages after re-login.
      cryptoService.resetSession();
    }
  }, [isAuthenticated]);

  return {
    status,
    isReady: isReady || status === "encrypted",
    isInitializing: status === "initializing" || status === "ready",
  };
}
