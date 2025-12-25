"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Capacitor } from "@capacitor/core";

export interface DiscoveredContact {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  discovered_at: string;
}

export interface PhoneStatus {
  has_phone: boolean;
  phone_verified: boolean;
  phone_last_4?: string;
  contacts_synced: boolean;
  last_synced_at?: string;
}

export interface SyncResult {
  total_uploaded: number;
  matches_found: number;
  new_matches: number;
  discovered_users: DiscoveredContact[];
}

/**
 * Normalize phone number to E.164-ish format for consistent hashing
 * Must match server-side normalization
 */
function normalizePhone(phone: string): string {
  // Remove all non-digit characters except leading +
  let normalized = phone.replace(/[^\d+]/g, "");

  // Ensure it starts with +
  if (!normalized.startsWith("+")) {
    // Assume US if no country code
    normalized = "+1" + normalized;
  }

  return normalized;
}

/**
 * Hash a phone number using SHA-256
 * This happens client-side before upload
 */
async function hashPhone(phone: string): Promise<string> {
  const normalized = normalizePhone(phone);
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check if running on a mobile platform with contact access
 */
function isMobilePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Hook for managing phone verification
 */
export function usePhoneVerification() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getPhoneStatus();
      setStatus(response);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch phone status"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const sendCode = useCallback(async (phoneNumber: string) => {
    try {
      setSending(true);
      setError(null);
      const result = await api.sendPhoneVerificationCode(phoneNumber);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to send code");
      setError(error);
      throw error;
    } finally {
      setSending(false);
    }
  }, []);

  const verifyCode = useCallback(async (code: string) => {
    try {
      setVerifying(true);
      setError(null);
      const result = await api.verifyPhone(code);
      await fetchStatus(); // Refresh status after verification
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to verify code");
      setError(error);
      throw error;
    } finally {
      setVerifying(false);
    }
  }, [fetchStatus]);

  const removePhone = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await api.removePhoneNumber();
      await fetchStatus();
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to remove phone");
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  return {
    status,
    loading,
    sending,
    verifying,
    error,
    refetch: fetchStatus,
    sendCode,
    verifyCode,
    removePhone,
  };
}

/**
 * Hook for syncing phone contacts and discovering users
 */
export function useContactSync() {
  const [discovered, setDiscovered] = useState<DiscoveredContact[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<"granted" | "denied" | "unknown">("unknown");

  const isMobile = isMobilePlatform();

  // Fetch already discovered contacts
  const fetchDiscovered = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getDiscoveredContacts();
      setDiscovered(response.discovered);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch discovered contacts"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDiscovered();
  }, [fetchDiscovered]);

  // Request contact permission (mobile only)
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isMobile) {
      setError(new Error("Contact sync is only available on mobile devices"));
      return false;
    }

    try {
      // Dynamically import Capacitor Contacts plugin
      const { Contacts } = await import("@capacitor-community/contacts");
      const permission = await Contacts.requestPermissions();
      const granted = permission.contacts === "granted";
      setPermissionStatus(granted ? "granted" : "denied");
      return granted;
    } catch (err) {
      console.error("Failed to request contact permission:", err);
      setPermissionStatus("denied");
      return false;
    }
  }, [isMobile]);

  // Get contacts from device and sync to server
  const syncContacts = useCallback(async (): Promise<SyncResult | null> => {
    if (!isMobile) {
      setError(new Error("Contact sync is only available on mobile devices"));
      return null;
    }

    try {
      setSyncing(true);
      setError(null);

      // Dynamically import Capacitor Contacts plugin
      const { Contacts } = await import("@capacitor-community/contacts");

      // Request permission if not already granted
      const permission = await Contacts.requestPermissions();
      if (permission.contacts !== "granted") {
        setPermissionStatus("denied");
        throw new Error("Contact permission denied");
      }
      setPermissionStatus("granted");

      // Get contacts with phone numbers
      const result = await Contacts.getContacts({
        projection: {
          phones: true,
        },
      });

      // Extract and normalize phone numbers
      const phoneNumbers: string[] = [];
      for (const contact of result.contacts) {
        if (contact.phones) {
          for (const phone of contact.phones) {
            if (phone.number) {
              const normalized = normalizePhone(phone.number);
              if (normalized.length >= 10) {
                phoneNumbers.push(normalized);
              }
            }
          }
        }
      }

      // Remove duplicates
      const uniquePhones = [...new Set(phoneNumbers)];

      // Hash all phone numbers
      const phoneHashes = await Promise.all(uniquePhones.map(hashPhone));

      // Upload to server
      const syncResult = await api.syncContacts(phoneHashes);

      // Update discovered list
      setDiscovered(syncResult.discovered_users);

      return syncResult;
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to sync contacts");
      setError(error);
      throw error;
    } finally {
      setSyncing(false);
    }
  }, [isMobile]);

  // Clear uploaded contact hashes
  const clearHashes = useCallback(async () => {
    try {
      setSyncing(true);
      await api.clearContactHashes();
      setDiscovered([]);
      setError(null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to clear hashes");
      setError(error);
      throw error;
    } finally {
      setSyncing(false);
    }
  }, []);

  return {
    discovered,
    syncing,
    loading,
    error,
    isMobile,
    permissionStatus,
    refetch: fetchDiscovered,
    requestPermission,
    syncContacts,
    clearHashes,
  };
}

/**
 * Hook for discovery notifications (when contacts join NoChat)
 */
export function useDiscoveryNotifications() {
  const [notifications, setNotifications] = useState<DiscoveredContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getDiscoveryNotifications();
      setNotifications(response.notifications);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch notifications"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = useCallback(async (ids?: string[]) => {
    try {
      await api.markDiscoveryNotificationsRead(ids);
      await fetchNotifications();
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to mark as read");
      setError(error);
      throw error;
    }
  }, [fetchNotifications]);

  const count = notifications.length;

  return {
    notifications,
    count,
    loading,
    error,
    refetch: fetchNotifications,
    markAsRead,
  };
}
