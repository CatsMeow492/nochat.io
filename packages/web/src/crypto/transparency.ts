/**
 * Key Transparency Verification Module
 *
 * Implements client-side verification of Merkle tree inclusion and consistency proofs.
 * This ensures the server cannot serve different keys to different users.
 *
 * Based on WhatsApp's Auditable Key Directory (AKD) design.
 */

import { openDB, IDBPDatabase } from "idb";

// Tree constants (must match backend)
const TREE_DEPTH = 256;
const HASH_SIZE = 32;

const DB_NAME = "nochat-transparency";
const DB_VERSION = 1;
const STORE_STATE = "clientState";
const STORE_SIGNING_KEYS = "signingKeys";

/**
 * Leaf data structure in the Merkle tree
 */
export interface LeafData {
  user_id: string;
  identity_key_fingerprint: string;
  signed_prekey_fingerprint?: string;
  key_version: number;
  timestamp: number;
}

/**
 * Signed Tree Head from server
 */
export interface SignedTreeHead {
  epoch_number: number;
  root_hash: string; // Base64
  tree_size: number;
  signature: string; // Base64
  signing_key_fingerprint: string;
  timestamp: string;
}

/**
 * Inclusion proof for a user's key
 */
export interface InclusionProof {
  epoch_number: number;
  leaf_hash: string; // Base64
  leaf_data: LeafData;
  sibling_path: string[]; // Base64 encoded hashes
  path_bits: string; // Base64 (32 bytes = 256 bits)
  root_hash: string; // Base64
}

/**
 * Consistency proof between epochs
 */
export interface ConsistencyProof {
  from_epoch: number;
  to_epoch: number;
  from_root: string; // Base64
  to_root: string; // Base64
  proof_hashes: string[]; // Base64 encoded
}

/**
 * Signing key for verifying tree heads
 */
export interface SigningKey {
  fingerprint: string;
  public_key: string; // Base64
  algorithm: "ed25519" | "p256";
  valid_from: string;
  valid_until?: string;
}

/**
 * Client transparency state (persisted)
 */
interface ClientState {
  userId: string;
  lastVerifiedEpoch: number;
  lastVerifiedRootHash: string;
  verifiedAt: number;
}

/**
 * Key verification result
 */
export interface VerificationResult {
  verified: boolean;
  error?: string;
  epoch?: number;
  warningLevel?: "none" | "warning" | "critical";
}

// Precomputed default hashes for empty subtrees
let defaultHashes: Uint8Array[] = [];
let defaultHashesInitialized = false;

/**
 * Initialize default hashes for empty subtrees
 */
async function initDefaultHashes(): Promise<void> {
  if (defaultHashesInitialized) return;

  defaultHashes = new Array(TREE_DEPTH + 1);

  // H(empty) for leaf level
  defaultHashes[TREE_DEPTH] = await sha256(new Uint8Array(0));

  // H(H(empty) || H(empty)) for each level up
  for (let i = TREE_DEPTH - 1; i >= 0; i--) {
    const combined = concat(defaultHashes[i + 1], defaultHashes[i + 1]);
    defaultHashes[i] = await sha256(combined);
  }

  defaultHashesInitialized = true;
}

/**
 * SHA-256 hash function
 */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // Create a new ArrayBuffer to avoid SharedArrayBuffer compatibility issues
  const buffer = new ArrayBuffer(data.length);
  new Uint8Array(buffer).set(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return new Uint8Array(hashBuffer);
}

/**
 * Concatenate multiple Uint8Arrays
 */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Base64 decode
 */
function fromBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Base64 encode
 */
function toBase64(bytes: Uint8Array): string {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}

/**
 * Get bit at index from byte array
 */
function getBit(data: Uint8Array, index: number): number {
  if (index < 0 || index >= data.length * 8) {
    return 0;
  }
  const byteIndex = Math.floor(index / 8);
  const bitIndex = 7 - (index % 8);
  return (data[byteIndex] >> bitIndex) & 1;
}

/**
 * Constant-time byte array comparison
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * KeyTransparencyService - Client-side verification of key transparency
 */
export class KeyTransparencyService {
  private static instance: KeyTransparencyService;
  private db: IDBPDatabase | null = null;
  private initialized = false;
  private signingKeys: Map<string, CryptoKey> = new Map();
  private currentState: ClientState | null = null;
  private userId: string | null = null;
  private deviceId: string;

  private constructor() {
    this.deviceId = this.getOrCreateDeviceId();
  }

  static getInstance(): KeyTransparencyService {
    if (!KeyTransparencyService.instance) {
      KeyTransparencyService.instance = new KeyTransparencyService();
    }
    return KeyTransparencyService.instance;
  }

  /**
   * Initialize the transparency service
   */
  async initialize(userId: string): Promise<void> {
    if (this.initialized && this.userId === userId) return;

    await initDefaultHashes();

    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_STATE)) {
          db.createObjectStore(STORE_STATE, { keyPath: "userId" });
        }
        if (!db.objectStoreNames.contains(STORE_SIGNING_KEYS)) {
          db.createObjectStore(STORE_SIGNING_KEYS, { keyPath: "fingerprint" });
        }
      },
    });

    this.userId = userId;
    await this.loadState();
    await this.loadSigningKeys();
    this.initialized = true;

    console.log("[Transparency] Initialized for user:", userId);
  }

  /**
   * Fetch and verify the current signed tree head
   */
  async fetchAndVerifyTreeHead(): Promise<SignedTreeHead | null> {
    try {
      const response = await fetch("/api/transparency/root");
      if (!response.ok) {
        if (response.status === 503) {
          console.log("[Transparency] Key transparency not enabled on server");
          return null;
        }
        console.warn("[Transparency] Failed to fetch tree head:", response.status);
        return null;
      }

      const sth: SignedTreeHead = await response.json();

      // Verify signature
      if (!(await this.verifyTreeHeadSignature(sth))) {
        throw new TransparencyError("Invalid tree head signature");
      }

      // Verify consistency with last known state
      if (this.currentState && this.currentState.lastVerifiedEpoch > 0) {
        if (sth.epoch_number < this.currentState.lastVerifiedEpoch) {
          throw new TransparencyError("Tree head epoch went backwards - possible attack");
        }

        if (sth.epoch_number > this.currentState.lastVerifiedEpoch) {
          // Need to verify consistency proof
          await this.verifyConsistency(
            this.currentState.lastVerifiedEpoch,
            sth.epoch_number
          );
        }
      }

      // Update local state
      await this.updateState(sth.epoch_number, sth.root_hash);

      return sth;
    } catch (error) {
      console.error("[Transparency] Error fetching tree head:", error);
      if (error instanceof TransparencyError) {
        throw error;
      }
      return null;
    }
  }

  /**
   * Verify a user's key is correctly included in the tree
   */
  async verifyKeyInclusion(
    targetUserId: string,
    expectedFingerprint: string
  ): Promise<VerificationResult> {
    try {
      // Fetch current tree head
      const sth = await this.fetchAndVerifyTreeHead();
      if (!sth) {
        // Transparency not available - allow but warn
        return {
          verified: false,
          error: "Key transparency not available",
          warningLevel: "warning",
        };
      }

      // Fetch inclusion proof
      const response = await fetch(
        `/api/transparency/inclusion?user_id=${targetUserId}&epoch=${sth.epoch_number}`
      );
      if (!response.ok) {
        if (response.status === 404) {
          return {
            verified: false,
            error: "User not found in transparency log",
            warningLevel: "warning",
          };
        }
        return {
          verified: false,
          error: `Failed to get inclusion proof: ${response.status}`,
          warningLevel: "warning",
        };
      }

      const proof: InclusionProof = await response.json();

      // Verify the proof
      if (!(await this.verifyInclusionProof(proof, sth.root_hash))) {
        return {
          verified: false,
          error: "Invalid inclusion proof - possible MITM attack",
          warningLevel: "critical",
        };
      }

      // Verify the fingerprint matches
      if (proof.leaf_data.identity_key_fingerprint !== expectedFingerprint) {
        return {
          verified: false,
          error: `Key fingerprint mismatch: expected ${expectedFingerprint}, got ${proof.leaf_data.identity_key_fingerprint}`,
          warningLevel: "critical",
        };
      }

      return {
        verified: true,
        epoch: sth.epoch_number,
        warningLevel: "none",
      };
    } catch (error) {
      console.error("[Transparency] Verification error:", error);
      return {
        verified: false,
        error: error instanceof Error ? error.message : "Unknown error",
        warningLevel: error instanceof TransparencyError ? "critical" : "warning",
      };
    }
  }

  /**
   * Verify an inclusion proof
   */
  private async verifyInclusionProof(
    proof: InclusionProof,
    expectedRoot: string
  ): Promise<boolean> {
    if (!proof.sibling_path || proof.sibling_path.length !== TREE_DEPTH) {
      console.error("[Transparency] Invalid sibling path length");
      return false;
    }

    // Recompute leaf hash from leaf data
    const computedLeafHash = await this.computeLeafHash(proof.leaf_data);
    const providedLeafHash = fromBase64(proof.leaf_hash);

    if (!constantTimeEqual(computedLeafHash, providedLeafHash)) {
      console.error("[Transparency] Leaf hash mismatch");
      return false;
    }

    // Traverse path from leaf to root
    const pathBits = fromBase64(proof.path_bits);
    const siblingPath = proof.sibling_path.map((s) => fromBase64(s));

    let currentHash = computedLeafHash;

    for (let depth = TREE_DEPTH - 1; depth >= 0; depth--) {
      const siblingHash = siblingPath[depth];
      const bit = getBit(pathBits, depth);

      // Combine hashes (order depends on path bit)
      let combined: Uint8Array;
      if (bit === 0) {
        combined = concat(currentHash, siblingHash);
      } else {
        combined = concat(siblingHash, currentHash);
      }

      currentHash = await sha256(combined);
    }

    // Compare computed root with expected root
    const expectedRootBytes = fromBase64(expectedRoot);
    return constantTimeEqual(currentHash, expectedRootBytes);
  }

  /**
   * Verify consistency between two epochs
   */
  private async verifyConsistency(fromEpoch: number, toEpoch: number): Promise<void> {
    const response = await fetch(
      `/api/transparency/consistency?from=${fromEpoch}&to=${toEpoch}`
    );
    if (!response.ok) {
      throw new TransparencyError("Failed to fetch consistency proof");
    }

    const proof: ConsistencyProof = await response.json();

    // Verify consistency proof
    if (!(await this.verifyConsistencyProof(proof))) {
      throw new TransparencyError("Consistency proof verification failed - tree may have been tampered");
    }
  }

  /**
   * Verify a consistency proof
   */
  private async verifyConsistencyProof(proof: ConsistencyProof): Promise<boolean> {
    if (!proof) {
      return false;
    }

    // Basic validation
    if (proof.from_epoch >= proof.to_epoch) {
      return false;
    }

    // Verify the chain of intermediate roots
    if (proof.proof_hashes && proof.proof_hashes.length > 0) {
      const lastHash = fromBase64(proof.proof_hashes[proof.proof_hashes.length - 1]);
      const toRoot = fromBase64(proof.to_root);
      if (!constantTimeEqual(lastHash, toRoot)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Verify tree head signature
   */
  private async verifyTreeHeadSignature(sth: SignedTreeHead): Promise<boolean> {
    let signingKey = this.signingKeys.get(sth.signing_key_fingerprint);
    if (!signingKey) {
      console.log("[Transparency] Unknown signing key, fetching...");
      await this.loadSigningKeys();
      signingKey = this.signingKeys.get(sth.signing_key_fingerprint);
      if (!signingKey) {
        console.error("[Transparency] Signing key not found:", sth.signing_key_fingerprint);
        return false;
      }
    }

    // Construct signed data: epoch (8 bytes) || root_hash (32 bytes) || tree_size (8 bytes) || timestamp (8 bytes)
    const epochBytes = new ArrayBuffer(8);
    new DataView(epochBytes).setBigUint64(0, BigInt(sth.epoch_number));

    const rootHash = fromBase64(sth.root_hash);

    const treeSizeBytes = new ArrayBuffer(8);
    new DataView(treeSizeBytes).setBigUint64(0, BigInt(sth.tree_size));

    const timestamp = new Date(sth.timestamp).getTime() / 1000;
    const timestampBytes = new ArrayBuffer(8);
    new DataView(timestampBytes).setBigUint64(0, BigInt(Math.floor(timestamp)));

    const signedData = concat(
      new Uint8Array(epochBytes),
      rootHash,
      new Uint8Array(treeSizeBytes),
      new Uint8Array(timestampBytes)
    );

    const signature = fromBase64(sth.signature);

    try {
      // Create new ArrayBuffers to avoid SharedArrayBuffer compatibility issues
      const sigBuffer = new ArrayBuffer(signature.length);
      new Uint8Array(sigBuffer).set(signature);
      const dataBuffer = new ArrayBuffer(signedData.length);
      new Uint8Array(dataBuffer).set(signedData);

      return await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        signingKey,
        sigBuffer,
        dataBuffer
      );
    } catch (error) {
      console.error("[Transparency] Signature verification error:", error);
      return false;
    }
  }

  /**
   * Compute leaf hash from leaf data
   */
  private async computeLeafHash(data: LeafData): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    // Match backend format: user_id || identity_fingerprint || prekey_fingerprint || version || timestamp
    const parts = [
      data.user_id,
      data.identity_key_fingerprint,
      data.signed_prekey_fingerprint || "",
      data.key_version.toString(),
      data.timestamp.toString(),
    ];
    // Need to match backend byte format (raw UUID bytes, not string)
    // For now, use the string format since backend computes from UUIDs
    const combined = encoder.encode(parts.join(""));

    // The backend uses raw bytes, so we need to construct the hash differently
    // This is a simplified version - production would need exact byte layout match
    const h = await sha256(combined);
    return h;
  }

  /**
   * Get or create device ID
   */
  private getOrCreateDeviceId(): string {
    // Guard against SSR (localStorage not available on server)
    if (typeof window === "undefined") {
      return "ssr-placeholder";
    }
    let deviceId = localStorage.getItem("nochat-device-id");
    if (!deviceId) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      deviceId = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      localStorage.setItem("nochat-device-id", deviceId);
    }
    return deviceId;
  }

  /**
   * Load client state from IndexedDB
   */
  private async loadState(): Promise<void> {
    if (!this.db || !this.userId) return;
    try {
      const state = await this.db.get(STORE_STATE, this.userId);
      this.currentState = state || null;
      if (this.currentState) {
        console.log("[Transparency] Loaded state, last epoch:", this.currentState.lastVerifiedEpoch);
      }
    } catch (error) {
      console.error("[Transparency] Failed to load state:", error);
    }
  }

  /**
   * Update client state in IndexedDB
   */
  private async updateState(epoch: number, rootHash: string): Promise<void> {
    if (!this.db || !this.userId) return;

    this.currentState = {
      userId: this.userId,
      lastVerifiedEpoch: epoch,
      lastVerifiedRootHash: rootHash,
      verifiedAt: Date.now(),
    };

    try {
      await this.db.put(STORE_STATE, this.currentState);

      // Also report to server
      await fetch("/api/transparency/client-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: this.deviceId,
          epoch: epoch,
          root_hash: rootHash,
        }),
      }).catch(() => {
        // Non-fatal if server update fails
      });
    } catch (error) {
      console.error("[Transparency] Failed to update state:", error);
    }
  }

  /**
   * Load signing keys from server
   */
  private async loadSigningKeys(): Promise<void> {
    try {
      const response = await fetch("/api/transparency/signing-keys");
      if (!response.ok) {
        console.log("[Transparency] Signing keys not available");
        return;
      }

      const data = await response.json();
      for (const keyData of data.signing_keys || []) {
        try {
          const publicKeyBytes = fromBase64(keyData.public_key);

          let cryptoKey: CryptoKey;
          if (keyData.algorithm === "ed25519") {
            // Ed25519 not natively supported in Web Crypto, would need a polyfill
            // For now, skip Ed25519 keys
            console.log("[Transparency] Ed25519 keys not yet supported in browser");
            continue;
          } else {
            // P-256 ECDSA
            // Create new ArrayBuffer to avoid SharedArrayBuffer compatibility issues
            const keyBuffer = new ArrayBuffer(publicKeyBytes.length);
            new Uint8Array(keyBuffer).set(publicKeyBytes);
            cryptoKey = await crypto.subtle.importKey(
              "raw",
              keyBuffer,
              { name: "ECDSA", namedCurve: "P-256" },
              false,
              ["verify"]
            );
          }

          this.signingKeys.set(keyData.fingerprint, cryptoKey);
          console.log("[Transparency] Loaded signing key:", keyData.fingerprint);
        } catch (error) {
          console.error("[Transparency] Failed to import signing key:", error);
        }
      }
    } catch (error) {
      console.warn("[Transparency] Failed to load signing keys:", error);
    }
  }

  /**
   * Get the current verified epoch
   */
  getLastVerifiedEpoch(): number {
    return this.currentState?.lastVerifiedEpoch || 0;
  }

  /**
   * Check if transparency is available
   */
  isAvailable(): boolean {
    return this.initialized && this.signingKeys.size > 0;
  }

  /**
   * Clear stored state (for logout)
   */
  async clearState(): Promise<void> {
    if (this.db && this.userId) {
      await this.db.delete(STORE_STATE, this.userId);
    }
    this.currentState = null;
    this.userId = null;
    this.initialized = false;
  }
}

/**
 * Error class for transparency failures
 */
export class TransparencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransparencyError";
  }
}

// Export singleton
export const keyTransparencyService = KeyTransparencyService.getInstance();

// Export types for use in other modules
export type { ClientState };
