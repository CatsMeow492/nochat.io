/**
 * Post-Quantum Cryptography module for nochat.io
 *
 * IMPLEMENTATION STATUS: PREPARED (Not Active in Main Encryption Path)
 *
 * This module provides post-quantum cryptographic primitives using:
 * - ML-KEM (Kyber-1024) for key encapsulation via @noble/post-quantum
 * - X25519 for classical ECDH via @noble/curves
 * - Ed25519 for digital signatures via @noble/curves (Dilithium placeholder)
 *
 * IMPORTANT: These primitives are AVAILABLE but NOT USED by CryptoService.
 * The main encryption path (CryptoService.ts) currently uses:
 * - P-256 ECDH for key exchange (Web Crypto API)
 * - P-256 ECDSA for signatures (Web Crypto API)
 *
 * This module exists to:
 * 1. Prepare for post-quantum migration
 * 2. Enable hybrid PQXDH when activated
 * 3. Provide quantum resistance when wired to CryptoService
 *
 * KEY SIZES:
 * - Kyber-1024 Public Key: 1568 bytes
 * - Kyber-1024 Private Key: 3168 bytes
 * - Kyber-1024 Ciphertext: 1568 bytes
 * - Kyber-1024 Shared Secret: 32 bytes
 * - X25519/Ed25519 keys: 32 bytes each
 *
 * @see /docs/crypto-inventory.md for full cryptographic details
 */

import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { KyberKeyPair, DilithiumKeyPair, KyberEncapsulation, ECKeyPair, HybridKeyPair } from './types';
import { randomBytes, toBase64, fromBase64 } from './utils';

// Key sizes for real PQC algorithms
export const KYBER1024_PUBLIC_KEY_SIZE = 1568;
export const KYBER1024_PRIVATE_KEY_SIZE = 3168;
export const KYBER1024_CIPHERTEXT_SIZE = 1568;
export const KYBER1024_SHARED_SECRET_SIZE = 32;

// X25519 sizes
export const X25519_PUBLIC_KEY_SIZE = 32;
export const X25519_PRIVATE_KEY_SIZE = 32;
export const X25519_SHARED_SECRET_SIZE = 32;

// Ed25519 sizes (for signing - placeholder until Dilithium WASM is ready)
export const ED25519_PUBLIC_KEY_SIZE = 32;
export const ED25519_PRIVATE_KEY_SIZE = 32;
export const ED25519_SIGNATURE_SIZE = 64;

// Legacy P-256 sizes (for backwards compatibility detection)
export const P256_PUBLIC_KEY_SIZE = 65;

// Module state
let cryptoReady = false;

/**
 * Initialize the crypto module
 */
export async function initPQC(): Promise<void> {
  if (cryptoReady) return;

  try {
    console.log('[Crypto] Initializing post-quantum cryptography module...');

    // Test ML-KEM (Kyber) is working
    const testKeys = ml_kem1024.keygen();
    if (!testKeys.publicKey || testKeys.publicKey.length !== KYBER1024_PUBLIC_KEY_SIZE) {
      throw new Error('ML-KEM initialization failed');
    }

    // Test X25519 is working
    const testX25519 = x25519.utils.randomSecretKey();
    const testX25519Pub = x25519.getPublicKey(testX25519);
    if (testX25519Pub.length !== X25519_PUBLIC_KEY_SIZE) {
      throw new Error('X25519 initialization failed');
    }

    cryptoReady = true;
    console.log('[Crypto] Post-quantum cryptography module initialized (ML-KEM + X25519)');
  } catch (error) {
    console.error('[Crypto] Failed to initialize crypto module:', error);
    throw new Error('Failed to initialize post-quantum cryptography');
  }
}

/**
 * Check if crypto is ready
 */
export function isPQCReady(): boolean {
  return cryptoReady;
}

/**
 * Generate a Kyber-1024 key pair for post-quantum key encapsulation
 */
export async function generateKyberKeyPair(): Promise<KyberKeyPair> {
  ensureReady();

  const keys = ml_kem1024.keygen();

  return {
    publicKey: keys.publicKey,
    privateKey: keys.secretKey,
  };
}

/**
 * Generate an X25519 key pair for classical ECDH
 */
export async function generateX25519KeyPair(): Promise<ECKeyPair> {
  ensureReady();

  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);

  return {
    publicKey,
    privateKey,
  };
}

/**
 * Generate a hybrid key pair (X25519 + Kyber-1024) for PQXDH
 */
export async function generateHybridKeyPair(): Promise<HybridKeyPair> {
  ensureReady();

  const ecKeyPair = await generateX25519KeyPair();
  const pqKeyPair = await generateKyberKeyPair();

  return {
    ecPublicKey: ecKeyPair.publicKey,
    ecPrivateKey: ecKeyPair.privateKey,
    pqPublicKey: pqKeyPair.publicKey,
    pqPrivateKey: pqKeyPair.privateKey,
  };
}

/**
 * Generate an Ed25519 key pair for digital signatures
 * Note: Ed25519 is a placeholder until Dilithium3 WASM is available.
 * For full post-quantum security, we should use Dilithium3.
 */
export async function generateDilithiumKeyPair(): Promise<DilithiumKeyPair> {
  ensureReady();

  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);

  return {
    publicKey,
    privateKey,
  };
}

/**
 * Encapsulate a shared secret using Kyber-1024
 * This generates a ciphertext and shared secret from a public key.
 * Only the holder of the corresponding private key can derive the shared secret.
 */
export async function kyberEncapsulate(publicKey: Uint8Array): Promise<KyberEncapsulation> {
  ensureReady();

  if (publicKey.length !== KYBER1024_PUBLIC_KEY_SIZE) {
    throw new Error(`Invalid Kyber public key size: expected ${KYBER1024_PUBLIC_KEY_SIZE}, got ${publicKey.length}`);
  }

  const { cipherText, sharedSecret } = ml_kem1024.encapsulate(publicKey);

  return {
    ciphertext: cipherText,
    sharedSecret,
  };
}

/**
 * Decapsulate a shared secret using Kyber-1024
 * Derives the same shared secret from a ciphertext using the private key.
 */
export async function kyberDecapsulate(
  privateKey: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  ensureReady();

  if (privateKey.length !== KYBER1024_PRIVATE_KEY_SIZE) {
    throw new Error(`Invalid Kyber private key size: expected ${KYBER1024_PRIVATE_KEY_SIZE}, got ${privateKey.length}`);
  }
  if (ciphertext.length !== KYBER1024_CIPHERTEXT_SIZE) {
    throw new Error(`Invalid Kyber ciphertext size: expected ${KYBER1024_CIPHERTEXT_SIZE}, got ${ciphertext.length}`);
  }

  const sharedSecret = ml_kem1024.decapsulate(ciphertext, privateKey);

  return sharedSecret;
}

/**
 * Perform X25519 Diffie-Hellman key exchange
 * Returns the shared secret from the private key and peer's public key.
 */
export async function x25519DH(
  privateKey: Uint8Array,
  peerPublicKey: Uint8Array
): Promise<Uint8Array> {
  ensureReady();

  if (privateKey.length !== X25519_PRIVATE_KEY_SIZE) {
    throw new Error(`Invalid X25519 private key size: expected ${X25519_PRIVATE_KEY_SIZE}, got ${privateKey.length}`);
  }
  if (peerPublicKey.length !== X25519_PUBLIC_KEY_SIZE) {
    throw new Error(`Invalid X25519 public key size: expected ${X25519_PUBLIC_KEY_SIZE}, got ${peerPublicKey.length}`);
  }

  const sharedSecret = x25519.getSharedSecret(privateKey, peerPublicKey);

  return sharedSecret;
}

/**
 * Sign a message using Ed25519
 * Note: This is a placeholder until Dilithium3 WASM is available.
 */
export async function dilithiumSign(
  privateKey: Uint8Array,
  message: Uint8Array
): Promise<Uint8Array> {
  ensureReady();

  if (privateKey.length !== ED25519_PRIVATE_KEY_SIZE) {
    throw new Error(`Invalid signing key size: expected ${ED25519_PRIVATE_KEY_SIZE}, got ${privateKey.length}`);
  }

  const signature = ed25519.sign(message, privateKey);

  return signature;
}

/**
 * Verify a signature using Ed25519
 * Note: This is a placeholder until Dilithium3 WASM is available.
 */
export async function dilithiumVerify(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): Promise<boolean> {
  ensureReady();

  if (publicKey.length !== ED25519_PUBLIC_KEY_SIZE) {
    throw new Error(`Invalid verification key size: expected ${ED25519_PUBLIC_KEY_SIZE}, got ${publicKey.length}`);
  }
  if (signature.length !== ED25519_SIGNATURE_SIZE) {
    throw new Error(`Invalid signature size: expected ${ED25519_SIGNATURE_SIZE}, got ${signature.length}`);
  }

  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

/**
 * Create a signed prekey (Kyber key signed with Ed25519)
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
 * Create a hybrid signed prekey (X25519 + Kyber signed with Ed25519)
 */
export async function createHybridSignedPreKey(
  identityPrivateKey: Uint8Array,
  keyId: number
): Promise<{
  hybridKeyPair: HybridKeyPair;
  signature: Uint8Array;
  keyId: number;
}> {
  const hybridKeyPair = await generateHybridKeyPair();

  // Sign the concatenation of EC and PQ public keys
  const combinedPublicKey = new Uint8Array(hybridKeyPair.ecPublicKey.length + hybridKeyPair.pqPublicKey.length);
  combinedPublicKey.set(hybridKeyPair.ecPublicKey, 0);
  combinedPublicKey.set(hybridKeyPair.pqPublicKey, hybridKeyPair.ecPublicKey.length);

  const signature = await dilithiumSign(identityPrivateKey, combinedPublicKey);

  return {
    hybridKeyPair,
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
 * Verify a hybrid signed prekey
 */
export async function verifyHybridSignedPreKey(
  identityPublicKey: Uint8Array,
  ecPublicKey: Uint8Array,
  pqPublicKey: Uint8Array,
  signature: Uint8Array
): Promise<boolean> {
  // Reconstruct the combined public key that was signed
  const combinedPublicKey = new Uint8Array(ecPublicKey.length + pqPublicKey.length);
  combinedPublicKey.set(ecPublicKey, 0);
  combinedPublicKey.set(pqPublicKey, ecPublicKey.length);

  return dilithiumVerify(identityPublicKey, combinedPublicKey, signature);
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

/**
 * Generate a batch of hybrid one-time prekeys
 */
export async function generateHybridOneTimePreKeys(
  startId: number,
  count: number
): Promise<Map<number, HybridKeyPair>> {
  const preKeys = new Map<number, HybridKeyPair>();

  for (let i = 0; i < count; i++) {
    const keyPair = await generateHybridKeyPair();
    preKeys.set(startId + i, keyPair);
  }

  return preKeys;
}

/**
 * Check if a key is a legacy P-256 key (for backwards compatibility)
 */
export function isLegacyP256Key(publicKey: Uint8Array): boolean {
  return publicKey.length === P256_PUBLIC_KEY_SIZE;
}

/**
 * Check if a key is a Kyber-1024 key
 */
export function isKyberKey(publicKey: Uint8Array): boolean {
  return publicKey.length === KYBER1024_PUBLIC_KEY_SIZE;
}

/**
 * Check if a key is an X25519 key
 */
export function isX25519Key(publicKey: Uint8Array): boolean {
  return publicKey.length === X25519_PUBLIC_KEY_SIZE;
}

// Helper functions

function ensureReady(): void {
  if (!cryptoReady) {
    throw new Error('Crypto module not initialized. Call initPQC() first.');
  }
}

/**
 * Serialize a key pair for storage
 */
export function serializeKeyPair<T extends KyberKeyPair | DilithiumKeyPair | ECKeyPair>(
  keyPair: T
): { publicKey: string; privateKey: string } {
  return {
    publicKey: toBase64(keyPair.publicKey),
    privateKey: toBase64(keyPair.privateKey),
  };
}

/**
 * Serialize a hybrid key pair for storage
 */
export function serializeHybridKeyPair(
  keyPair: HybridKeyPair
): { ecPublicKey: string; ecPrivateKey: string; pqPublicKey: string; pqPrivateKey: string } {
  return {
    ecPublicKey: toBase64(keyPair.ecPublicKey),
    ecPrivateKey: toBase64(keyPair.ecPrivateKey),
    pqPublicKey: toBase64(keyPair.pqPublicKey),
    pqPrivateKey: toBase64(keyPair.pqPrivateKey),
  };
}

/**
 * Deserialize a key pair from storage
 */
export function deserializeKeyPair(
  serialized: { publicKey: string; privateKey: string },
  type: 'kyber' | 'dilithium' | 'x25519'
): KyberKeyPair | DilithiumKeyPair | ECKeyPair {
  return {
    publicKey: fromBase64(serialized.publicKey),
    privateKey: fromBase64(serialized.privateKey),
  };
}

/**
 * Deserialize a hybrid key pair from storage
 */
export function deserializeHybridKeyPair(
  serialized: { ecPublicKey: string; ecPrivateKey: string; pqPublicKey: string; pqPrivateKey: string }
): HybridKeyPair {
  return {
    ecPublicKey: fromBase64(serialized.ecPublicKey),
    ecPrivateKey: fromBase64(serialized.ecPrivateKey),
    pqPublicKey: fromBase64(serialized.pqPublicKey),
    pqPrivateKey: fromBase64(serialized.pqPrivateKey),
  };
}
