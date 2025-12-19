/**
 * E2EE Crypto Module for nochat.io
 *
 * This module provides post-quantum secure end-to-end encryption
 * using ML-KEM (Kyber) for key exchange and ML-DSA (Dilithium) for signatures.
 *
 * Usage:
 *
 * 1. Initialize on app startup:
 *    ```typescript
 *    import { cryptoService, initPQC } from './crypto';
 *
 *    // Initialize PQC module
 *    await initPQC();
 *
 *    // Initialize for current user
 *    await cryptoService.initialize(userId);
 *    ```
 *
 * 2. Upload keys to server:
 *    ```typescript
 *    const keys = await cryptoService.getKeysForUpload();
 *    // POST to /api/crypto/keys/identity, /api/crypto/keys/prekey, /api/crypto/keys/prekeys
 *    ```
 *
 * 3. Establish session with peer:
 *    ```typescript
 *    // Fetch peer's prekey bundle from server
 *    const bundle = await fetch(`/api/crypto/bundles/${peerId}`).then(r => r.json());
 *    await cryptoService.establishSession(bundle);
 *    ```
 *
 * 4. Encrypt/decrypt messages:
 *    ```typescript
 *    // Encrypt
 *    const payload = await cryptoService.encryptMessage(peerId, 'Hello!');
 *    websocket.send({ type: 'encryptedMessage', content: payload });
 *
 *    // Decrypt
 *    const plaintext = await cryptoService.decryptMessage(senderId, payload);
 *    ```
 *
 * 5. Handle files:
 *    ```typescript
 *    // Encrypt file before upload
 *    const { encryptedFile, fileInfo } = await cryptoService.encryptFileForUpload(file, messageKey);
 *
 *    // Decrypt file after download
 *    const decryptedFile = await cryptoService.decryptDownloadedFile(encryptedFile, fileInfo, messageKey);
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
  DILITHIUM3_PUBLIC_KEY_SIZE,
  DILITHIUM3_PRIVATE_KEY_SIZE,
  DILITHIUM3_SIGNATURE_SIZE,
} from './pqc';

// X3DH key exchange
export { initiateX3DH, completeX3DH, createSessionFromX3DH, verifyIdentityFingerprint } from './x3dh';

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
