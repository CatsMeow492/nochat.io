// E2EE Crypto Types for nochat.io

/**
 * Kyber1024 key pair for PQC key encapsulation
 */
export interface KyberKeyPair {
  publicKey: Uint8Array;  // 1568 bytes
  privateKey: Uint8Array; // 3168 bytes
}

/**
 * Dilithium3 key pair for PQC digital signatures
 * Note: Currently implemented as Ed25519 until Dilithium WASM is available
 */
export interface DilithiumKeyPair {
  publicKey: Uint8Array;  // 32 bytes (Ed25519) or 1952 bytes (Dilithium3)
  privateKey: Uint8Array; // 32 bytes (Ed25519) or 4016 bytes (Dilithium3)
}

/**
 * X25519 key pair for classical ECDH
 */
export interface ECKeyPair {
  publicKey: Uint8Array;  // 32 bytes
  privateKey: Uint8Array; // 32 bytes
}

/**
 * Hybrid key pair for PQXDH (X25519 + Kyber-1024)
 * Provides both classical and post-quantum security
 */
export interface HybridKeyPair {
  ecPublicKey: Uint8Array;   // X25519 public key (32 bytes)
  ecPrivateKey: Uint8Array;  // X25519 private key (32 bytes)
  pqPublicKey: Uint8Array;   // Kyber-1024 public key (1568 bytes)
  pqPrivateKey: Uint8Array;  // Kyber-1024 private key (3168 bytes)
}

/**
 * Result of Kyber key encapsulation
 */
export interface KyberEncapsulation {
  ciphertext: Uint8Array; // 1568 bytes - send to recipient
  sharedSecret: Uint8Array; // 32 bytes - use for symmetric encryption
}

/**
 * Complete identity key bundle stored locally
 */
export interface LocalIdentityKeys {
  identityKeyPair: DilithiumKeyPair;
  signedPreKeyPair: KyberKeyPair;
  signedPreKeyId: number;
  signedPreKeySignature: Uint8Array;
  oneTimePreKeys: Map<number, KyberKeyPair>;
  registrationId: number;
}

/**
 * Hybrid identity key bundle stored locally for PQXDH
 */
export interface HybridLocalIdentityKeys {
  identityKeyPair: DilithiumKeyPair;       // Ed25519 for signing
  signedPreKeyPair: HybridKeyPair;         // X25519 + Kyber for key exchange
  signedPreKeyId: number;
  signedPreKeySignature: Uint8Array;
  oneTimePreKeys: Map<number, HybridKeyPair>;
  registrationId: number;
}

/**
 * Public key bundle fetched from server for another user
 */
export interface PreKeyBundle {
  userId: string;
  identityKey: Uint8Array;          // Dilithium public key
  identityKeyFingerprint: string;
  signedPreKeyId: number;
  signedPreKey: Uint8Array;         // Kyber public key
  signedPreKeySignature: Uint8Array;
  oneTimePreKeyId?: number;
  oneTimePreKey?: Uint8Array;       // Kyber public key
  bundleVersion: number;
}

/**
 * Hybrid public key bundle for PQXDH
 */
export interface HybridPreKeyBundle {
  userId: string;
  identityKey: Uint8Array;                // Ed25519 public key for verification
  identityKeyFingerprint: string;
  signedPreKeyId: number;
  signedPreKeyEC: Uint8Array;             // X25519 public key (32 bytes)
  signedPreKeyPQ: Uint8Array;             // Kyber-1024 public key (1568 bytes)
  signedPreKeySignature: Uint8Array;
  oneTimePreKeyId?: number;
  oneTimePreKeyEC?: Uint8Array;           // X25519 public key (32 bytes)
  oneTimePreKeyPQ?: Uint8Array;           // Kyber-1024 public key (1568 bytes)
  bundleVersion: number;                  // 2 for PQXDH hybrid
}

/**
 * Encrypted message format
 */
export interface EncryptedMessage {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  algorithm: 'aes-256-gcm' | 'xchacha20-poly1305';
}

/**
 * E2EE message payload sent over WebSocket
 */
export interface E2EEMessagePayload {
  ciphertext: string;        // Base64 encoded
  nonce: string;             // Base64 encoded
  ephemeralKey?: string;     // Base64 encoded Kyber public key
  signature: string;         // Base64 encoded Dilithium signature
  algorithm: string;
  senderKeyId: number;
  chainIndex: number;
  oneTimePreKeyId?: string;
}

/**
 * Session state for Double Ratchet
 */
export interface SessionState {
  // Peer identity
  peerUserId: string;
  peerIdentityKey: Uint8Array;

  // Root key chain
  rootKey: Uint8Array;

  // Sending chain
  sendingChainKey: Uint8Array;
  sendingChainIndex: number;
  sendingEphemeralKeyPair: KyberKeyPair;

  // Receiving chain
  receivingChainKey: Uint8Array;
  receivingChainIndex: number;
  receivingEphemeralKey: Uint8Array;

  // Previous chains for out-of-order messages
  previousChainKeys: Map<string, Uint8Array>;
  skippedMessageKeys: Map<string, Uint8Array>;

  // Metadata
  createdAt: number;
  updatedAt: number;
}

/**
 * Key exchange message types
 */
export type KeyExchangeType = 'initiate' | 'response' | 'ratchet';

/**
 * Key exchange message
 */
export interface KeyExchangeMessage {
  type: KeyExchangeType;
  fromUserId: string;
  toUserId: string;
  ephemeralPublicKey: string;  // Base64
  ciphertext?: string;         // Base64 - KEM result (for response)
  signature: string;           // Base64
  oneTimePreKeyId?: string;
  chainIndex: number;
  timestamp: number;
}

/**
 * Encrypted file metadata
 */
export interface EncryptedFileInfo {
  storageKey: string;
  encryptedFileKey: Uint8Array;
  fileKeyNonce: Uint8Array;
  algorithm: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize?: number;
  checksumSHA256?: string;
}

/**
 * Device information for multi-device support
 */
export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  devicePublicKey: Uint8Array;
  isCurrentDevice: boolean;
  lastActiveAt: number;
}

/**
 * Crypto service configuration
 */
export interface CryptoConfig {
  defaultAlgorithm: 'aes-256-gcm' | 'xchacha20-poly1305';
  maxSkippedMessages: number;
  maxChainLength: number;
  preKeyBatchSize: number;
  lowPreKeyThreshold: number;
}

/**
 * Default crypto configuration
 */
export const DEFAULT_CRYPTO_CONFIG: CryptoConfig = {
  defaultAlgorithm: 'xchacha20-poly1305',
  maxSkippedMessages: 1000,
  maxChainLength: 1000,
  preKeyBatchSize: 100,
  lowPreKeyThreshold: 25,
};

// ============================================================================
// Sealed Sender Types
// ============================================================================

/**
 * Block sizes for traffic analysis padding (in bytes)
 */
export const SEALED_SENDER_BLOCK_SIZES = [256, 1024, 4096, 16384, 65536] as const;
export type SealedSenderBlockSize = typeof SEALED_SENDER_BLOCK_SIZES[number];

/**
 * Timestamp bucket size in milliseconds (15 minutes)
 */
export const TIMESTAMP_BUCKET_MS = 15 * 60 * 1000;

/**
 * Sealed sender key pair (Kyber-1024)
 */
export interface SealedSenderKeyPair {
  publicKey: Uint8Array;   // 1568 bytes
  privateKey: Uint8Array;  // 3168 bytes
}

/**
 * Inner envelope - decrypted content revealing sender identity
 */
export interface InnerEnvelope {
  senderUserId: string;
  senderIdentityKey: Uint8Array;  // Dilithium public key for verification
  actualTimestamp: number;        // Real timestamp (not bucketed)
  messageContent: Uint8Array;     // Actual encrypted message payload
  signature: Uint8Array;          // Dilithium signature over content
}

/**
 * Sealed envelope - outer encrypted layer hiding sender identity
 */
export interface SealedEnvelope {
  ephemeralPublicKey: Uint8Array;  // Kyber ephemeral public key
  kemCiphertext: Uint8Array;       // KEM ciphertext
  encryptedContent: Uint8Array;    // Encrypted inner envelope
  nonce: Uint8Array;               // AES-GCM nonce
}

/**
 * Sealed sender bundle - extends prekey bundle with sealed sender info
 */
export interface SealedSenderBundle extends PreKeyBundle {
  sealedSenderKey: Uint8Array;     // Kyber public key for sealing
  sealedSenderKeyFingerprint: string;
  deliveryToken: Uint8Array;       // HMAC token for delivery verification
  sealedSenderEnabled: boolean;
}

/**
 * Hybrid sealed sender bundle - extends hybrid prekey bundle
 */
export interface HybridSealedSenderBundle extends HybridPreKeyBundle {
  sealedSenderKey: Uint8Array;     // Kyber public key for sealing
  sealedSenderKeyFingerprint: string;
  deliveryToken: Uint8Array;       // HMAC token for delivery verification
  sealedSenderEnabled: boolean;
}

/**
 * WebSocket sealed message format (1:1 DM)
 */
export interface WSSealedMessage {
  type: 'sealedMessage';
  recipientId: string;
  timestampBucket: number;         // Bucketed timestamp (15-min granularity)
  sealedEnvelope: string;          // Base64 encoded SealedEnvelope
  deliveryTokenHash: string;       // Hash of delivery token for verification
  paddedSize: SealedSenderBlockSize;
}

/**
 * Per-recipient key for group sealed messages
 */
export interface SealedMessageKey {
  recipientId: string;
  encryptedContentKey: Uint8Array; // Content key encrypted to recipient's sealed sender key
  kemCiphertext: Uint8Array;       // KEM ciphertext for this recipient
  nonce: Uint8Array;               // Nonce for the key encryption
}

/**
 * WebSocket sealed group message format
 */
export interface WSSealedGroupMessage {
  type: 'sealedGroupMessage';
  conversationId: string;
  timestampBucket: number;
  sealedEnvelope: string;          // Base64 - encrypted with random content key
  recipientKeys: WSSealedMessageKey[]; // Per-recipient encrypted content keys
  paddedSize: SealedSenderBlockSize;
}

/**
 * Wire format for recipient key
 */
export interface WSSealedMessageKey {
  recipientId: string;
  encryptedContentKey: string;     // Base64
  kemCiphertext: string;           // Base64
  nonce: string;                   // Base64
  deliveryTokenHash: string;
}

/**
 * Sealed sender status for a user
 */
export interface SealedSenderStatus {
  enabled: boolean;
  hasKey: boolean;
  keyFingerprint?: string;
  keyVersion?: number;
  hasDeliveryVerifier: boolean;
}

/**
 * Sealed sender key upload request
 */
export interface SealedSenderKeyUpload {
  publicKey: string;               // Base64 encoded Kyber public key
}

/**
 * Sealed sender key response from server
 */
export interface SealedSenderKeyResponse {
  id: string;
  userId: string;
  keyFingerprint: string;
  keyVersion: number;
  status: string;
  createdAt: string;
  expiresAt?: string;
}

/**
 * Extended crypto config with sealed sender settings
 */
export interface SealedSenderConfig {
  enabled: boolean;
  defaultBlockSize: SealedSenderBlockSize;
  timestampBucketMs: number;
}

/**
 * Default sealed sender configuration
 */
export const DEFAULT_SEALED_SENDER_CONFIG: SealedSenderConfig = {
  enabled: true,
  defaultBlockSize: 1024,
  timestampBucketMs: TIMESTAMP_BUCKET_MS,
};
