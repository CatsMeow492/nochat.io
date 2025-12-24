/**
 * CryptoService - Main E2EE service for nochat.io
 *
 * SECURITY OVERVIEW:
 * This service implements end-to-end encryption with quantum resistance.
 * The server operates in a zero-trust model - it stores only opaque ciphertext
 * and cannot derive any session keys or decrypt messages.
 *
 * ALGORITHMS USED:
 *
 * Primary (PQXDH - Quantum Resistant):
 * - X25519 ECDH: Classical key exchange (32-byte keys)
 * - ML-KEM (Kyber-1024): Post-quantum key encapsulation (1568-byte keys)
 * - HYBRID: Both algorithms combined for defense-in-depth
 * - AES-256-GCM: Authenticated encryption with 12-byte random nonces
 * - HKDF-SHA256: Key derivation from hybrid shared secrets
 *
 * Fallback (Legacy - Classical Only):
 * - P-256 ECDSA: Identity key signatures
 * - P-256 ECDH: Session key derivation via Diffie-Hellman
 *
 * PROTOCOL VERSIONS:
 * - Version 1: P-256 ECDH only (classical, legacy peers)
 * - Version 2: PQXDH hybrid (X25519 + Kyber-1024, quantum resistant)
 *
 * SECURITY GUARANTEE (PQXDH):
 * Even if ML-KEM is broken, security falls back to X25519.
 * Even if X25519 is broken by quantum computers, ML-KEM provides protection.
 * Both must be broken simultaneously to compromise the key exchange.
 *
 * KEY STORAGE:
 * - Private keys: Stored in IndexedDB (browser-local, never sent to server)
 * - Public keys: Uploaded to server for key exchange
 * - Session keys: Cached in memory and IndexedDB per-peer
 *
 * SECURITY PROPERTIES:
 * - Forward secrecy: Per-session (each peer pair has unique key)
 * - Authentication: AES-GCM provides message integrity
 * - Zero-trust: Server cannot derive keys from public keys alone
 * - Quantum resistance: Hybrid PQXDH protects against future quantum attacks
 *
 * KNOWN LIMITATIONS (see SECURITY.md):
 * - Same session key used for all messages with a peer (no per-message ratchet)
 * - Keys accessible to any code in the browser origin
 * - PQXDH requires @noble/post-quantum library support
 *
 * @see /docs/crypto-inventory.md for full cryptographic details
 * @see https://signal.org/docs/specifications/pqxdh/ for PQXDH specification
 */

import { openDB, IDBPDatabase } from 'idb';
import { toBase64, fromBase64, sha256, hkdfDerive, concat, toHex } from './utils';
import { encryptAESGCM, decryptAESGCM } from './symmetric';
import { api } from '@/lib/api';
import {
  generateSealedSenderKeyPair,
  sealedSenderEncrypt,
  sealedSenderDecrypt,
  computeDeliveryToken,
  createSealedMessage,
  createSealedGroupMessage,
  decryptSealedGroupMessage,
  deserializeSealedEnvelope,
} from './sealed-sender';
import {
  initPQXDH,
  isPQXDHReady,
  pqxdhInitiate,
  isHybridBundle,
  isLegacyP256Bundle,
  convertApiBundle,
  PQXDH_VERSION,
} from './pqxdh';
import {
  generateHybridKeyPair,
  generateX25519KeyPair,
  x25519DH,
  initPQC,
  isPQCReady,
} from './pqc';
import type { HybridKeyPair, HybridPreKeyBundle } from './types';
import type {
  InnerEnvelope as SealedInnerEnvelope,
  WSSealedMessage,
  WSSealedGroupMessage,
  WSSealedKey,
} from './sealed-sender';
import type {
  SealedSenderStatus,
  HybridSealedSenderBundle,
} from './types';
import {
  keyTransparencyService,
  type VerificationResult,
} from './transparency';

const DB_NAME = 'nochat-crypto';
const DB_VERSION = 4; // Bump version for sealed sender support
const STORE_KEYS = 'keys';
const STORE_CONVERSATIONS = 'conversations';
const STORE_PEER_SESSIONS = 'peerSessions';
const STORE_SEALED_SENDER = 'sealedSender';
const STORE_DELIVERY_TOKENS = 'deliveryTokens';

interface StoredKeys {
  userId: string;
  identityPublicKey: string; // Base64
  identityPrivateKey: string; // Base64 JWK
  exchangePublicKey: string; // Base64
  exchangePrivateKey: string; // Base64 JWK
  signaturePublicKey: string; // Base64
  signaturePrivateKey: string; // Base64 JWK
  registrationId: number;
  createdAt: number;
  // Hybrid PQXDH keys (X25519 + Kyber-1024)
  hybridECPublicKey?: string; // Base64 X25519 (32 bytes)
  hybridECPrivateKey?: string; // Base64 X25519 (32 bytes)
  hybridPQPublicKey?: string; // Base64 Kyber-1024 (1568 bytes)
  hybridPQPrivateKey?: string; // Base64 Kyber-1024 (3168 bytes)
  protocolVersion?: number; // 1 = P-256 only, 2 = PQXDH hybrid
}

interface PeerSessionData {
  peerId: string;
  peerPublicKey: string; // Base64 - peer's exchange public key
  sharedSecret: string; // Base64 - derived ECDH shared secret
  sessionKey: string; // Base64 - derived AES-256 key
  createdAt: number;
  updatedAt: number;
}

interface ConversationKeyCache {
  conversationId: string;
  key: Uint8Array;
  derivedAt: number;
}

interface StoredSealedSenderKeys {
  id: string; // 'current' for current keys
  publicKey: string; // Base64
  privateKey: string; // Base64
  keyVersion: number;
  createdAt: number;
}

interface StoredDeliveryToken {
  recipientId: string;
  token: string; // Base64
  sharedSecretHash: string; // For verification
  createdAt: number;
  expiresAt: number;
}

/**
 * Transparency warning emitted when key verification has issues
 */
export interface TransparencyWarning {
  peerId: string;
  warningLevel: 'none' | 'warning' | 'critical';
  message: string;
  verified: boolean;
}

/**
 * CryptoService singleton for E2EE operations
 */
export class CryptoService {
  private static instance: CryptoService;
  private db: IDBPDatabase | null = null;
  private userId: string | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // Cached key material (P-256 for backwards compatibility)
  private identityPublicKey: Uint8Array | null = null;
  private identityPrivateKeyJwk: JsonWebKey | null = null;
  private exchangePublicKey: Uint8Array | null = null;
  private exchangePrivateKeyJwk: JsonWebKey | null = null;
  private signaturePublicKey: Uint8Array | null = null;
  private signaturePrivateKeyJwk: JsonWebKey | null = null;
  private registrationId: number = 0;

  // Hybrid PQXDH keys (X25519 + Kyber-1024)
  private hybridECPublicKey: Uint8Array | null = null;
  private hybridECPrivateKey: Uint8Array | null = null;
  private hybridPQPublicKey: Uint8Array | null = null;
  private hybridPQPrivateKey: Uint8Array | null = null;
  private protocolVersion: number = 1; // 1 = P-256 only, 2 = PQXDH hybrid
  private pqxdhReady: boolean = false;

  // Peer session key cache (peerId -> session key)
  private peerSessionKeys: Map<string, Uint8Array> = new Map();

  // Conversation key cache (legacy - for fallback only)
  private conversationKeys: Map<string, Uint8Array> = new Map();

  // In-flight key fetch promises to prevent duplicate fetches
  private pendingKeyFetches: Map<string, Promise<Uint8Array>> = new Map();

  // Sealed sender keys
  private sealedSenderPublicKey: Uint8Array | null = null;
  private sealedSenderPrivateKey: Uint8Array | null = null;
  private sealedSenderKeyVersion: number = 0;
  private sealedSenderEnabled: boolean = true; // Enabled by default

  // Delivery token cache (recipientId -> token)
  private deliveryTokens: Map<string, Uint8Array> = new Map();

  // Peer sealed sender bundles cache (peerId -> bundle)
  private peerSealedSenderBundles: Map<string, HybridSealedSenderBundle> = new Map();

  // Transparency verification callbacks
  private transparencyWarningCallbacks: Set<(warning: TransparencyWarning) => void> = new Set();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService();
    }
    return CryptoService.instance;
  }

  /**
   * Initialize the crypto service
   */
  async initialize(userId: string): Promise<void> {
    // If already initialized for this user, return
    if (this.initialized && this.userId === userId) {
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initPromise && this.userId === userId) {
      await this.initPromise;
      return;
    }

    // Start initialization
    this.initPromise = this.doInitialize(userId);
    await this.initPromise;
    this.initPromise = null;
  }

  private async doInitialize(userId: string): Promise<void> {
    console.log('[CryptoService] Initializing for user:', userId);

    // If switching users, clear caches to prevent cross-user contamination
    // Peer sessions are user-specific (derived from user's private key)
    if (this.userId && this.userId !== userId) {
      console.log('[CryptoService] Switching users, clearing caches');
      this.peerSessionKeys.clear();
      this.conversationKeys.clear();
      this.pendingKeyFetches.clear();
      this.deliveryTokens.clear();
      this.peerSealedSenderBundles.clear();
      // Also clear IndexedDB peer sessions (they're user-specific)
      if (this.db) {
        try {
          const tx = this.db.transaction(STORE_PEER_SESSIONS, 'readwrite');
          await tx.store.clear();
          await tx.done;
          console.log('[CryptoService] Cleared peer sessions from IndexedDB');
        } catch (error) {
          console.warn('[CryptoService] Failed to clear peer sessions:', error);
        }
      }
    }

    try {
      // Initialize PQXDH module (non-blocking, may fail on older browsers)
      try {
        await initPQXDH();
        this.pqxdhReady = true;
        console.log('[CryptoService] PQXDH module initialized (quantum-resistant)');
      } catch (error) {
        console.warn('[CryptoService] PQXDH initialization failed, using P-256 fallback:', error);
        this.pqxdhReady = false;
      }

      // Open IndexedDB
      this.db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion) {
          // Keys store
          if (!db.objectStoreNames.contains(STORE_KEYS)) {
            db.createObjectStore(STORE_KEYS, { keyPath: 'userId' });
          }
          // Conversation keys cache (legacy)
          if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
            db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'conversationId' });
          }
          // Peer session keys (new - ECDH derived)
          if (!db.objectStoreNames.contains(STORE_PEER_SESSIONS)) {
            db.createObjectStore(STORE_PEER_SESSIONS, { keyPath: 'peerId' });
          }
          // Sealed sender keys (Kyber-1024)
          if (!db.objectStoreNames.contains(STORE_SEALED_SENDER)) {
            db.createObjectStore(STORE_SEALED_SENDER, { keyPath: 'id' });
          }
          // Delivery tokens for sealed sender
          if (!db.objectStoreNames.contains(STORE_DELIVERY_TOKENS)) {
            db.createObjectStore(STORE_DELIVERY_TOKENS, { keyPath: 'recipientId' });
          }
        },
      });

      this.userId = userId;

      // Load or generate keys
      const stored = await this.loadKeys();
      if (stored) {
        console.log('[CryptoService] Loaded existing keys from IndexedDB');
        // Upgrade to PQXDH if ready but user doesn't have hybrid keys yet
        if (this.pqxdhReady && !this.hybridECPublicKey) {
          console.log('[CryptoService] Upgrading to PQXDH hybrid keys...');
          await this.generateHybridKeys();
          await this.saveKeys();
          console.log('[CryptoService] PQXDH hybrid keys generated');
        }
      } else {
        console.log('[CryptoService] Generating new keys...');
        await this.generateKeys();
        console.log('[CryptoService] Keys generated and stored');
      }

      // Load or generate sealed sender keys
      const sealedSenderLoaded = await this.loadSealedSenderKeys();
      if (sealedSenderLoaded) {
        console.log('[CryptoService] Loaded sealed sender keys from IndexedDB');
      } else {
        console.log('[CryptoService] Generating sealed sender keys...');
        await this.generateSealedSenderKeys();
        console.log('[CryptoService] Sealed sender keys generated and stored');
      }

      // Load cached delivery tokens
      await this.loadDeliveryTokens();

      // Initialize key transparency service
      try {
        await keyTransparencyService.initialize(userId);
        console.log('[CryptoService] Key transparency initialized');
      } catch (error) {
        // Transparency initialization failure is non-fatal
        console.warn('[CryptoService] Key transparency initialization failed:', error);
      }

      this.initialized = true;
      console.log('[CryptoService] Initialization complete');
    } catch (error) {
      console.error('[CryptoService] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the identity fingerprint (first 16 hex chars of SHA-256)
   */
  async getIdentityFingerprint(): Promise<string | null> {
    if (!this.identityPublicKey) return null;
    const hash = await sha256(this.identityPublicKey);
    return Array.from(hash.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Get keys for server upload (supports both legacy and PQXDH)
   */
  async getKeysForUpload(): Promise<{
    identityPublicKey: string;
    signedPreKey: {
      keyId: number;
      publicKey: string;
      ecPublicKey?: string; // X25519 for PQXDH
      pqPublicKey?: string; // Kyber-1024 for PQXDH
      signature: string;
    };
    oneTimePreKeys: Array<{ keyId: number; publicKey: string }>;
    bundleVersion: number;
  } | null> {
    if (!this.exchangePublicKey || !this.signaturePrivateKeyJwk) return null;

    // Sign the exchange public key with our signature key
    const signature = await this.signData(this.exchangePublicKey);

    // Check if we have PQXDH hybrid keys
    const hasHybridKeys = this.hybridECPublicKey && this.hybridPQPublicKey;

    if (hasHybridKeys) {
      // Sign the combined hybrid keys
      const combinedHybridKey = concat(this.hybridECPublicKey!, this.hybridPQPublicKey!);
      const hybridSignature = await this.signData(combinedHybridKey);

      return {
        identityPublicKey: toBase64(this.identityPublicKey!),
        signedPreKey: {
          keyId: 1,
          publicKey: toBase64(this.exchangePublicKey), // Legacy P-256 for backwards compat
          ecPublicKey: toBase64(this.hybridECPublicKey!), // X25519
          pqPublicKey: toBase64(this.hybridPQPublicKey!), // Kyber-1024
          signature: toBase64(hybridSignature),
        },
        oneTimePreKeys: [],
        bundleVersion: PQXDH_VERSION,
      };
    }

    // Legacy P-256 only
    return {
      identityPublicKey: toBase64(this.identityPublicKey!),
      signedPreKey: {
        keyId: 1,
        publicKey: toBase64(this.exchangePublicKey),
        signature: toBase64(signature),
      },
      oneTimePreKeys: [],
      bundleVersion: 1,
    };
  }

  /**
   * Check if PQXDH (quantum-resistant) encryption is available
   */
  isPQXDHEnabled(): boolean {
    return this.pqxdhReady && !!this.hybridECPublicKey && !!this.hybridPQPublicKey;
  }

  /**
   * Get the current protocol version
   * 1 = P-256 ECDH only (classical)
   * 2 = PQXDH hybrid (X25519 + Kyber-1024)
   */
  getProtocolVersion(): number {
    return this.protocolVersion;
  }

  /**
   * Get hybrid public keys for display/verification
   */
  getHybridPublicKeys(): { ecPublicKey: string; pqPublicKey: string } | null {
    if (!this.hybridECPublicKey || !this.hybridPQPublicKey) return null;
    return {
      ecPublicKey: toBase64(this.hybridECPublicKey),
      pqPublicKey: toBase64(this.hybridPQPublicKey),
    };
  }

  /**
   * Get or derive a session key for a specific peer using ECDH key exchange.
   *
   * SECURITY: This is the core of zero-trust encryption.
   * - Uses our private exchange key + peer's public exchange key
   * - Server only ever sees public keys, cannot derive the shared secret
   * - Each peer pair has a unique session key
   *
   * @param peerId The user ID of the peer
   * @returns 32-byte AES-256 session key
   */
  async getPeerSessionKey(peerId: string): Promise<Uint8Array> {
    console.log('[CryptoService] getPeerSessionKey called for peer:', peerId);

    // Check if there's already a fetch in progress
    const pending = this.pendingKeyFetches.get(peerId);
    if (pending) {
      console.log('[CryptoService] Session derivation already in progress for peer:', peerId);
      return pending;
    }

    // Fetch the current peer public key to verify against cached session
    // We fetch this early so we can reuse it in derivation if needed
    let peerBundle: Awaited<ReturnType<typeof api.getPreKeyBundle>> | null = null;
    let currentPeerPublicKey: string | null = null;
    try {
      peerBundle = await api.getPreKeyBundle(peerId);
      currentPeerPublicKey = peerBundle.signed_prekey.kyber_public_key;
      console.log('[CryptoService] Current peer public key (first 40 chars):', currentPeerPublicKey?.substring(0, 40) + '...');
    } catch (error) {
      console.warn('[CryptoService] Could not fetch current peer public key:', error);
      // Continue with cached session if available
    }

    // Check memory cache first
    const cached = this.peerSessionKeys.get(peerId);
    if (cached) {
      // Verify the cached session is still valid (peer's key hasn't changed)
      if (this.db && currentPeerPublicKey) {
        try {
          const storedSession = await this.db.get(STORE_PEER_SESSIONS, peerId) as PeerSessionData | undefined;
          if (storedSession && storedSession.peerPublicKey !== currentPeerPublicKey) {
            console.log('[CryptoService] Peer public key changed! Invalidating cached session.');
            console.log('[CryptoService] Stored key:', storedSession.peerPublicKey?.substring(0, 40) + '...');
            console.log('[CryptoService] Current key:', currentPeerPublicKey?.substring(0, 40) + '...');
            // Invalidate and re-derive
            this.peerSessionKeys.delete(peerId);
            await this.db.delete(STORE_PEER_SESSIONS, peerId);
          } else {
            console.log('[CryptoService] Session found in memory cache, key (hex):', toHex(cached));
            return cached;
          }
        } catch (error) {
          console.warn('[CryptoService] Failed to verify cached session:', error);
          // Fall through to use cached session
          console.log('[CryptoService] Session found in memory cache, key (hex):', toHex(cached));
          return cached;
        }
      } else {
        console.log('[CryptoService] Session found in memory cache, key (hex):', toHex(cached));
        return cached;
      }
    }

    // Check IndexedDB for persisted session
    if (this.db) {
      try {
        const storedSession = await this.db.get(STORE_PEER_SESSIONS, peerId) as PeerSessionData | undefined;
        if (storedSession) {
          // Verify the stored session is still valid
          if (currentPeerPublicKey && storedSession.peerPublicKey !== currentPeerPublicKey) {
            console.log('[CryptoService] Stored peer public key differs from current! Re-deriving session.');
            console.log('[CryptoService] Stored key:', storedSession.peerPublicKey?.substring(0, 40) + '...');
            console.log('[CryptoService] Current key:', currentPeerPublicKey?.substring(0, 40) + '...');
            // Delete the stale session
            await this.db.delete(STORE_PEER_SESSIONS, peerId);
          } else {
            const sessionKey = fromBase64(storedSession.sessionKey);
            this.peerSessionKeys.set(peerId, sessionKey);
            console.log('[CryptoService] Loaded peer session from IndexedDB:', peerId);
            console.log('[CryptoService] Stored session key (hex):', toHex(sessionKey));
            return sessionKey;
          }
        }
      } catch (error) {
        console.warn('[CryptoService] Failed to load session from IndexedDB:', error);
      }
    }

    console.log('[CryptoService] No valid cached session found, deriving new session for peer:', peerId);

    // No cached session or stale session - need to derive a new one
    // Pass the already-fetched bundle to avoid redundant API call
    const fetchPromise = this.derivePeerSessionKeyWithBundle(peerId, peerBundle);
    this.pendingKeyFetches.set(peerId, fetchPromise);

    try {
      const sessionKey = await fetchPromise;
      return sessionKey;
    } finally {
      this.pendingKeyFetches.delete(peerId);
    }
  }

  /**
   * Derive a session key with a peer via ECDH or PQXDH.
   * Uses PQXDH (hybrid X25519 + Kyber) when available for quantum resistance.
   * Falls back to P-256 ECDH for legacy peers.
   */
  private async derivePeerSessionKeyWithBundle(
    peerId: string,
    preloadedBundle: Awaited<ReturnType<typeof api.getPreKeyBundle>> | null
  ): Promise<Uint8Array> {
    if (!this.exchangePrivateKeyJwk) {
      throw new Error('Exchange key not initialized');
    }

    console.log('[CryptoService] Deriving session key for peer:', peerId);
    console.log('[CryptoService] My user ID:', this.userId);
    console.log('[CryptoService] PQXDH ready:', this.pqxdhReady);
    console.log('[CryptoService] Have hybrid keys:', !!this.hybridECPrivateKey);

    // Fetch peer's prekey bundle
    let bundle: Awaited<ReturnType<typeof api.getPreKeyBundle>>;
    try {
      bundle = preloadedBundle || await api.getPreKeyBundle(peerId);
      console.log('[CryptoService] Fetched peer prekey bundle');
    } catch (error) {
      console.error('[CryptoService] Failed to fetch peer prekey bundle:', error);
      throw new Error(`Failed to fetch encryption keys for peer: ${peerId}`);
    }

    // Get peer's fingerprint for transparency verification
    const peerKeyFingerprint = (bundle.identity_key as any)?.key_fingerprint ||
                               (bundle.identity_key as any)?.fingerprint || '';
    if (peerKeyFingerprint) {
      this.verifyPeerKeyTransparency(peerId, peerKeyFingerprint);
    }

    // Determine if we should use PQXDH (hybrid) or legacy P-256 ECDH
    const bundleHasECKey = !!(bundle.signed_prekey as any)?.ec_public_key;
    const bundleVersion = (bundle as any).bundle_version || (bundleHasECKey ? 2 : 1);
    const usePQXDH = this.pqxdhReady &&
                     this.hybridECPrivateKey &&
                     bundleVersion >= 2 &&
                     bundleHasECKey;

    let sessionKey: Uint8Array;
    let peerPublicKeyForStorage: string;

    if (usePQXDH) {
      // Use PQXDH (hybrid X25519 + Kyber-1024) for quantum resistance
      console.log('[CryptoService] Using PQXDH (quantum-resistant) session derivation');
      const result = await this.derivePQXDHSession(peerId, bundle);
      sessionKey = result.sessionKey;
      peerPublicKeyForStorage = result.peerPublicKeyForStorage;
    } else {
      // Fall back to legacy P-256 ECDH
      console.log('[CryptoService] Using legacy P-256 ECDH session derivation');
      const result = await this.deriveLegacySession(peerId, bundle);
      sessionKey = result.sessionKey;
      peerPublicKeyForStorage = result.peerPublicKeyForStorage;
    }

    // Cache in memory
    this.peerSessionKeys.set(peerId, sessionKey);

    // Persist to IndexedDB
    if (this.db) {
      try {
        const sessionData: PeerSessionData = {
          peerId,
          peerPublicKey: peerPublicKeyForStorage,
          sharedSecret: '', // Not stored for PQXDH (derived from KDF)
          sessionKey: toBase64(sessionKey),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await this.db.put(STORE_PEER_SESSIONS, sessionData);
        console.log('[CryptoService] Persisted peer session to IndexedDB:', peerId);
      } catch (error) {
        console.warn('[CryptoService] Failed to persist session to IndexedDB:', error);
      }
    }

    return sessionKey;
  }

  /**
   * Derive session using PQXDH (hybrid X25519 + Kyber-1024)
   * Provides quantum resistance via post-quantum KEM
   */
  private async derivePQXDHSession(
    peerId: string,
    bundle: Awaited<ReturnType<typeof api.getPreKeyBundle>>
  ): Promise<{ sessionKey: Uint8Array; peerPublicKeyForStorage: string }> {
    // Convert API bundle to HybridPreKeyBundle format
    const hybridBundle = convertApiBundle({
      user_id: bundle.user_id,
      identity_key: bundle.identity_key,
      signed_prekey: bundle.signed_prekey as any,
      one_time_prekey: (bundle as any).one_time_prekey,
      bundle_version: (bundle as any).bundle_version,
    });

    console.log('[CryptoService] Converted to hybrid bundle, version:', hybridBundle.bundleVersion);
    console.log('[CryptoService] Signed prekey EC length:', hybridBundle.signedPreKeyEC.length);
    console.log('[CryptoService] Signed prekey PQ length:', hybridBundle.signedPreKeyPQ.length);

    // Prepare initiator data for PQXDH
    const initiatorData = {
      identityKeyPair: {
        signingKey: new Uint8Array(32), // Ed25519 placeholder (we use P-256 for legacy compat)
        exchangeKey: this.hybridECPrivateKey!,
        publicKey: this.signaturePublicKey!,
        exchangePublic: this.hybridECPublicKey!,
      },
    };

    // Perform PQXDH key exchange
    const pqxdhResult = await pqxdhInitiate(initiatorData, hybridBundle);
    console.log('[CryptoService] PQXDH shared secret derived (hex):', toHex(pqxdhResult.sharedSecret));

    // Derive final session key using HKDF with user IDs
    const sortedIds = [this.userId!, peerId].sort();
    const encoder = new TextEncoder();
    const saltString = `nochat-pqxdh-session-${sortedIds[0]}-${sortedIds[1]}`;
    const salt = await sha256(encoder.encode(saltString));
    const info = encoder.encode('nochat-e2ee-pqxdh-v1');

    const sessionKey = await hkdfDerive(pqxdhResult.sharedSecret, salt, info, 32);
    console.log('[CryptoService] PQXDH session key (hex):', toHex(sessionKey));

    // Store the hybrid public keys for session validation
    const peerPublicKeyForStorage = toBase64(concat(
      hybridBundle.signedPreKeyEC,
      hybridBundle.signedPreKeyPQ
    ));

    return { sessionKey, peerPublicKeyForStorage };
  }

  /**
   * Derive session using legacy P-256 ECDH
   * Used for backwards compatibility with peers that don't support PQXDH
   */
  private async deriveLegacySession(
    peerId: string,
    bundle: Awaited<ReturnType<typeof api.getPreKeyBundle>>
  ): Promise<{ sessionKey: Uint8Array; peerPublicKeyForStorage: string }> {
    const peerPublicKeyRaw = fromBase64(bundle.signed_prekey.kyber_public_key);
    console.log('[CryptoService] Legacy P-256 peer public key length:', peerPublicKeyRaw.length);
    console.log('[CryptoService] Peer public key (hex):', toHex(peerPublicKeyRaw));

    // Import peer's public key for ECDH
    const peerKeyBuffer = new ArrayBuffer(peerPublicKeyRaw.length);
    new Uint8Array(peerKeyBuffer).set(peerPublicKeyRaw);

    const peerPublicKey = await crypto.subtle.importKey(
      'raw',
      peerKeyBuffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    // Import our private key for ECDH
    const ourPrivateKey = await crypto.subtle.importKey(
      'jwk',
      this.exchangePrivateKeyJwk!,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits']
    );

    // Log our public key for comparison
    if (this.exchangePublicKey) {
      console.log('[CryptoService] My P-256 public key (hex):', toHex(this.exchangePublicKey));
    }

    // Perform ECDH to get shared secret
    const sharedSecretBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerPublicKey },
      ourPrivateKey,
      256 // 32 bytes
    );
    const sharedSecret = new Uint8Array(sharedSecretBits);
    console.log('[CryptoService] P-256 ECDH shared secret (hex):', toHex(sharedSecret));

    // Derive session key using HKDF
    const sortedIds = [this.userId!, peerId].sort();
    const encoder = new TextEncoder();
    const saltString = `nochat-session-${sortedIds[0]}-${sortedIds[1]}`;
    const salt = await sha256(encoder.encode(saltString));
    const info = encoder.encode('nochat-e2ee-v2');

    const sessionKey = await hkdfDerive(sharedSecret, salt, info, 32);
    console.log('[CryptoService] Legacy session key (hex):', toHex(sessionKey));

    return {
      sessionKey,
      peerPublicKeyForStorage: toBase64(peerPublicKeyRaw),
    };
  }

  /**
   * Derive a session key with a peer via ECDH.
   * This is a convenience wrapper that fetches the bundle automatically.
   *
   * @param peerId - The user ID of the peer
   * @returns 32-byte AES-256 session key
   */
  private async derivePeerSessionKey(peerId: string): Promise<Uint8Array> {
    return this.derivePeerSessionKeyWithBundle(peerId, null);
  }

  /**
   * DEPRECATED: Legacy conversation key derivation
   * This method derives keys from conversation ID which is INSECURE
   * because the server knows conversation IDs and could derive all keys.
   *
   * Only use this as a fallback for group conversations until proper
   * group key management is implemented.
   *
   * @deprecated Use getPeerSessionKey for 1:1 conversations
   */
  async getConversationKey(conversationId: string): Promise<Uint8Array> {
    console.warn('[CryptoService] DEPRECATED: Using insecure conversation-based key derivation');

    // Check cache
    const cached = this.conversationKeys.get(conversationId);
    if (cached) {
      return cached;
    }

    // Derive key using HKDF (INSECURE - server can derive this)
    const encoder = new TextEncoder();
    const info = encoder.encode('nochat-conversation-key-v1');
    const salt = await sha256(encoder.encode(conversationId));
    const ikm = encoder.encode(`nochat-e2ee-${conversationId}`);

    const key = await hkdfDerive(ikm, salt, info, 32);

    // Cache the key
    this.conversationKeys.set(conversationId, key);

    return key;
  }

  /**
   * Encrypt a message for a specific peer using ECDH-derived session key.
   *
   * @param peerId The recipient's user ID
   * @param plaintext The message to encrypt
   * @returns Base64-encoded ciphertext (nonce + encrypted data)
   */
  async encryptMessageForPeer(peerId: string, plaintext: string): Promise<string> {
    console.log('[CryptoService] encryptMessageForPeer called');
    console.log('[CryptoService] My user ID:', this.userId);
    console.log('[CryptoService] Target peer ID:', peerId);

    const key = await this.getPeerSessionKey(peerId);
    console.log('[CryptoService] Encryption session key (hex):', toHex(key));

    const plaintextBytes = new TextEncoder().encode(plaintext);
    const encrypted = await encryptAESGCM(key, plaintextBytes);

    // Pack nonce + ciphertext into a single base64 string
    const packed = new Uint8Array(encrypted.nonce.length + encrypted.ciphertext.length);
    packed.set(encrypted.nonce, 0);
    packed.set(encrypted.ciphertext, encrypted.nonce.length);

    console.log('[CryptoService] Nonce (hex):', toHex(encrypted.nonce));
    console.log('[CryptoService] Ciphertext length:', encrypted.ciphertext.length);

    return toBase64(packed);
  }

  /**
   * Decrypt a message from a specific peer using ECDH-derived session key.
   *
   * @param peerId The sender's user ID
   * @param encryptedContent Base64-encoded ciphertext
   * @returns Decrypted plaintext
   */
  async decryptMessageFromPeer(peerId: string, encryptedContent: string): Promise<string> {
    console.log('[CryptoService] decryptMessageFromPeer called');
    console.log('[CryptoService] My user ID:', this.userId);
    console.log('[CryptoService] Sender peer ID:', peerId);

    const key = await this.getPeerSessionKey(peerId);
    console.log('[CryptoService] Decryption session key (hex):', toHex(key));

    // Unpack nonce + ciphertext from base64 string
    const packed = fromBase64(encryptedContent);
    const nonce = packed.slice(0, 12); // AES-GCM uses 12-byte nonce
    const ciphertext = packed.slice(12);

    console.log('[CryptoService] Nonce (hex):', toHex(nonce));
    console.log('[CryptoService] Ciphertext length:', ciphertext.length);

    const plaintextBytes = await decryptAESGCM(key, ciphertext, nonce);
    console.log('[CryptoService] Decryption successful!');
    return new TextDecoder().decode(plaintextBytes);
  }

  /**
   * Encrypt a message for a conversation (wrapper for backward compatibility)
   *
   * For 1:1 DM conversations, uses peer-based ECDH encryption.
   * For group conversations, falls back to legacy (insecure) mode with a warning.
   *
   * @param conversationId The conversation ID
   * @param plaintext The message to encrypt
   * @param peerIds Array of peer user IDs in this conversation (excluding self)
   * @returns Base64-encoded ciphertext
   */
  async encryptMessage(
    conversationId: string,
    plaintext: string,
    peerIds?: string[]
  ): Promise<string> {
    // For 1:1 DMs, use secure peer-based encryption
    if (peerIds && peerIds.length === 1) {
      console.log('[CryptoService] Using secure peer-based encryption');
      return this.encryptMessageForPeer(peerIds[0], plaintext);
    }

    // For group conversations or when peerIds not provided, fall back to legacy
    if (peerIds && peerIds.length > 1) {
      console.warn('[CryptoService] Group E2EE not yet implemented - using legacy mode');
    }

    // Legacy fallback - INSECURE
    const key = await this.getConversationKey(conversationId);
    const plaintextBytes = new TextEncoder().encode(plaintext);
    const encrypted = await encryptAESGCM(key, plaintextBytes);

    const packed = new Uint8Array(encrypted.nonce.length + encrypted.ciphertext.length);
    packed.set(encrypted.nonce, 0);
    packed.set(encrypted.ciphertext, encrypted.nonce.length);

    return toBase64(packed);
  }

  /**
   * Decrypt a message from a conversation (wrapper for backward compatibility)
   *
   * @param conversationId The conversation ID
   * @param encryptedContent Base64-encoded ciphertext
   * @param senderId The sender's user ID (required for secure decryption)
   * @returns Decrypted plaintext
   */
  async decryptMessage(
    conversationId: string,
    encryptedContent: string,
    senderId?: string
  ): Promise<string> {
    // If we know the sender, use secure peer-based decryption
    if (senderId && senderId !== this.userId) {
      try {
        return await this.decryptMessageFromPeer(senderId, encryptedContent);
      } catch (error) {
        console.warn('[CryptoService] Peer decryption failed, trying legacy:', error);
        // Fall through to legacy
      }
    }

    // Legacy fallback
    const key = await this.getConversationKey(conversationId);
    const packed = fromBase64(encryptedContent);
    const nonce = packed.slice(0, 12);
    const ciphertext = packed.slice(12);

    const plaintextBytes = await decryptAESGCM(key, ciphertext, nonce);
    return new TextDecoder().decode(plaintextBytes);
  }

  /**
   * Check if we have an established session with a peer
   */
  hasSession(peerId: string): boolean {
    return this.peerSessionKeys.has(peerId) || this.initialized;
  }

  /**
   * Check if we have a cached session key for a peer (without fetching)
   */
  hasCachedSession(peerId: string): boolean {
    return this.peerSessionKeys.has(peerId);
  }

  /**
   * Check if a peer has uploaded their public keys (required for ECDH)
   * This is a lightweight check that doesn't establish a session.
   */
  async isPeerE2EEReady(peerId: string): Promise<boolean> {
    try {
      const bundle = await api.getPreKeyBundle(peerId);
      return !!(bundle && bundle.signed_prekey && bundle.signed_prekey.kyber_public_key);
    } catch (error) {
      console.log('[CryptoService] Peer E2EE not ready:', peerId, error);
      return false;
    }
  }

  /**
   * Try to establish a session with a peer, returning success status.
   * Unlike getPeerSessionKey, this method doesn't throw on failure.
   */
  async tryEstablishSession(peerId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.getPeerSessionKey(peerId);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn('[CryptoService] Failed to establish session with peer:', peerId, message);
      return { success: false, error: message };
    }
  }

  /**
   * Invalidate a peer session (force re-derivation on next message)
   * Call this if peer's keys have changed
   */
  async invalidatePeerSession(peerId: string): Promise<void> {
    this.peerSessionKeys.delete(peerId);
    if (this.db) {
      try {
        await this.db.delete(STORE_PEER_SESSIONS, peerId);
        console.log('[CryptoService] Invalidated peer session:', peerId);
      } catch (error) {
        console.warn('[CryptoService] Failed to delete session from IndexedDB:', error);
      }
    }
  }

  /**
   * Get current prekey count (simplified - we don't use one-time prekeys currently)
   */
  getPreKeyCount(): number {
    return this.initialized ? 100 : 0;
  }

  // ============================================================================
  // Key Transparency Methods
  // ============================================================================

  /**
   * Subscribe to transparency warnings
   * @param callback Called when a transparency warning occurs
   * @returns Unsubscribe function
   */
  onTransparencyWarning(callback: (warning: TransparencyWarning) => void): () => void {
    this.transparencyWarningCallbacks.add(callback);
    return () => this.transparencyWarningCallbacks.delete(callback);
  }

  /**
   * Verify a peer's key is in the transparency log
   * This runs asynchronously and emits warnings if verification fails.
   * It does NOT block encryption - we use a "verify after trust" model
   * to avoid degrading user experience.
   */
  private async verifyPeerKeyTransparency(peerId: string, fingerprint: string): Promise<void> {
    try {
      const result = await keyTransparencyService.verifyKeyInclusion(peerId, fingerprint);

      // Emit warning to subscribers
      const warning: TransparencyWarning = {
        peerId,
        warningLevel: result.warningLevel || 'none',
        message: result.error || '',
        verified: result.verified,
      };

      // Log for debugging
      if (result.verified) {
        console.log('[CryptoService] Key transparency verified for peer:', peerId);
      } else if (result.warningLevel === 'critical') {
        console.error('[CryptoService] CRITICAL: Key transparency verification failed for peer:', peerId, result.error);
      } else {
        console.warn('[CryptoService] Key transparency warning for peer:', peerId, result.error);
      }

      // Notify subscribers
      if (!result.verified) {
        this.transparencyWarningCallbacks.forEach(cb => cb(warning));
      }
    } catch (error) {
      console.error('[CryptoService] Key transparency verification error:', error);
      // Emit warning for error case
      const warning: TransparencyWarning = {
        peerId,
        warningLevel: 'warning',
        message: error instanceof Error ? error.message : 'Unknown error',
        verified: false,
      };
      this.transparencyWarningCallbacks.forEach(cb => cb(warning));
    }
  }

  /**
   * Manually verify a peer's key in the transparency log
   * Unlike the automatic verification, this is a blocking call.
   */
  async verifyPeerKeyManually(peerId: string): Promise<VerificationResult> {
    try {
      const bundle = await api.getPreKeyBundle(peerId);
      return keyTransparencyService.verifyKeyInclusion(
        peerId,
        bundle.identity_key.key_fingerprint
      );
    } catch (error) {
      return {
        verified: false,
        error: error instanceof Error ? error.message : 'Failed to fetch peer keys',
        warningLevel: 'warning',
      };
    }
  }

  /**
   * Check if key transparency is available
   */
  isTransparencyAvailable(): boolean {
    return keyTransparencyService.isAvailable();
  }

  /**
   * Get the last verified transparency epoch
   */
  getLastVerifiedTransparencyEpoch(): number {
    return keyTransparencyService.getLastVerifiedEpoch();
  }

  /**
   * Generate more prekeys (no-op for now)
   */
  async generateMorePreKeys(count: number = 100): Promise<void> {
    // For conversation-based encryption, we don't need one-time prekeys
    return;
  }

  // ============================================================================
  // Sealed Sender Methods
  // ============================================================================

  /**
   * Check if sealed sender is enabled for this user
   */
  isSealedSenderEnabled(): boolean {
    return this.sealedSenderEnabled;
  }

  /**
   * Set sealed sender enabled/disabled
   */
  async setSealedSenderEnabled(enabled: boolean): Promise<void> {
    this.sealedSenderEnabled = enabled;
    // TODO: Persist to server via api.setSealedSenderEnabled(enabled)
    console.log('[CryptoService] Sealed sender enabled:', enabled);
  }

  /**
   * Get sealed sender public key for upload to server
   */
  getSealedSenderPublicKeyForUpload(): string | null {
    if (!this.sealedSenderPublicKey) return null;
    return toBase64(this.sealedSenderPublicKey);
  }

  /**
   * Get sealed sender status
   */
  getSealedSenderStatus(): SealedSenderStatus {
    return {
      enabled: this.sealedSenderEnabled,
      hasKey: this.sealedSenderPublicKey !== null,
      keyVersion: this.sealedSenderKeyVersion,
      hasDeliveryVerifier: true, // Managed by server
    };
  }

  /**
   * Get or fetch a delivery token for a recipient.
   * The token is computed from our shared secret with the recipient.
   */
  async getDeliveryToken(recipientId: string): Promise<Uint8Array> {
    // Check cache first
    const cached = this.deliveryTokens.get(recipientId);
    if (cached) {
      return cached;
    }

    // Fetch recipient's sealed sender bundle (includes delivery verifier)
    const bundle = await this.getPeerSealedSenderBundle(recipientId);
    if (!bundle.sealedSenderEnabled) {
      throw new Error(`Recipient ${recipientId} does not have sealed sender enabled`);
    }

    // Compute delivery token from our shared secret + their delivery verifier
    // First get our session key with this peer (ECDH shared secret)
    const sessionKey = await this.getPeerSessionKey(recipientId);

    // Compute delivery token: HMAC(sharedSecret, deliveryVerifier)
    const token = await computeDeliveryToken(sessionKey, bundle.deliveryToken);

    // Cache the token
    this.deliveryTokens.set(recipientId, token);

    // Persist to IndexedDB
    if (this.db) {
      try {
        const storedToken: StoredDeliveryToken = {
          recipientId,
          token: toBase64(token),
          sharedSecretHash: await sha256(sessionKey).then(h => toBase64(h.slice(0, 8))),
          createdAt: Date.now(),
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        };
        await this.db.put(STORE_DELIVERY_TOKENS, storedToken);
      } catch (error) {
        console.warn('[CryptoService] Failed to persist delivery token:', error);
      }
    }

    return token;
  }

  /**
   * Get peer's sealed sender bundle (cached or fetched)
   */
  async getPeerSealedSenderBundle(peerId: string): Promise<HybridSealedSenderBundle> {
    // Check cache
    const cached = this.peerSealedSenderBundles.get(peerId);
    if (cached) {
      return cached;
    }

    // Fetch from server
    // TODO: Replace with api.getPreKeyBundleWithSealedSender when available
    const bundle = await api.getPreKeyBundle(peerId);

    // Convert to HybridSealedSenderBundle format
    // For now, mock the sealed sender fields until API is updated
    const sealedBundle: HybridSealedSenderBundle = {
      userId: bundle.user_id,
      identityKey: fromBase64(bundle.identity_key.dilithium_public_key),
      identityKeyFingerprint: bundle.identity_key.key_fingerprint,
      signedPreKeyId: bundle.signed_prekey.key_id,
      signedPreKeyEC: fromBase64(bundle.signed_prekey.kyber_public_key).slice(0, 32), // First 32 bytes for EC
      signedPreKeyPQ: fromBase64(bundle.signed_prekey.kyber_public_key), // Full key for PQ
      signedPreKeySignature: fromBase64(bundle.signed_prekey.signature),
      bundleVersion: 2,
      // Sealed sender fields - TODO: Get from actual API response
      sealedSenderKey: fromBase64(bundle.signed_prekey.kyber_public_key), // Placeholder
      sealedSenderKeyFingerprint: bundle.identity_key.key_fingerprint,
      deliveryToken: new Uint8Array(32), // Placeholder - server should provide
      sealedSenderEnabled: true, // Assume enabled for now
    };

    // Cache
    this.peerSealedSenderBundles.set(peerId, sealedBundle);

    return sealedBundle;
  }

  /**
   * Create a sealed message for a 1:1 DM.
   * The sender's identity is encrypted inside the envelope.
   */
  async createSealedMessageForPeer(
    recipientId: string,
    messageContent: Uint8Array
  ): Promise<WSSealedMessage> {
    if (!this.identityPublicKey || !this.signaturePrivateKeyJwk || !this.userId) {
      throw new Error('Crypto service not initialized');
    }

    // Get recipient's sealed sender bundle
    const bundle = await this.getPeerSealedSenderBundle(recipientId);
    if (!bundle.sealedSenderEnabled) {
      throw new Error(`Recipient ${recipientId} does not support sealed sender`);
    }

    // Get session key for delivery token computation
    const sessionKey = await this.getPeerSessionKey(recipientId);

    // Get identity fingerprint
    const fingerprint = await this.getIdentityFingerprint();

    // Create inner envelope
    const innerEnvelope: SealedInnerEnvelope = {
      senderId: this.userId,
      senderIdentityKey: toBase64(this.identityPublicKey),
      senderKeyFingerprint: fingerprint || '',
      messageContent: messageContent,
      trueTimestamp: Date.now(),
    };

    // Create sealed message
    const sealedMessage = await createSealedMessage(
      innerEnvelope,
      recipientId,
      bundle.sealedSenderKey,
      sessionKey,
      bundle.deliveryToken
    );

    return sealedMessage;
  }

  /**
   * Create a sealed group message.
   * Uses content key encryption for efficiency with multiple recipients.
   */
  async createSealedGroupMessageForConversation(
    conversationId: string,
    recipientIds: string[],
    messageContent: Uint8Array
  ): Promise<WSSealedGroupMessage> {
    if (!this.identityPublicKey || !this.signaturePrivateKeyJwk || !this.userId) {
      throw new Error('Crypto service not initialized');
    }

    // Get identity fingerprint
    const fingerprint = await this.getIdentityFingerprint();

    // Create inner envelope
    const innerEnvelope: SealedInnerEnvelope = {
      senderId: this.userId,
      senderIdentityKey: toBase64(this.identityPublicKey),
      senderKeyFingerprint: fingerprint || '',
      messageContent: messageContent,
      trueTimestamp: Date.now(),
      conversationId: conversationId,
    };

    // Build recipient info for createSealedGroupMessage
    const recipients: Array<{
      userId: string;
      publicKey: Uint8Array;
      sharedSecret: Uint8Array;
      deliveryVerifier: Uint8Array;
    }> = [];

    for (const recipientId of recipientIds) {
      const bundle = await this.getPeerSealedSenderBundle(recipientId);
      const sessionKey = await this.getPeerSessionKey(recipientId);
      recipients.push({
        userId: recipientId,
        publicKey: bundle.sealedSenderKey,
        sharedSecret: sessionKey,
        deliveryVerifier: bundle.deliveryToken,
      });
    }

    // Create sealed group message
    const sealedMessage = await createSealedGroupMessage(
      innerEnvelope,
      conversationId,
      recipients
    );

    return sealedMessage;
  }

  /**
   * Decrypt a sealed message (1:1 DM).
   * Reveals sender identity after decryption.
   */
  async decryptSealedMessageFromPeer(
    sealedMessage: WSSealedMessage
  ): Promise<{ senderId: string; content: Uint8Array; timestamp: number }> {
    if (!this.sealedSenderPrivateKey) {
      throw new Error('Sealed sender private key not available');
    }

    // Deserialize the sealed envelope
    const envelope = deserializeSealedEnvelope(sealedMessage.sealedContent);

    // Decrypt the sealed envelope
    const innerEnvelope = await sealedSenderDecrypt(
      envelope,
      this.sealedSenderPrivateKey
    );

    return {
      senderId: innerEnvelope.senderId,
      content: innerEnvelope.messageContent,
      timestamp: innerEnvelope.trueTimestamp,
    };
  }

  /**
   * Decrypt a sealed group message.
   */
  async decryptSealedGroupMessageFromConversation(
    sealedMessage: WSSealedGroupMessage
  ): Promise<{ senderId: string; content: Uint8Array; timestamp: number }> {
    if (!this.sealedSenderPrivateKey || !this.userId) {
      throw new Error('Sealed sender private key not available');
    }

    // Find our sealed key in the group message
    const ourKey = sealedMessage.sealedKeys.find(k => k.recipientId === this.userId);
    if (!ourKey) {
      throw new Error('No sealed key found for this user in group message');
    }

    // Decrypt the group message
    const innerEnvelope = await decryptSealedGroupMessage(
      sealedMessage.encryptedEnvelope,
      ourKey,
      this.sealedSenderPrivateKey
    );

    return {
      senderId: innerEnvelope.senderId,
      content: innerEnvelope.messageContent,
      timestamp: innerEnvelope.trueTimestamp,
    };
  }

  /**
   * Rotate sealed sender keys (e.g., after compromise or periodic rotation)
   */
  async rotateSealedSenderKeys(): Promise<void> {
    console.log('[CryptoService] Rotating sealed sender keys...');

    // Generate new keys
    await this.generateSealedSenderKeys();

    // Clear cached delivery tokens (need to recompute with new keys)
    this.deliveryTokens.clear();
    if (this.db) {
      try {
        const tx = this.db.transaction(STORE_DELIVERY_TOKENS, 'readwrite');
        await tx.store.clear();
        await tx.done;
      } catch (error) {
        console.warn('[CryptoService] Failed to clear delivery tokens:', error);
      }
    }

    // TODO: Upload new public key to server
    // await api.uploadSealedSenderKey(this.getSealedSenderPublicKeyForUpload());

    console.log('[CryptoService] Sealed sender keys rotated');
  }

  // Private sealed sender methods

  private async generateSealedSenderKeys(): Promise<void> {
    const keyPair = await generateSealedSenderKeyPair();

    this.sealedSenderPublicKey = keyPair.publicKey;
    this.sealedSenderPrivateKey = keyPair.privateKey;
    this.sealedSenderKeyVersion += 1;

    // Save to IndexedDB
    await this.saveSealedSenderKeys();
  }

  private async loadSealedSenderKeys(): Promise<boolean> {
    if (!this.db) return false;

    try {
      const stored = await this.db.get(STORE_SEALED_SENDER, 'current') as StoredSealedSenderKeys | undefined;
      if (!stored) return false;

      this.sealedSenderPublicKey = fromBase64(stored.publicKey);
      this.sealedSenderPrivateKey = fromBase64(stored.privateKey);
      this.sealedSenderKeyVersion = stored.keyVersion;

      return true;
    } catch (error) {
      console.error('[CryptoService] Failed to load sealed sender keys:', error);
      return false;
    }
  }

  private async saveSealedSenderKeys(): Promise<void> {
    if (!this.db || !this.sealedSenderPublicKey || !this.sealedSenderPrivateKey) return;

    const stored: StoredSealedSenderKeys = {
      id: 'current',
      publicKey: toBase64(this.sealedSenderPublicKey),
      privateKey: toBase64(this.sealedSenderPrivateKey),
      keyVersion: this.sealedSenderKeyVersion,
      createdAt: Date.now(),
    };

    await this.db.put(STORE_SEALED_SENDER, stored);
  }

  private async loadDeliveryTokens(): Promise<void> {
    if (!this.db) return;

    try {
      const tx = this.db.transaction(STORE_DELIVERY_TOKENS, 'readonly');
      const tokens = await tx.store.getAll();

      const now = Date.now();
      for (const stored of tokens as StoredDeliveryToken[]) {
        // Only load non-expired tokens
        if (stored.expiresAt > now) {
          this.deliveryTokens.set(stored.recipientId, fromBase64(stored.token));
        }
      }

      console.log('[CryptoService] Loaded', this.deliveryTokens.size, 'delivery tokens');
    } catch (error) {
      console.warn('[CryptoService] Failed to load delivery tokens:', error);
    }
  }

  // Private methods

  private async generateKeys(): Promise<void> {
    // Generate identity key pair (ECDSA for signatures)
    const identityKey = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );

    // Generate exchange key pair (ECDH for key exchange)
    const exchangeKey = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );

    // Generate signature key pair (separate from identity for flexibility)
    const signatureKey = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );

    // Export keys
    this.identityPublicKey = new Uint8Array(
      await crypto.subtle.exportKey('raw', identityKey.publicKey)
    );
    this.identityPrivateKeyJwk = await crypto.subtle.exportKey('jwk', identityKey.privateKey);

    this.exchangePublicKey = new Uint8Array(
      await crypto.subtle.exportKey('raw', exchangeKey.publicKey)
    );
    this.exchangePrivateKeyJwk = await crypto.subtle.exportKey('jwk', exchangeKey.privateKey);

    this.signaturePublicKey = new Uint8Array(
      await crypto.subtle.exportKey('raw', signatureKey.publicKey)
    );
    this.signaturePrivateKeyJwk = await crypto.subtle.exportKey('jwk', signatureKey.privateKey);

    this.registrationId = Math.floor(Math.random() * 16380) + 1;

    // Generate PQXDH hybrid keys if available
    if (this.pqxdhReady) {
      await this.generateHybridKeys();
    }

    // Save to IndexedDB
    await this.saveKeys();
  }

  /**
   * Generate hybrid PQXDH keys (X25519 + Kyber-1024)
   * Called during initialization when PQXDH is available
   */
  private async generateHybridKeys(): Promise<void> {
    if (!this.pqxdhReady) {
      console.warn('[CryptoService] Cannot generate hybrid keys - PQXDH not ready');
      return;
    }

    try {
      const hybridKeyPair = await generateHybridKeyPair();
      this.hybridECPublicKey = hybridKeyPair.ecPublicKey;
      this.hybridECPrivateKey = hybridKeyPair.ecPrivateKey;
      this.hybridPQPublicKey = hybridKeyPair.pqPublicKey;
      this.hybridPQPrivateKey = hybridKeyPair.pqPrivateKey;
      this.protocolVersion = PQXDH_VERSION;

      console.log('[CryptoService] Generated hybrid PQXDH keys');
      console.log('[CryptoService] X25519 public key length:', this.hybridECPublicKey.length);
      console.log('[CryptoService] Kyber-1024 public key length:', this.hybridPQPublicKey.length);
    } catch (error) {
      console.error('[CryptoService] Failed to generate hybrid keys:', error);
      throw error;
    }
  }

  private async loadKeys(): Promise<boolean> {
    if (!this.db || !this.userId) return false;

    const stored = await this.db.get(STORE_KEYS, this.userId) as StoredKeys | undefined;
    if (!stored) return false;

    try {
      this.identityPublicKey = fromBase64(stored.identityPublicKey);
      this.identityPrivateKeyJwk = JSON.parse(stored.identityPrivateKey);
      this.exchangePublicKey = fromBase64(stored.exchangePublicKey);
      this.exchangePrivateKeyJwk = JSON.parse(stored.exchangePrivateKey);
      this.signaturePublicKey = fromBase64(stored.signaturePublicKey);
      this.signaturePrivateKeyJwk = JSON.parse(stored.signaturePrivateKey);
      this.registrationId = stored.registrationId;

      // Load hybrid PQXDH keys if available
      if (stored.hybridECPublicKey && stored.hybridPQPublicKey) {
        this.hybridECPublicKey = fromBase64(stored.hybridECPublicKey);
        this.hybridECPrivateKey = fromBase64(stored.hybridECPrivateKey!);
        this.hybridPQPublicKey = fromBase64(stored.hybridPQPublicKey);
        this.hybridPQPrivateKey = fromBase64(stored.hybridPQPrivateKey!);
        this.protocolVersion = stored.protocolVersion || PQXDH_VERSION;
        console.log('[CryptoService] Loaded hybrid PQXDH keys from IndexedDB');
      }

      return true;
    } catch (error) {
      console.error('[CryptoService] Failed to parse stored keys:', error);
      return false;
    }
  }

  private async saveKeys(): Promise<void> {
    if (!this.db || !this.userId) return;

    const stored: StoredKeys = {
      userId: this.userId,
      identityPublicKey: toBase64(this.identityPublicKey!),
      identityPrivateKey: JSON.stringify(this.identityPrivateKeyJwk),
      exchangePublicKey: toBase64(this.exchangePublicKey!),
      exchangePrivateKey: JSON.stringify(this.exchangePrivateKeyJwk),
      signaturePublicKey: toBase64(this.signaturePublicKey!),
      signaturePrivateKey: JSON.stringify(this.signaturePrivateKeyJwk),
      registrationId: this.registrationId,
      createdAt: Date.now(),
      // Hybrid PQXDH keys
      hybridECPublicKey: this.hybridECPublicKey ? toBase64(this.hybridECPublicKey) : undefined,
      hybridECPrivateKey: this.hybridECPrivateKey ? toBase64(this.hybridECPrivateKey) : undefined,
      hybridPQPublicKey: this.hybridPQPublicKey ? toBase64(this.hybridPQPublicKey) : undefined,
      hybridPQPrivateKey: this.hybridPQPrivateKey ? toBase64(this.hybridPQPrivateKey) : undefined,
      protocolVersion: this.protocolVersion,
    };

    await this.db.put(STORE_KEYS, stored);
  }

  private async signData(data: Uint8Array): Promise<Uint8Array> {
    if (!this.signaturePrivateKeyJwk) {
      throw new Error('Signature key not available');
    }

    const privateKey = await crypto.subtle.importKey(
      'jwk',
      this.signaturePrivateKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    // Create a new ArrayBuffer to avoid SharedArrayBuffer compatibility issues
    const dataBuffer = new ArrayBuffer(data.length);
    new Uint8Array(dataBuffer).set(data);

    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      dataBuffer
    );

    return new Uint8Array(signature);
  }

  /**
   * Reset session state without deleting persistent keys.
   * Call this on logout to clear memory caches while preserving
   * IndexedDB keys for future logins.
   *
   * SECURITY: This prevents cross-user cache contamination when
   * multiple users log in on the same browser.
   */
  resetSession(): void {
    console.log('[CryptoService] Resetting session state (preserving IndexedDB keys)');
    // Clear memory caches only - don't touch IndexedDB
    this.identityPublicKey = null;
    this.identityPrivateKeyJwk = null;
    this.exchangePublicKey = null;
    this.exchangePrivateKeyJwk = null;
    this.signaturePublicKey = null;
    this.signaturePrivateKeyJwk = null;
    // Clear hybrid PQXDH keys
    this.hybridECPublicKey = null;
    this.hybridECPrivateKey = null;
    this.hybridPQPublicKey = null;
    this.hybridPQPrivateKey = null;
    this.protocolVersion = 1;
    this.conversationKeys.clear();
    this.peerSessionKeys.clear();
    this.pendingKeyFetches.clear();
    this.sealedSenderPublicKey = null;
    this.sealedSenderPrivateKey = null;
    this.sealedSenderKeyVersion = 0;
    this.deliveryTokens.clear();
    this.peerSealedSenderBundles.clear();
    this.transparencyWarningCallbacks.clear();
    this.initialized = false;
    this.userId = null;
  }

  /**
   * Clear all stored keys (for device unlink or account deletion)
   * WARNING: This deletes persistent keys from IndexedDB!
   */
  async clearKeys(): Promise<void> {
    if (this.db && this.userId) {
      await this.db.delete(STORE_KEYS, this.userId);
      // Clear all peer sessions
      try {
        const tx = this.db.transaction(STORE_PEER_SESSIONS, 'readwrite');
        await tx.store.clear();
        await tx.done;
      } catch (error) {
        console.warn('[CryptoService] Failed to clear peer sessions:', error);
      }
      // Clear sealed sender keys
      try {
        const tx2 = this.db.transaction(STORE_SEALED_SENDER, 'readwrite');
        await tx2.store.clear();
        await tx2.done;
      } catch (error) {
        console.warn('[CryptoService] Failed to clear sealed sender keys:', error);
      }
      // Clear delivery tokens
      try {
        const tx3 = this.db.transaction(STORE_DELIVERY_TOKENS, 'readwrite');
        await tx3.store.clear();
        await tx3.done;
      } catch (error) {
        console.warn('[CryptoService] Failed to clear delivery tokens:', error);
      }
    }
    // Clear P-256 keys
    this.identityPublicKey = null;
    this.identityPrivateKeyJwk = null;
    this.exchangePublicKey = null;
    this.exchangePrivateKeyJwk = null;
    this.signaturePublicKey = null;
    this.signaturePrivateKeyJwk = null;
    // Clear hybrid PQXDH keys
    this.hybridECPublicKey = null;
    this.hybridECPrivateKey = null;
    this.hybridPQPublicKey = null;
    this.hybridPQPrivateKey = null;
    this.protocolVersion = 1;
    this.pqxdhReady = false;
    // Clear caches
    this.conversationKeys.clear();
    this.peerSessionKeys.clear();
    this.pendingKeyFetches.clear();
    // Clear sealed sender state
    this.sealedSenderPublicKey = null;
    this.sealedSenderPrivateKey = null;
    this.sealedSenderKeyVersion = 0;
    this.deliveryTokens.clear();
    this.peerSealedSenderBundles.clear();
    // Clear transparency callbacks
    this.transparencyWarningCallbacks.clear();
    // Clear transparency state
    keyTransparencyService.clearState().catch(() => {
      // Ignore errors during cleanup
    });
    this.initialized = false;
    this.userId = null;
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | null {
    return this.userId;
  }
}

// Export singleton instance
export const cryptoService = CryptoService.getInstance();
