import { create } from "zustand";

export type EncryptionStatus =
  | "uninitialized"
  | "initializing"
  | "ready"
  | "establishing"
  | "encrypted"
  | "error";

interface PeerSession {
  peerId: string;
  established: boolean;
  keyFingerprint?: string;
  lastUpdated: number;
}

interface CryptoState {
  // E2EE state
  status: EncryptionStatus;
  error: string | null;
  identityFingerprint: string | null;
  preKeyCount: number;

  // Per-peer session state
  sessions: Map<string, PeerSession>;
  pendingSessions: Set<string>;

  // Actions
  setStatus: (status: EncryptionStatus) => void;
  setError: (error: string | null) => void;
  setIdentityFingerprint: (fingerprint: string) => void;
  setPreKeyCount: (count: number) => void;

  addSession: (peerId: string, fingerprint?: string) => void;
  removeSession: (peerId: string) => void;
  setPendingSession: (peerId: string, pending: boolean) => void;

  hasSession: (peerId: string) => boolean;
  isPending: (peerId: string) => boolean;

  reset: () => void;
}

const initialState = {
  status: "uninitialized" as EncryptionStatus,
  error: null,
  identityFingerprint: null,
  preKeyCount: 0,
  sessions: new Map<string, PeerSession>(),
  pendingSessions: new Set<string>(),
};

export const useCryptoStore = create<CryptoState>()((set, get) => ({
  ...initialState,

  setStatus: (status) => set({ status }),

  setError: (error) => set({ error, status: error ? "error" : get().status }),

  setIdentityFingerprint: (fingerprint) =>
    set({ identityFingerprint: fingerprint }),

  setPreKeyCount: (count) => set({ preKeyCount: count }),

  addSession: (peerId, fingerprint) =>
    set((state) => {
      const newSessions = new Map(state.sessions);
      newSessions.set(peerId, {
        peerId,
        established: true,
        keyFingerprint: fingerprint,
        lastUpdated: Date.now(),
      });
      const newPending = new Set(state.pendingSessions);
      newPending.delete(peerId);
      return {
        sessions: newSessions,
        pendingSessions: newPending,
      };
    }),

  removeSession: (peerId) =>
    set((state) => {
      const newSessions = new Map(state.sessions);
      newSessions.delete(peerId);
      return { sessions: newSessions };
    }),

  setPendingSession: (peerId, pending) =>
    set((state) => {
      const newPending = new Set(state.pendingSessions);
      if (pending) {
        newPending.add(peerId);
      } else {
        newPending.delete(peerId);
      }
      return { pendingSessions: newPending };
    }),

  hasSession: (peerId) => get().sessions.has(peerId),

  isPending: (peerId) => get().pendingSessions.has(peerId),

  reset: () => set(initialState),
}));
