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
 */
export interface DilithiumKeyPair {
  publicKey: Uint8Array;  // 1952 bytes
  privateKey: Uint8Array; // 4016 bytes
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
