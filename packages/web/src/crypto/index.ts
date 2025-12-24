/**
 * E2EE Crypto Module for nochat.io
 *
 * This module provides end-to-end encryption using Web Crypto API:
 * - ECDSA P-256 for digital signatures (identity keys)
 * - ECDH P-256 for key exchange
 * - AES-256-GCM for message encryption
 * - HKDF for key derivation
 *
 * Keys are stored securely in IndexedDB using the idb library.
 *
 * Usage:
 *
 * 1. Initialize on user login:
 *    ```typescript
 *    import { cryptoService } from './crypto';
 *
 *    // Initialize for current user (generates or loads keys from IndexedDB)
 *    await cryptoService.initialize(userId);
 *    ```
 *
 * 2. Upload keys to server:
 *    ```typescript
 *    const keys = await cryptoService.getKeysForUpload();
 *    // POST to /api/crypto/keys/identity, /api/crypto/keys/prekey
 *    ```
 *
 * 3. Encrypt/decrypt messages:
 *    ```typescript
 *    // Encrypt
 *    const encrypted = await cryptoService.encryptMessage(conversationId, 'Hello!');
 *
 *    // Decrypt
 *    const plaintext = await cryptoService.decryptMessage(conversationId, encrypted);
 *    ```
 */

// Main service
export { CryptoService, cryptoService } from './CryptoService';

// Types
export * from './types';

// PQC primitives
export {
  initPQC,
  isPQCReady,
  generateKyberKeyPair,
  generateDilithiumKeyPair,
  kyberEncapsulate,
  kyberDecapsulate,
  dilithiumSign,
  dilithiumVerify,
  createSignedPreKey,
  verifySignedPreKey,
  generateOneTimePreKeys,
  KYBER1024_PUBLIC_KEY_SIZE,
  KYBER1024_PRIVATE_KEY_SIZE,
  KYBER1024_CIPHERTEXT_SIZE,
  KYBER1024_SHARED_SECRET_SIZE,
  X25519_PUBLIC_KEY_SIZE,
  X25519_PRIVATE_KEY_SIZE,
  X25519_SHARED_SECRET_SIZE,
  ED25519_PUBLIC_KEY_SIZE,
  ED25519_PRIVATE_KEY_SIZE,
  ED25519_SIGNATURE_SIZE,
} from './pqc';

// X3DH key exchange (legacy)
export { initiateX3DH, completeX3DH, createSessionFromX3DH, verifyIdentityFingerprint } from './x3dh';

// PQXDH key exchange (quantum-resistant hybrid X25519 + Kyber-1024)
export {
  initPQXDH,
  isPQXDHReady,
  pqxdhInitiate,
  pqxdhRespond,
  createSessionFromPQXDH,
  verifyPrekeyBundle,
  isHybridBundle,
  isLegacyP256Bundle,
  convertApiBundle,
  generateEphemeralKeyPair,
  PQXDH_VERSION,
} from './pqxdh';

// Re-export PQXDH types
export type {
  PQXDHInitResult,
  PQXDHResponseResult,
  PQXDHEphemeralKeyPair,
  PQXDHInitiatorData,
} from './pqxdh';

// Double Ratchet
export {
  ratchetEncrypt,
  ratchetDecrypt,
  serializeSessionState,
  deserializeSessionState,
} from './ratchet';

// Symmetric encryption
export {
  encryptAESGCM,
  decryptAESGCM,
  encrypt,
  decrypt,
  encryptString,
  decryptToString,
  encryptFile,
  decryptFile,
  generateSymmetricKey,
  generateNonce,
} from './symmetric';

// Utilities
export {
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  randomBytes,
  sha256,
  keyFingerprint,
  concat,
  constantTimeEqual,
  secureClear,
  hkdfDerive,
  deriveKeys,
  generateMessageId,
  generateDeviceId,
  isWebCryptoAvailable,
  createStorageKey,
} from './utils';

// Sealed Sender (metadata protection)
export {
  generateSealedSenderKeyPair,
  sealedSenderEncrypt,
  sealedSenderDecrypt,
  computeDeliveryToken,
  hashDeliveryToken,
  getTimestampBucket,
  padToBlockSize,
  unpadFromBlockSize,
  createSealedMessage,
  createSealedGroupMessage,
  decryptSealedGroupMessage,
  serializeSealedEnvelope,
  deserializeSealedEnvelope,
  SEALED_SENDER_VERSION,
  PADDING_BLOCK_SIZES,
  TIMESTAMP_BUCKET_MS,
} from './sealed-sender';

// Re-export sealed sender types
export type {
  InnerEnvelope,
  SealedEnvelope,
  SealedSenderKeyPair,
  WSSealedMessage,
  WSSealedGroupMessage,
  WSSealedKey,
} from './sealed-sender';

// Key Transparency (Auditable Key Directory)
export {
  KeyTransparencyService,
  keyTransparencyService,
  TransparencyError,
} from './transparency';

// Re-export transparency types
export type {
  LeafData,
  SignedTreeHead,
  InclusionProof,
  ConsistencyProof,
  SigningKey,
  VerificationResult,
} from './transparency';

// Re-export transparency warning type from CryptoService
export type { TransparencyWarning } from './CryptoService';
