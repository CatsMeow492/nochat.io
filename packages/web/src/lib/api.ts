const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// Custom error class to identify auth errors
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    if (typeof window === "undefined") return null;
    // Try the direct token first (set during login)
    const directToken = localStorage.getItem("token");
    if (directToken) return directToken;

    // Fall back to zustand persisted store
    try {
      const authStore = localStorage.getItem("nochat-auth");
      if (authStore) {
        const parsed = JSON.parse(authStore);
        return parsed?.state?.token || null;
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      // Handle 401 Unauthorized - clear token and throw AuthError
      if (response.status === 401) {
        localStorage.removeItem("token");
        throw new AuthError("Session expired. Please sign in again.");
      }

      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Request failed: ${response.status}`);
    }

    return response.json();
  }

  // Auth endpoints
  async signUp(data: {
    username: string;
    email: string;
    password: string;
  }) {
    return this.request<{ user: any; token: string }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async signIn(data: { email: string; password: string }) {
    return this.request<{ user: any; token: string }>("/api/auth/signin", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async signInAnonymous() {
    return this.request<{ user: any; token: string }>("/api/auth/anonymous", {
      method: "POST",
    });
  }

  async signInWithWallet(data: { address: string; signature: string }) {
    return this.request<{ user: any; token: string }>("/api/auth/wallet", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Phone auth
  async sendPhoneCode(phoneNumber: string) {
    return this.request<{ success: boolean; message: string }>(
      "/api/auth/phone/send-code",
      {
        method: "POST",
        body: JSON.stringify({ phone_number: phoneNumber }),
      }
    );
  }

  async verifyPhoneCode(phoneNumber: string, code: string) {
    return this.request<{ user: any; token: string; is_new_user: boolean }>(
      "/api/auth/phone/verify",
      {
        method: "POST",
        body: JSON.stringify({ phone_number: phoneNumber, code }),
      }
    );
  }

  async getMe() {
    return this.request<{ user: any }>("/api/users/me");
  }

  // Profile endpoints
  async getMyProfile() {
    return this.request<{
      id: string;
      username: string;
      email?: string;
      display_name: string;
      avatar_url?: string;
      bio?: string;
      job_title?: string;
      company?: string;
      location?: string;
      website?: string;
      relationship_status?: string;
      pronouns?: string;
      birthday?: string;
      created_at: string;
      updated_at: string;
    }>("/api/users/me/profile");
  }

  async updateMyProfile(data: {
    display_name?: string;
    avatar_url?: string;
    bio?: string;
    job_title?: string;
    company?: string;
    location?: string;
    website?: string;
    relationship_status?: string;
    pronouns?: string;
    birthday?: string;
  }) {
    return this.request<{
      id: string;
      username: string;
      email?: string;
      display_name: string;
      avatar_url?: string;
      bio?: string;
      job_title?: string;
      company?: string;
      location?: string;
      website?: string;
      relationship_status?: string;
      pronouns?: string;
      birthday?: string;
      created_at: string;
      updated_at: string;
    }>("/api/users/me/profile", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getUserProfile(userId: string) {
    return this.request<{
      id: string;
      username: string;
      display_name: string;
      avatar_url?: string;
      bio?: string;
      job_title?: string;
      company?: string;
      location?: string;
      website?: string;
      relationship_status?: string;
      pronouns?: string;
      created_at: string;
    }>(`/api/users/${userId}/profile`);
  }

  async searchUsers(query: string, limit?: number) {
    const params = new URLSearchParams({ q: query });
    if (limit) params.set("limit", limit.toString());
    return this.request<{
      users: Array<{
        id: string;
        username: string;
        display_name: string;
        email?: string;
        avatar_url?: string;
      }>;
    }>(`/api/users/search?${params.toString()}`);
  }

  // Conversations
  async getConversations() {
    return this.request<{ conversations: any[] }>("/api/conversations");
  }

  async createConversation(data: {
    type: "direct" | "group" | "channel";
    name?: string;
    participantIds?: string[];
  }) {
    // Backend expects "participants" field, not "participantIds"
    const payload = {
      type: data.type,
      name: data.name,
      participants: data.participantIds,
    };
    return this.request<{ conversation: any }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async deleteConversation(conversationId: string) {
    return this.request<{ success: boolean }>(`/api/conversations/${conversationId}`, {
      method: "DELETE",
    });
  }

  async getMessages(conversationId: string, params?: { limit?: number; before?: string }) {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.before) queryParams.set("before", params.before);

    const query = queryParams.toString();
    return this.request<{ messages: any[] }>(
      `/api/conversations/${conversationId}/messages${query ? `?${query}` : ""}`
    );
  }

  async getParticipants(conversationId: string) {
    return this.request<{
      participants: Array<{
        id: string;
        conversation_id: string;
        user_id: string;
        role: string;
        joined_at: string;
        last_read_at: string;
        is_muted: boolean;
      }>;
    }>(`/api/conversations/${conversationId}/participants`);
  }

  async sendMessage(conversationId: string, data: { content: string; encrypted?: boolean }) {
    // Transform frontend format to backend expected format
    // Note: message_type is the content type (text, image, etc.)
    // encryption_version indicates if the content is encrypted (1 = encrypted, 0 = plaintext)
    return this.request<{ message: any }>(
      `/api/conversations/${conversationId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          encrypted_content: data.content,
          message_type: "text",
          encryption_version: data.encrypted ? 1 : 0,
        }),
      }
    );
  }

  // Crypto endpoints
  async uploadIdentityKey(publicKey: string) {
    return this.request("/api/crypto/keys/identity", {
      method: "POST",
      body: JSON.stringify({ public_key: publicKey }),
    });
  }

  async uploadSignedPreKey(data: {
    key_id: number;
    kyber_public_key: string;
    signature: string;
  }) {
    return this.request("/api/crypto/keys/prekey", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async uploadOneTimePreKeys(
    prekeys: Array<{ key_id: number; kyber_public_key: string }>
  ) {
    return this.request("/api/crypto/keys/prekeys", {
      method: "POST",
      body: JSON.stringify({ prekeys }),
    });
  }

  async getPreKeyBundle(userId: string) {
    return this.request<{
      user_id: string;
      identity_key: { dilithium_public_key: string; key_fingerprint: string };
      signed_prekey: {
        key_id: number;
        kyber_public_key: string;
        signature: string;
      };
      one_time_prekey?: { key_id: number; kyber_public_key: string };
      bundle_version: number;
    }>(`/api/crypto/bundles/${userId}`);
  }

  // Sealed sender endpoints
  async uploadSealedSenderKey(publicKey: string) {
    return this.request<{
      id: string;
      user_id: string;
      key_fingerprint: string;
      key_version: number;
      status: string;
      created_at: string;
      expires_at?: string;
    }>("/api/crypto/keys/sealed-sender", {
      method: "POST",
      body: JSON.stringify({ public_key: publicKey }),
    });
  }

  async getMySealedSenderKey() {
    return this.request<{
      id: string;
      user_id: string;
      key_fingerprint: string;
      key_version: number;
      status: string;
      created_at: string;
      expires_at?: string;
    }>("/api/crypto/keys/sealed-sender");
  }

  async getSealedSenderStatus() {
    return this.request<{
      enabled: boolean;
      has_key: boolean;
      key_fingerprint?: string;
      key_version?: number;
      has_delivery_verifier: boolean;
    }>("/api/crypto/keys/sealed-sender/status");
  }

  async setSealedSenderEnabled(enabled: boolean) {
    return this.request<{ enabled: boolean }>("/api/crypto/settings/sealed-sender", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
  }

  async getPreKeyBundleWithSealedSender(userId: string) {
    return this.request<{
      user_id: string;
      identity_key: { dilithium_public_key: string; key_fingerprint: string };
      signed_prekey: {
        key_id: number;
        ec_public_key: string;
        kyber_public_key: string;
        signature: string;
      };
      one_time_prekey?: {
        key_id: number;
        ec_public_key: string;
        kyber_public_key: string;
      };
      bundle_version: number;
      sealed_sender?: {
        kyber_public_key: string;
        key_fingerprint: string;
        key_version: number;
        delivery_token: string;
        enabled: boolean;
      };
    }>(`/api/crypto/bundles/${userId}/sealed`);
  }

  async getPreKeyCount() {
    return this.request<{ count: number }>("/api/crypto/keys/prekeys/count");
  }

  // ICE servers
  async getIceServers() {
    return this.request<{ iceServers: any[] }>("/api/ice-servers");
  }

  // Storage
  async requestUploadUrl(data: {
    filename: string;
    content_type: string;
    size: number;
  }) {
    return this.request<{ upload_url: string; storage_key: string }>(
      "/api/storage/upload",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  }

  async requestDownloadUrl(storageKey: string) {
    return this.request<{ download_url: string }>("/api/storage/download", {
      method: "POST",
      body: JSON.stringify({ storage_key: storageKey }),
    });
  }

  // Key Transparency endpoints
  async getTransparencyRoot() {
    return this.request<{
      epoch_number: number;
      root_hash: string;
      tree_size: number;
      signature: string;
      signing_key_fingerprint: string;
      timestamp: string;
    }>("/api/transparency/root");
  }

  async getInclusionProof(userId: string, epoch?: number) {
    const params = new URLSearchParams({ user_id: userId });
    if (epoch !== undefined) {
      params.set("epoch", epoch.toString());
    }
    return this.request<{
      epoch_number: number;
      leaf_hash: string;
      leaf_data: {
        user_id: string;
        identity_key_fingerprint: string;
        signed_prekey_fingerprint?: string;
        key_version: number;
        timestamp: number;
      };
      sibling_path: string[];
      path_bits: string;
      root_hash: string;
    }>(`/api/transparency/inclusion?${params.toString()}`);
  }

  async getConsistencyProof(fromEpoch: number, toEpoch: number) {
    const params = new URLSearchParams({
      from: fromEpoch.toString(),
      to: toEpoch.toString(),
    });
    return this.request<{
      from_epoch: number;
      to_epoch: number;
      from_root: string;
      to_root: string;
      proof_hashes: string[];
    }>(`/api/transparency/consistency?${params.toString()}`);
  }

  async getTransparencyAuditLog(params?: { limit?: number; from_epoch?: number }) {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.from_epoch) queryParams.set("from_epoch", params.from_epoch.toString());
    const query = queryParams.toString();
    return this.request<{
      entries: Array<{
        epoch_number: number;
        change_type: string;
        user_id_commitment: string;
        old_leaf_hash?: string;
        new_leaf_hash?: string;
        timestamp: string;
      }>;
    }>(`/api/transparency/audit-log${query ? `?${query}` : ""}`);
  }

  async getTransparencySigningKeys() {
    return this.request<{
      keys: Array<{
        fingerprint: string;
        public_key: string;
        algorithm: string;
        valid_from: string;
        valid_until?: string;
      }>;
    }>("/api/transparency/signing-keys");
  }

  async updateClientTransparencyState(data: {
    device_id: string;
    last_verified_epoch: number;
    last_verified_root: string;
  }) {
    return this.request<{ success: boolean }>("/api/transparency/client-state", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getClientTransparencyState(deviceId: string) {
    return this.request<{
      device_id: string;
      last_verified_epoch: number;
      last_verified_root: string;
      updated_at: string;
    }>(`/api/transparency/client-state?device_id=${encodeURIComponent(deviceId)}`);
  }

  // ============================================================================
  // Contacts endpoints
  // ============================================================================

  async getContacts(status?: "pending" | "accepted" | "blocked") {
    const params = status ? `?status=${status}` : "";
    return this.request<{
      contacts: Array<{
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
      }>;
    }>(`/api/contacts${params}`);
  }

  async sendContactRequest(userId: string) {
    return this.request<{
      id: string;
      user_id: string;
      contact_user_id: string;
      status: string;
      created_at: string;
    }>("/api/contacts", {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
  }

  async getPendingRequests() {
    return this.request<{
      requests: Array<{
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
      }>;
    }>("/api/contacts/pending");
  }

  async getPendingRequestCount() {
    return this.request<{ count: number }>("/api/contacts/pending/count");
  }

  async updateContact(contactId: string, status: "accepted" | "blocked") {
    return this.request<{ success: boolean }>(`/api/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
  }

  async deleteContact(contactId: string) {
    return this.request<{ success: boolean }>(`/api/contacts/${contactId}`, {
      method: "DELETE",
    });
  }

  // ============================================================================
  // Invite endpoints
  // ============================================================================

  async createInvite(options?: { max_uses?: number; expires_in?: number }) {
    return this.request<{
      id: string;
      user_id: string;
      code: string;
      max_uses?: number;
      use_count: number;
      expires_at?: string;
      is_active: boolean;
      created_at: string;
    }>("/api/contacts/invites", {
      method: "POST",
      body: JSON.stringify(options || {}),
    });
  }

  async getUserInvites() {
    return this.request<{
      invites: Array<{
        id: string;
        user_id: string;
        code: string;
        max_uses?: number;
        use_count: number;
        expires_at?: string;
        is_active: boolean;
        created_at: string;
      }>;
    }>("/api/contacts/invites");
  }

  async deactivateInvite(inviteId: string) {
    return this.request<{ success: boolean }>(`/api/contacts/invites/${inviteId}`, {
      method: "DELETE",
    });
  }

  async getInviteInfo(code: string) {
    return this.request<{
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
    }>(`/api/contacts/invite/${code}`);
  }

  async acceptInvite(code: string) {
    return this.request<{
      id: string;
      user_id: string;
      contact_user_id: string;
      status: string;
      created_at: string;
    }>(`/api/contacts/invite/${code}/accept`, {
      method: "POST",
    });
  }

  // ============================================================================
  // User settings endpoints
  // ============================================================================

  async getUserSettings() {
    return this.request<{
      user_id: string;
      require_contact_approval: boolean;
      updated_at: string;
    }>("/api/users/settings");
  }

  async updateUserSettings(settings: { require_contact_approval?: boolean }) {
    return this.request<{
      user_id: string;
      require_contact_approval: boolean;
      updated_at: string;
    }>("/api/users/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
  }

  // ============================================================================
  // Phone Verification endpoints
  // ============================================================================

  async sendPhoneVerificationCode(phoneNumber: string) {
    return this.request<{
      success: boolean;
      expires_at: string;
    }>("/api/phone/send-code", {
      method: "POST",
      body: JSON.stringify({ phone_number: phoneNumber }),
    });
  }

  async verifyPhone(code: string) {
    return this.request<{
      success: boolean;
      phone_verified: boolean;
    }>("/api/phone/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  }

  async removePhoneNumber() {
    return this.request<{ success: boolean }>("/api/phone", {
      method: "DELETE",
    });
  }

  async getPhoneStatus() {
    return this.request<{
      has_phone: boolean;
      phone_verified: boolean;
      phone_last_4?: string;
      contacts_synced: boolean;
      last_synced_at?: string;
    }>("/api/phone/status");
  }

  // ============================================================================
  // Contact Discovery endpoints
  // ============================================================================

  async syncContacts(phoneHashes: string[]) {
    return this.request<{
      total_uploaded: number;
      matches_found: number;
      new_matches: number;
      discovered_users: Array<{
        user_id: string;
        username: string;
        display_name: string;
        avatar_url?: string;
        discovered_at: string;
      }>;
    }>("/api/contacts/sync", {
      method: "POST",
      body: JSON.stringify({ phone_hashes: phoneHashes }),
    });
  }

  async getDiscoveredContacts() {
    return this.request<{
      discovered: Array<{
        user_id: string;
        username: string;
        display_name: string;
        avatar_url?: string;
        discovered_at: string;
      }>;
    }>("/api/contacts/discovered");
  }

  async clearContactHashes() {
    return this.request<{ success: boolean }>("/api/contacts/hashes", {
      method: "DELETE",
    });
  }

  async getDiscoveryNotifications() {
    return this.request<{
      notifications: Array<{
        user_id: string;
        username: string;
        display_name: string;
        avatar_url?: string;
        discovered_at: string;
      }>;
    }>("/api/notifications/discovery");
  }

  async markDiscoveryNotificationsRead(notificationIds?: string[]) {
    return this.request<{ success: boolean }>("/api/notifications/discovery/read", {
      method: "POST",
      body: JSON.stringify({ notification_ids: notificationIds || [] }),
    });
  }
}

export const api = new ApiClient(API_URL);
