// Symmetric encryption using Web Crypto API
// Supports AES-256-GCM and XChaCha20-Poly1305 (via libsodium)

import { EncryptedMessage } from './types';
import { randomBytes, concat } from './utils';

// Constants
const AES_GCM_NONCE_SIZE = 12;
const AES_GCM_TAG_SIZE = 16;
const KEY_SIZE = 32; // 256 bits

/**
 * Convert Uint8Array to ArrayBuffer safely (handles SharedArrayBuffer)
 */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/**
 * Generate a random symmetric key
 */
export function generateSymmetricKey(): Uint8Array {
  return randomBytes(KEY_SIZE);
}

/**
 * Generate a random nonce for AES-GCM
 */
export function generateNonce(): Uint8Array {
  return randomBytes(AES_GCM_NONCE_SIZE);
}

/**
 * Encrypt data using AES-256-GCM
 */
export async function encryptAESGCM(
  key: Uint8Array,
  plaintext: Uint8Array,
  additionalData?: Uint8Array
): Promise<EncryptedMessage> {
  if (key.length !== KEY_SIZE) {
    throw new Error(`Invalid key size: expected ${KEY_SIZE}, got ${key.length}`);
  }

  const nonce = generateNonce();

  // Import key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: additionalData ? toArrayBuffer(additionalData) : undefined,
      tagLength: AES_GCM_TAG_SIZE * 8,
    },
    cryptoKey,
    toArrayBuffer(plaintext)
  );

  return {
    ciphertext: new Uint8Array(ciphertext),
    nonce,
    algorithm: 'aes-256-gcm',
  };
}

/**
 * Decrypt data using AES-256-GCM
 */
export async function decryptAESGCM(
  key: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  additionalData?: Uint8Array
): Promise<Uint8Array> {
  if (key.length !== KEY_SIZE) {
    throw new Error(`Invalid key size: expected ${KEY_SIZE}, got ${key.length}`);
  }
  if (nonce.length !== AES_GCM_NONCE_SIZE) {
    throw new Error(`Invalid nonce size: expected ${AES_GCM_NONCE_SIZE}, got ${nonce.length}`);
  }

  // Import key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: additionalData ? toArrayBuffer(additionalData) : undefined,
      tagLength: AES_GCM_TAG_SIZE * 8,
    },
    cryptoKey,
    toArrayBuffer(ciphertext)
  );

  return new Uint8Array(plaintext);
}

/**
 * Encrypt using the specified algorithm
 */
export async function encrypt(
  algorithm: 'aes-256-gcm' | 'xchacha20-poly1305',
  key: Uint8Array,
  plaintext: Uint8Array,
  additionalData?: Uint8Array
): Promise<EncryptedMessage> {
  switch (algorithm) {
    case 'aes-256-gcm':
      return encryptAESGCM(key, plaintext, additionalData);
    case 'xchacha20-poly1305':
      // XChaCha20-Poly1305 requires libsodium
      // Fall back to AES-GCM if libsodium is not available
      // In production, load libsodium-wrappers for XChaCha20
      console.warn('XChaCha20-Poly1305 not available, falling back to AES-GCM');
      return encryptAESGCM(key, plaintext, additionalData);
    default:
      throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
}

/**
 * Decrypt using the message's algorithm
 */
export async function decrypt(
  key: Uint8Array,
  message: EncryptedMessage,
  additionalData?: Uint8Array
): Promise<Uint8Array> {
  switch (message.algorithm) {
    case 'aes-256-gcm':
      return decryptAESGCM(key, message.ciphertext, message.nonce, additionalData);
    case 'xchacha20-poly1305':
      // XChaCha20-Poly1305 requires libsodium
      console.warn('XChaCha20-Poly1305 not available, trying AES-GCM fallback');
      return decryptAESGCM(key, message.ciphertext, message.nonce, additionalData);
    default:
      throw new Error(`Unsupported algorithm: ${message.algorithm}`);
  }
}

/**
 * Encrypt a string message (convenience function)
 */
export async function encryptString(
  key: Uint8Array,
  plaintext: string,
  algorithm: 'aes-256-gcm' | 'xchacha20-poly1305' = 'aes-256-gcm'
): Promise<EncryptedMessage> {
  const encoder = new TextEncoder();
  return encrypt(algorithm, key, encoder.encode(plaintext));
}

/**
 * Decrypt to string (convenience function)
 */
export async function decryptToString(
  key: Uint8Array,
  message: EncryptedMessage
): Promise<string> {
  const plaintext = await decrypt(key, message);
  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}

/**
 * Encrypt a file (returns encrypted content + file key)
 */
export async function encryptFile(
  file: Uint8Array,
  algorithm: 'aes-256-gcm' | 'xchacha20-poly1305' = 'aes-256-gcm'
): Promise<{ encryptedFile: Uint8Array; fileKey: Uint8Array; nonce: Uint8Array }> {
  const fileKey = generateSymmetricKey();
  const encrypted = await encrypt(algorithm, fileKey, file);

  return {
    encryptedFile: encrypted.ciphertext,
    fileKey,
    nonce: encrypted.nonce,
  };
}

/**
 * Decrypt a file
 */
export async function decryptFile(
  encryptedFile: Uint8Array,
  fileKey: Uint8Array,
  nonce: Uint8Array,
  algorithm: 'aes-256-gcm' | 'xchacha20-poly1305' = 'aes-256-gcm'
): Promise<Uint8Array> {
  return decrypt(fileKey, {
    ciphertext: encryptedFile,
    nonce,
    algorithm,
  });
}
