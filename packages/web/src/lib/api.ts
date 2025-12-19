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

  async getMe() {
    return this.request<{ user: any }>("/api/users/me");
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
    return this.request<{ conversation: any }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify(data),
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

  async sendMessage(conversationId: string, data: { content: string; encrypted?: boolean }) {
    // Transform frontend format to backend expected format
    return this.request<{ message: any }>(
      `/api/conversations/${conversationId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          encrypted_content: data.content,
          message_type: data.encrypted ? "encrypted" : "text",
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
      identity_key: { public_key: string; fingerprint: string };
      signed_prekey: {
        key_id: number;
        kyber_public_key: string;
        signature: string;
      };
      one_time_prekey?: { key_id: number; kyber_public_key: string };
      bundle_version: number;
    }>(`/api/crypto/bundles/${userId}`);
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
}

export const api = new ApiClient(API_URL);
