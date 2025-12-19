/**
 * Post-Quantum Cryptography (PQC) module for nochat.io
 *
 * This module provides Kyber (ML-KEM) and Dilithium (ML-DSA) cryptographic operations.
 *
 * In production, this should be backed by a WASM module compiled from:
 * - cloudflare/circl (Go) or
 * - pqcrypto (Rust) or
 * - liboqs (C)
 *
 * For now, this provides the interface and stub implementations.
 * The actual WASM integration should be done in pqc-wasm.ts
 */

import { KyberKeyPair, DilithiumKeyPair, KyberEncapsulation } from './types';
import { randomBytes, toBase64, fromBase64 } from './utils';

// Key sizes for validation
export const KYBER1024_PUBLIC_KEY_SIZE = 1568;
export const KYBER1024_PRIVATE_KEY_SIZE = 3168;
export const KYBER1024_CIPHERTEXT_SIZE = 1568;
export const KYBER1024_SHARED_SECRET_SIZE = 32;

export const DILITHIUM3_PUBLIC_KEY_SIZE = 1952;
export const DILITHIUM3_PRIVATE_KEY_SIZE = 4016;
export const DILITHIUM3_SIGNATURE_SIZE = 3293;

// WASM module state
let wasmModule: any = null;
let wasmReady = false;

/**
 * Initialize the PQC WASM module
 * This should be called once at app startup
 */
export async function initPQC(): Promise<void> {
  if (wasmReady) return;

  try {
    // Try to load the WASM module
    // In production, this would be: const module = await import('./pqc-wasm');
    // For now, we'll use a fallback/stub

    console.log('[PQC] Initializing PQC cryptography...');

    // Check if WASM module is available
    // wasmModule = await loadWasmModule();
    // wasmReady = true;

    // For development, mark as ready with stub implementations
    wasmReady = true;
    console.log('[PQC] PQC module initialized (using development stubs)');
    console.warn('[PQC] WARNING: Using stub implementations! Not secure for production.');
  } catch (error) {
    console.error('[PQC] Failed to initialize PQC module:', error);
    throw new Error('Failed to initialize PQC cryptography');
  }
}

/**
 * Check if PQC is ready
 */
export function isPQCReady(): boolean {
  return wasmReady;
}

/**
 * Generate a Kyber1024 key pair for key encapsulation
 */
export async function generateKyberKeyPair(): Promise<KyberKeyPair> {
  ensureReady();

  if (wasmModule) {
    // Use WASM implementation
    return wasmModule.kyberGenerateKeyPair();
  }

  // Stub implementation for development
  // WARNING: This is NOT cryptographically secure!
  console.warn('[PQC] Using stub Kyber key generation');
  return {
    publicKey: randomBytes(KYBER1024_PUBLIC_KEY_SIZE),
    privateKey: randomBytes(KYBER1024_PRIVATE_KEY_SIZE),
  };
}

/**
 * Generate a Dilithium3 key pair for digital signatures
 */
export async function generateDilithiumKeyPair(): Promise<DilithiumKeyPair> {
  ensureReady();

  if (wasmModule) {
    // Use WASM implementation
    return wasmModule.dilithiumGenerateKeyPair();
  }

  // Stub implementation for development
  console.warn('[PQC] Using stub Dilithium key generation');
  return {
    publicKey: randomBytes(DILITHIUM3_PUBLIC_KEY_SIZE),
    privateKey: randomBytes(DILITHIUM3_PRIVATE_KEY_SIZE),
  };
}

/**
 * Encapsulate a shared secret using a Kyber public key
 * @param publicKey Recipient's Kyber public key
 * @returns Ciphertext (send to recipient) and shared secret (use locally)
 */
export async function kyberEncapsulate(publicKey: Uint8Array): Promise<KyberEncapsulation> {
  ensureReady();
  validateKeySize(publicKey, KYBER1024_PUBLIC_KEY_SIZE, 'Kyber public key');

  if (wasmModule) {
    return wasmModule.kyberEncapsulate(publicKey);
  }

  // Stub implementation
  console.warn('[PQC] Using stub Kyber encapsulation');
  return {
    ciphertext: randomBytes(KYBER1024_CIPHERTEXT_SIZE),
    sharedSecret: randomBytes(KYBER1024_SHARED_SECRET_SIZE),
  };
}

/**
 * Decapsulate a shared secret using a Kyber private key
 * @param privateKey Our Kyber private key
 * @param ciphertext Received ciphertext from encapsulation
 * @returns The shared secret
 */
export async function kyberDecapsulate(
  privateKey: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  ensureReady();
  validateKeySize(privateKey, KYBER1024_PRIVATE_KEY_SIZE, 'Kyber private key');
  validateKeySize(ciphertext, KYBER1024_CIPHERTEXT_SIZE, 'Kyber ciphertext');

  if (wasmModule) {
    return wasmModule.kyberDecapsulate(privateKey, ciphertext);
  }

  // Stub implementation
  console.warn('[PQC] Using stub Kyber decapsulation');
  return randomBytes(KYBER1024_SHARED_SECRET_SIZE);
}

/**
 * Sign a message using Dilithium3
 * @param privateKey Signer's Dilithium private key
 * @param message Message to sign
 * @returns Signature
 */
export async function dilithiumSign(
  privateKey: Uint8Array,
  message: Uint8Array
): Promise<Uint8Array> {
  ensureReady();
  validateKeySize(privateKey, DILITHIUM3_PRIVATE_KEY_SIZE, 'Dilithium private key');

  if (wasmModule) {
    return wasmModule.dilithiumSign(privateKey, message);
  }

  // Stub implementation
  console.warn('[PQC] Using stub Dilithium signing');
  return randomBytes(DILITHIUM3_SIGNATURE_SIZE);
}

/**
 * Verify a Dilithium3 signature
 * @param publicKey Signer's Dilithium public key
 * @param message Original message
 * @param signature Signature to verify
 * @returns true if valid, false otherwise
 */
export async function dilithiumVerify(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): Promise<boolean> {
  ensureReady();
  validateKeySize(publicKey, DILITHIUM3_PUBLIC_KEY_SIZE, 'Dilithium public key');
  validateKeySize(signature, DILITHIUM3_SIGNATURE_SIZE, 'Dilithium signature');

  if (wasmModule) {
    return wasmModule.dilithiumVerify(publicKey, message, signature);
  }

  // Stub implementation - always returns true (NOT SECURE!)
  console.warn('[PQC] Using stub Dilithium verification');
  return true;
}

/**
 * Create a signed prekey (Kyber key signed with Dilithium)
 */
export async function createSignedPreKey(
  identityPrivateKey: Uint8Array,
  keyId: number
): Promise<{
  keyPair: KyberKeyPair;
  signature: Uint8Array;
  keyId: number;
}> {
  const keyPair = await generateKyberKeyPair();
  const signature = await dilithiumSign(identityPrivateKey, keyPair.publicKey);

  return {
    keyPair,
    signature,
    keyId,
  };
}

/**
 * Verify a signed prekey
 */
export async function verifySignedPreKey(
  identityPublicKey: Uint8Array,
  preKeyPublicKey: Uint8Array,
  signature: Uint8Array
): Promise<boolean> {
  return dilithiumVerify(identityPublicKey, preKeyPublicKey, signature);
}

/**
 * Generate a batch of one-time prekeys
 */
export async function generateOneTimePreKeys(
  startId: number,
  count: number
): Promise<Map<number, KyberKeyPair>> {
  const preKeys = new Map<number, KyberKeyPair>();

  for (let i = 0; i < count; i++) {
    const keyPair = await generateKyberKeyPair();
    preKeys.set(startId + i, keyPair);
  }

  return preKeys;
}

// Helper functions

function ensureReady(): void {
  if (!wasmReady) {
    throw new Error('PQC module not initialized. Call initPQC() first.');
  }
}

function validateKeySize(data: Uint8Array, expectedSize: number, name: string): void {
  if (data.length !== expectedSize) {
    throw new Error(`Invalid ${name} size: expected ${expectedSize}, got ${data.length}`);
  }
}

/**
 * Serialize a key pair for storage
 */
export function serializeKeyPair<T extends KyberKeyPair | DilithiumKeyPair>(
  keyPair: T
): { publicKey: string; privateKey: string } {
  return {
    publicKey: toBase64(keyPair.publicKey),
    privateKey: toBase64(keyPair.privateKey),
  };
}

/**
 * Deserialize a key pair from storage
 */
export function deserializeKeyPair(
  serialized: { publicKey: string; privateKey: string },
  type: 'kyber' | 'dilithium'
): KyberKeyPair | DilithiumKeyPair {
  const publicKey = fromBase64(serialized.publicKey);
  const privateKey = fromBase64(serialized.privateKey);

  // Validate sizes
  if (type === 'kyber') {
    validateKeySize(publicKey, KYBER1024_PUBLIC_KEY_SIZE, 'Kyber public key');
    validateKeySize(privateKey, KYBER1024_PRIVATE_KEY_SIZE, 'Kyber private key');
  } else {
    validateKeySize(publicKey, DILITHIUM3_PUBLIC_KEY_SIZE, 'Dilithium public key');
    validateKeySize(privateKey, DILITHIUM3_PRIVATE_KEY_SIZE, 'Dilithium private key');
  }

  return { publicKey, privateKey };
}
