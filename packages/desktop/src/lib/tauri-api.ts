/**
 * TypeScript API wrapper for Tauri IPC commands
 *
 * This module provides type-safe wrappers around Tauri's invoke() function
 * for all Rust backend commands.
 */

import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Type Definitions (matching Rust models)
// ============================================================================

export interface AuthResponse {
  success: boolean;
  user?: UserInfo;
  token?: string;
  refreshToken?: string;
  error?: string;
}

export interface UserInfo {
  id: string;
  email?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  isAnonymous: boolean;
}

export interface OAuthUrlResponse {
  url: string;
  state: string;
}

export type OAuthProvider = "google" | "github" | "apple";

export type ConversationType = "direct" | "group" | "channel";

export interface Conversation {
  id: string;
  type: ConversationType;
  name?: string;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt?: string;
  participants: Participant[];
  lastMessage?: MessagePreview;
  unreadCount: number;
}

export interface Participant {
  userId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  role: string;
}

export interface MessagePreview {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: string;
  encrypted: boolean;
  encryptionVersion: number;
  createdAt: string;
}

export type Theme = "light" | "dark" | "system";

export interface Settings {
  theme: Theme;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  autoStart: boolean;
  minimizeToTray: boolean;
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Check if running inside Tauri
 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

// ============================================================================
// Auth API
// ============================================================================

export const auth = {
  /**
   * Sign in with email and password
   */
  login: (email: string, password: string): Promise<AuthResponse> =>
    invoke("login", { email, password }),

  /**
   * Sign out current user
   */
  logout: (): Promise<void> => invoke("logout"),

  /**
   * Get current authenticated user
   */
  getCurrentUser: (): Promise<UserInfo | null> => invoke("get_current_user"),

  /**
   * Start OAuth flow for a provider
   * Opens browser with auth URL
   */
  startOAuth: (provider: OAuthProvider): Promise<OAuthUrlResponse> =>
    invoke("start_oauth", { provider }),

  /**
   * Handle OAuth callback
   * Called when deep link is received
   */
  handleOAuthCallback: (
    code: string,
    callbackState: string
  ): Promise<AuthResponse> =>
    invoke("handle_oauth_callback", { code, callbackState }),

  /**
   * Restore session from database on app startup
   */
  restoreSession: (): Promise<UserInfo | null> => invoke("restore_session"),
};

// ============================================================================
// Messaging API
// ============================================================================

export const messaging = {
  /**
   * Get user's conversations (paginated)
   */
  getConversations: (
    limit: number = 50,
    offset: number = 0
  ): Promise<Conversation[]> =>
    invoke("get_conversations", { limit, offset }),

  /**
   * Get messages for a conversation (paginated)
   */
  getMessages: (
    conversationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Message[]> =>
    invoke("get_messages", { conversationId, limit, offset }),

  /**
   * Send a message to a conversation
   */
  sendMessage: (
    conversationId: string,
    content: string
  ): Promise<Message> =>
    invoke("send_message", { conversationId, content }),

  /**
   * Mark a message as read
   */
  markAsRead: (messageId: string): Promise<void> =>
    invoke("mark_as_read", { messageId }),

  /**
   * Create a new conversation
   */
  createConversation: (participantIds: string[]): Promise<Conversation> =>
    invoke("create_conversation", { participantIds }),

  /**
   * Search for users
   */
  searchUsers: (query: string): Promise<UserInfo[]> =>
    invoke("search_users", { query }),
};

// ============================================================================
// Settings API
// ============================================================================

export const settings = {
  /**
   * Get current settings
   */
  get: (): Promise<Settings> => invoke("get_settings"),

  /**
   * Update settings
   */
  update: (settings: Settings): Promise<Settings> =>
    invoke("update_settings", { settings }),

  /**
   * Reset settings to defaults
   */
  reset: (): Promise<Settings> => invoke("reset_settings"),
};

// ============================================================================
// Crypto API (Signal Protocol - vodozemac)
// ============================================================================

/** Session statistics for a peer */
export interface SessionStats {
  peerId: string;
  sessionId: string;
  messagesSent: number;
  messagesReceived: number;
}

/** One-time key for upload to server */
export interface OneTimeKey {
  keyId: string;
  publicKey: string;
}

export const crypto = {
  /**
   * Initialize the crypto service
   * Should be called on app startup
   */
  init: (): Promise<void> => invoke("init_crypto"),

  /**
   * Get this device's identity public key
   * Used for establishing sessions with peers
   */
  getIdentityKey: (): Promise<string> => invoke("get_identity_key"),

  /**
   * Generate and get one-time keys for upload to server
   */
  getOneTimeKeys: (count?: number): Promise<[string, string][]> =>
    invoke("get_one_time_keys", { count }),

  /**
   * Mark one-time keys as published to server
   */
  markKeysPublished: (): Promise<void> => invoke("mark_keys_published"),

  /**
   * Establish an outbound session with a peer
   * @param peerId - The peer's user ID
   * @param identityKey - The peer's identity public key (base64)
   * @param oneTimeKey - One of the peer's one-time keys (base64)
   */
  establishSession: (
    peerId: string,
    identityKey: string,
    oneTimeKey: string
  ): Promise<void> =>
    invoke("establish_session", { peerId, identityKey, oneTimeKey }),

  /**
   * Check if we have an established session with a peer
   */
  hasSession: (peerId: string): Promise<boolean> =>
    invoke("has_session", { peerId }),

  /**
   * Encrypt a message for a peer using Signal Protocol
   * Requires an established session
   */
  encryptMessage: (peerId: string, plaintext: string): Promise<string> =>
    invoke("encrypt_message", { peerId, plaintext }),

  /**
   * Decrypt a message from a peer using Signal Protocol
   * @param peerId - The peer's user ID
   * @param ciphertext - The encrypted message (base64)
   * @param senderIdentityKey - Optional identity key for establishing inbound session
   */
  decryptMessage: (
    peerId: string,
    ciphertext: string,
    senderIdentityKey?: string
  ): Promise<string> =>
    invoke("decrypt_message", { peerId, ciphertext, senderIdentityKey }),

  /**
   * Get identity key fingerprint for verification
   * Users can compare fingerprints out-of-band
   */
  getFingerprint: (): Promise<string> => invoke("get_fingerprint"),

  /**
   * Get statistics for all active sessions
   */
  getSessionStats: (): Promise<SessionStats[]> => invoke("get_session_stats"),

  /**
   * Check if we need to generate more one-time keys
   * Returns true if count is below threshold
   */
  needsMoreKeys: (): Promise<boolean> => invoke("needs_more_keys"),

  /**
   * Delete session with a peer
   * Use when conversation is deleted or peer is blocked
   */
  deleteSession: (peerId: string): Promise<void> =>
    invoke("delete_session", { peerId }),
};

// ============================================================================
// Default Export
// ============================================================================

export default {
  auth,
  messaging,
  settings,
  crypto,
  isTauri,
};
