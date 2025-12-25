"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface Contact {
  id: string;
  user_id: string;
  contact_user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  contact_user: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
  };
}

export interface InviteCode {
  id: string;
  user_id: string;
  code: string;
  max_uses?: number;
  use_count: number;
  expires_at?: string;
  is_active: boolean;
  created_at: string;
}

export interface InviteInfo {
  code: string;
  user: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
  };
  is_valid: boolean;
  expires_at?: string;
  remaining_uses?: number;
}

export interface UserSettings {
  user_id: string;
  require_contact_approval: boolean;
  updated_at: string;
}

export function useContacts(status?: "pending" | "accepted" | "blocked") {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getContacts(status);
      setContacts(response.contacts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch contacts"));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const sendRequest = useCallback(async (userId: string) => {
    const response = await api.sendContactRequest(userId);
    await fetchContacts();
    return response;
  }, [fetchContacts]);

  const acceptRequest = useCallback(async (contactId: string) => {
    await api.updateContact(contactId, "accepted");
    await fetchContacts();
  }, [fetchContacts]);

  const blockContact = useCallback(async (contactId: string) => {
    await api.updateContact(contactId, "blocked");
    await fetchContacts();
  }, [fetchContacts]);

  const deleteContact = useCallback(async (contactId: string) => {
    await api.deleteContact(contactId);
    await fetchContacts();
  }, [fetchContacts]);

  return {
    contacts,
    loading,
    error,
    refetch: fetchContacts,
    sendRequest,
    acceptRequest,
    blockContact,
    deleteContact,
  };
}

export function usePendingRequests() {
  const [requests, setRequests] = useState<Contact[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const [requestsRes, countRes] = await Promise.all([
        api.getPendingRequests(),
        api.getPendingRequestCount(),
      ]);
      setRequests(requestsRes.requests);
      setCount(countRes.count);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch pending requests"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const acceptRequest = useCallback(async (contactId: string) => {
    await api.updateContact(contactId, "accepted");
    await fetchRequests();
  }, [fetchRequests]);

  const blockRequest = useCallback(async (contactId: string) => {
    await api.updateContact(contactId, "blocked");
    await fetchRequests();
  }, [fetchRequests]);

  return {
    requests,
    count,
    loading,
    error,
    refetch: fetchRequests,
    acceptRequest,
    blockRequest,
  };
}

export function useInvites() {
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchInvites = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getUserInvites();
      setInvites(response.invites);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch invites"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const createInvite = useCallback(async (options?: { max_uses?: number; expires_in?: number }) => {
    const invite = await api.createInvite(options);
    await fetchInvites();
    return invite;
  }, [fetchInvites]);

  const deactivateInvite = useCallback(async (inviteId: string) => {
    await api.deactivateInvite(inviteId);
    await fetchInvites();
  }, [fetchInvites]);

  return {
    invites,
    loading,
    error,
    refetch: fetchInvites,
    createInvite,
    deactivateInvite,
  };
}

export function useInviteInfo(code: string | null) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!code) {
      setInfo(null);
      return;
    }

    const fetchInfo = async () => {
      try {
        setLoading(true);
        const response = await api.getInviteInfo(code);
        setInfo(response);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch invite info"));
        setInfo(null);
      } finally {
        setLoading(false);
      }
    };

    fetchInfo();
  }, [code]);

  const acceptInvite = useCallback(async () => {
    if (!code) throw new Error("No invite code");
    return api.acceptInvite(code);
  }, [code]);

  return {
    info,
    loading,
    error,
    acceptInvite,
  };
}

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getUserSettings();
      setSettings(response);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch settings"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback(async (newSettings: { require_contact_approval?: boolean }) => {
    const response = await api.updateUserSettings(newSettings);
    setSettings(response);
    return response;
  }, []);

  return {
    settings,
    loading,
    error,
    refetch: fetchSettings,
    updateSettings,
  };
}
