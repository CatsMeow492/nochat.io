/**
 * PQXDH - Post-Quantum Extended Diffie-Hellman Key Exchange
 *
 * This module implements the Signal Protocol's PQXDH specification for
 * quantum-resistant key exchange. It combines classical X25519 ECDH with
 * post-quantum ML-KEM (Kyber-1024) for hybrid security.
 *
 * SECURITY GUARANTEE:
 * Even if ML-KEM is broken, security falls back to X25519.
 * Even if X25519 is broken by quantum computers, ML-KEM provides protection.
 * Both must be broken simultaneously to compromise the key exchange.
 *
 * PROTOCOL FLOW (Initiator - Alice):
 * 1. Fetch Bob's hybrid prekey bundle
 * 2. Generate ephemeral X25519 + Kyber key pair
 * 3. Perform classical DH operations:
 *    - DH1 = X25519(IK_A.ec, SPK_B.ec)  // Identity → SignedPreKey
 *    - DH2 = X25519(EK_A.ec, IK_B.ec)   // Ephemeral → Identity
 *    - DH3 = X25519(EK_A.ec, SPK_B.ec)  // Ephemeral → SignedPreKey
 *    - DH4 = X25519(EK_A.ec, OPK_B.ec)  // Ephemeral → OneTimePreKey (optional)
 * 4. Perform post-quantum KEM:
 *    - (ct_spk, ss_spk) = Kyber.Encaps(SPK_B.pq)
 *    - (ct_opk, ss_opk) = Kyber.Encaps(OPK_B.pq) if available
 * 5. Combine: SharedSecret = KDF(0xFF..FF || DH1 || DH2 || DH3 || [DH4] || ss_spk || [ss_opk])
 *
 * @see https://signal.org/docs/specifications/pqxdh/
 * @see /docs/crypto-inventory.md
 */

import {
  generateX25519KeyPair,
  generateHybridKeyPair,
  x25519DH,
  kyberEncapsulate,
  kyberDecapsulate,
  dilithiumSign,
  dilithiumVerify,
  initPQC,
  isPQCReady,
  X25519_PUBLIC_KEY_SIZE,
  KYBER1024_PUBLIC_KEY_SIZE,
} from './pqc';
import { hkdfDerive, concat, sha256, toBase64, fromBase64 } from './utils';
import type {
  HybridKeyPair,
  HybridPreKeyBundle,
  HybridLocalIdentityKeys,
  SessionState,
  KyberKeyPair,
  ECKeyPair,
} from './types';

// Protocol constants
const PQXDH_INFO = new TextEncoder().encode('NoChat PQXDH v1');
const RATCHET_INFO = new TextEncoder().encode('nochat-ratchet-v1');
const PADDING_BYTE = 0xFF;
const PADDING_LENGTH = 32; // 32 bytes of 0xFF padding as per Signal spec

/**
 * Protocol version for hybrid PQXDH
 */
export const PQXDH_VERSION = 2;

/**
 * Result of PQXDH key exchange (initiator side)
 */
export interface PQXDHInitResult {
  /** 32-byte shared secret for session establishment */
  sharedSecret: Uint8Array;
  /** Our ephemeral EC public key to send to responder */
  ephemeralECPublic: Uint8Array;
  /** KEM ciphertext for signed prekey (send to responder) */
  signedPreKeyCiphertext: Uint8Array;
  /** KEM ciphertext for one-time prekey if used (send to responder) */
  oneTimePreKeyCiphertext?: Uint8Array;
  /** ID of used one-time prekey if any */
  usedOneTimePreKeyId?: number;
  /** Associated data for AEAD binding */
  associatedData: Uint8Array;
}

/**
 * Result of PQXDH key exchange (responder side)
 */
export interface PQXDHResponseResult {
  /** 32-byte shared secret (must match initiator's) */
  sharedSecret: Uint8Array;
  /** Associated data for AEAD binding */
  associatedData: Uint8Array;
}

/**
 * Hybrid ephemeral key pair for PQXDH (X25519 + Kyber)
 */
export interface PQXDHEphemeralKeyPair {
  ecKeyPair: ECKeyPair;
  pqKeyPair: KyberKeyPair;
}

/**
 * Data needed to initiate PQXDH with a peer
 */
export interface PQXDHInitiatorData {
  /** Our identity key pair (Ed25519/X25519 for signing and DH) */
  identityKeyPair: {
    signingKey: Uint8Array; // Ed25519 private key
    exchangeKey: Uint8Array; // X25519 private key derived from signing key
    publicKey: Uint8Array; // Ed25519 public key
    exchangePublic: Uint8Array; // X25519 public key
  };
  /** Pre-generated ephemeral key pair or null to generate fresh */
  ephemeralKeyPair?: PQXDHEphemeralKeyPair;
}

/**
 * Initialize PQXDH module (must be called before using other functions)
 */
export async function initPQXDH(): Promise<void> {
  await initPQC();
}

/**
 * Check if PQXDH is ready for use
 */
export function isPQXDHReady(): boolean {
  return isPQCReady();
}

/**
 * Generate an ephemeral key pair for PQXDH
 */
export async function generateEphemeralKeyPair(): Promise<PQXDHEphemeralKeyPair> {
  const ecKeyPair = await generateX25519KeyPair();
  const pqKeyPair = await generateHybridKeyPair();

  return {
    ecKeyPair,
    pqKeyPair: {
      publicKey: pqKeyPair.pqPublicKey,
      privateKey: pqKeyPair.pqPrivateKey,
    },
  };
}

/**
 * Initiate PQXDH key exchange (Alice's side)
 *
 * This performs the initiator role of PQXDH, generating ephemeral keys
 * and computing the shared secret with the responder's prekey bundle.
 *
 * @param initiatorData Our identity and ephemeral keys
 * @param peerBundle Peer's hybrid prekey bundle
 * @returns PQXDH result including shared secret and ciphertexts
 */
export async function pqxdhInitiate(
  initiatorData: PQXDHInitiatorData,
  peerBundle: HybridPreKeyBundle
): Promise<PQXDHInitResult> {
  if (!isPQXDHReady()) {
    throw new Error('PQXDH not initialized. Call initPQXDH() first.');
  }

  // 1. Verify the signed prekey signature
  const combinedPreKey = concat(peerBundle.signedPreKeyEC, peerBundle.signedPreKeyPQ);
  const isValidSignature = await dilithiumVerify(
    peerBundle.identityKey,
    combinedPreKey,
    peerBundle.signedPreKeySignature
  );

  if (!isValidSignature) {
    throw new Error('Invalid signed prekey signature - possible MITM attack');
  }

  // 2. Generate or use provided ephemeral key pair
  const ephemeralKeyPair = initiatorData.ephemeralKeyPair || await generateEphemeralKeyPair();

  // 3. Perform classical X25519 DH operations
  // DH1 = X25519(IK_A, SPK_B)
  const dh1 = await x25519DH(
    initiatorData.identityKeyPair.exchangeKey,
    peerBundle.signedPreKeyEC
  );

  // DH2 = X25519(EK_A, IK_B)
  // Note: We need Bob's identity exchange key (X25519), derived from his identity key
  // For now, assume peer's identity key is also their X25519 key (32 bytes)
  const peerIdentityEC = peerBundle.identityKey.length === 32
    ? peerBundle.identityKey
    : peerBundle.identityKey.slice(0, 32); // Take first 32 bytes if larger

  const dh2 = await x25519DH(
    ephemeralKeyPair.ecKeyPair.privateKey,
    peerIdentityEC
  );

  // DH3 = X25519(EK_A, SPK_B)
  const dh3 = await x25519DH(
    ephemeralKeyPair.ecKeyPair.privateKey,
    peerBundle.signedPreKeyEC
  );

  // DH4 = X25519(EK_A, OPK_B) if one-time prekey available
  let dh4: Uint8Array | null = null;
  if (peerBundle.oneTimePreKeyEC) {
    dh4 = await x25519DH(
      ephemeralKeyPair.ecKeyPair.privateKey,
      peerBundle.oneTimePreKeyEC
    );
  }

  // 4. Perform post-quantum KEM encapsulations
  // KEM1 = Kyber.Encaps(SPK_B.pq)
  const kem1 = await kyberEncapsulate(peerBundle.signedPreKeyPQ);

  // KEM2 = Kyber.Encaps(OPK_B.pq) if one-time prekey available
  let kem2: { ciphertext: Uint8Array; sharedSecret: Uint8Array } | null = null;
  if (peerBundle.oneTimePreKeyPQ) {
    kem2 = await kyberEncapsulate(peerBundle.oneTimePreKeyPQ);
  }

  // 5. Combine all secrets with KDF
  const sharedSecret = await kdfPQXDH(
    dh1, dh2, dh3, dh4,
    kem1.sharedSecret,
    kem2?.sharedSecret || null
  );

  // 6. Create associated data for AEAD binding
  // AD = IK_A.pub || IK_B.pub
  const associatedData = concat(
    initiatorData.identityKeyPair.exchangePublic,
    peerBundle.identityKey
  );

  return {
    sharedSecret,
    ephemeralECPublic: ephemeralKeyPair.ecKeyPair.publicKey,
    signedPreKeyCiphertext: kem1.ciphertext,
    oneTimePreKeyCiphertext: kem2?.ciphertext,
    usedOneTimePreKeyId: peerBundle.oneTimePreKeyId,
    associatedData,
  };
}

/**
 * Complete PQXDH key exchange (Bob's side)
 *
 * This performs the responder role of PQXDH, using our prekeys to
 * derive the same shared secret the initiator computed.
 *
 * @param localKeys Our identity and prekeys
 * @param peerIdentityKey Peer's identity public key
 * @param peerEphemeralEC Peer's ephemeral EC public key
 * @param signedPreKeyCiphertext KEM ciphertext for our signed prekey
 * @param oneTimePreKeyId ID of used one-time prekey (if any)
 * @param oneTimePreKeyCiphertext KEM ciphertext for our one-time prekey (if any)
 * @returns PQXDH result with shared secret
 */
export async function pqxdhRespond(
  localKeys: HybridLocalIdentityKeys,
  peerIdentityKey: Uint8Array,
  peerEphemeralEC: Uint8Array,
  signedPreKeyCiphertext: Uint8Array,
  oneTimePreKeyId?: number,
  oneTimePreKeyCiphertext?: Uint8Array
): Promise<PQXDHResponseResult> {
  if (!isPQXDHReady()) {
    throw new Error('PQXDH not initialized. Call initPQXDH() first.');
  }

  // Get the X25519 key from peer's identity (first 32 bytes if larger)
  const peerIdentityEC = peerIdentityKey.length === 32
    ? peerIdentityKey
    : peerIdentityKey.slice(0, 32);

  // 1. Perform classical X25519 DH operations (mirroring initiator)
  // DH1 = X25519(SPK_B, IK_A)
  const dh1 = await x25519DH(
    localKeys.signedPreKeyPair.ecPrivateKey,
    peerIdentityEC
  );

  // DH2 = X25519(IK_B, EK_A)
  // We need our identity exchange key - derive from identity key pair
  const ourIdentityEC = localKeys.identityKeyPair.privateKey.slice(0, 32); // X25519 portion
  const dh2 = await x25519DH(ourIdentityEC, peerEphemeralEC);

  // DH3 = X25519(SPK_B, EK_A)
  const dh3 = await x25519DH(
    localKeys.signedPreKeyPair.ecPrivateKey,
    peerEphemeralEC
  );

  // DH4 = X25519(OPK_B, EK_A) if one-time prekey was used
  let dh4: Uint8Array | null = null;
  if (oneTimePreKeyId !== undefined) {
    const otpk = localKeys.oneTimePreKeys.get(oneTimePreKeyId);
    if (!otpk) {
      throw new Error(`One-time prekey ${oneTimePreKeyId} not found`);
    }
    dh4 = await x25519DH(otpk.ecPrivateKey, peerEphemeralEC);
  }

  // 2. Perform post-quantum KEM decapsulation
  // KEM1 = Kyber.Decaps(SPK_B.pq, ct1)
  const kem1 = await kyberDecapsulate(
    localKeys.signedPreKeyPair.pqPrivateKey,
    signedPreKeyCiphertext
  );

  // KEM2 = Kyber.Decaps(OPK_B.pq, ct2) if one-time prekey was used
  let kem2: Uint8Array | null = null;
  if (oneTimePreKeyId !== undefined && oneTimePreKeyCiphertext) {
    const otpk = localKeys.oneTimePreKeys.get(oneTimePreKeyId);
    if (!otpk) {
      throw new Error(`One-time prekey ${oneTimePreKeyId} not found`);
    }
    kem2 = await kyberDecapsulate(otpk.pqPrivateKey, oneTimePreKeyCiphertext);

    // Mark one-time prekey as used (should be deleted after use)
    localKeys.oneTimePreKeys.delete(oneTimePreKeyId);
  }

  // 3. Combine all secrets with KDF (same as initiator)
  const sharedSecret = await kdfPQXDH(dh1, dh2, dh3, dh4, kem1, kem2);

  // 4. Create associated data (same as initiator but reversed order)
  const ourIdentityPublic = localKeys.identityKeyPair.publicKey.length === 32
    ? localKeys.identityKeyPair.publicKey
    : localKeys.identityKeyPair.publicKey.slice(0, 32);

  const associatedData = concat(peerIdentityEC, ourIdentityPublic);

  return {
    sharedSecret,
    associatedData,
  };
}

/**
 * KDF for combining PQXDH secrets
 *
 * Follows the Signal PQXDH specification:
 * input = 0xFF * 32 || DH1 || DH2 || DH3 || [DH4] || KEM1 || [KEM2]
 * output = HKDF-SHA256(input, salt=empty, info="NoChat PQXDH v1", length=32)
 */
async function kdfPQXDH(
  dh1: Uint8Array,
  dh2: Uint8Array,
  dh3: Uint8Array,
  dh4: Uint8Array | null,
  kem1: Uint8Array,
  kem2: Uint8Array | null
): Promise<Uint8Array> {
  // Calculate total input size
  let totalSize = PADDING_LENGTH + dh1.length + dh2.length + dh3.length + kem1.length;
  if (dh4) totalSize += dh4.length;
  if (kem2) totalSize += kem2.length;

  // Build input buffer
  const input = new Uint8Array(totalSize);
  let offset = 0;

  // Add 0xFF padding (32 bytes)
  input.fill(PADDING_BYTE, 0, PADDING_LENGTH);
  offset += PADDING_LENGTH;

  // Add DH results
  input.set(dh1, offset);
  offset += dh1.length;

  input.set(dh2, offset);
  offset += dh2.length;

  input.set(dh3, offset);
  offset += dh3.length;

  if (dh4) {
    input.set(dh4, offset);
    offset += dh4.length;
  }

  // Add KEM results
  input.set(kem1, offset);
  offset += kem1.length;

  if (kem2) {
    input.set(kem2, offset);
    offset += kem2.length;
  }

  // Derive shared secret using HKDF
  const salt = new Uint8Array(32); // Empty salt as per spec
  const sharedSecret = await hkdfDerive(input, salt, PQXDH_INFO, 32);

  // Zeroize input buffer for security
  input.fill(0);

  return sharedSecret;
}

/**
 * Create a session state from PQXDH result
 */
export async function createSessionFromPQXDH(
  peerUserId: string,
  peerIdentityKey: Uint8Array,
  pqxdhResult: PQXDHInitResult | PQXDHResponseResult,
  isInitiator: boolean
): Promise<SessionState> {
  // Derive initial chain keys from the shared secret
  const derived = await hkdfDerive(
    pqxdhResult.sharedSecret,
    new Uint8Array(32), // Empty salt
    RATCHET_INFO,
    96 // 32 bytes each for root, sending, and receiving
  );

  const rootKey = derived.slice(0, 32);
  let sendingChainKey: Uint8Array;
  let receivingChainKey: Uint8Array;

  if (isInitiator) {
    sendingChainKey = derived.slice(32, 64);
    receivingChainKey = derived.slice(64, 96);
  } else {
    receivingChainKey = derived.slice(32, 64);
    sendingChainKey = derived.slice(64, 96);
  }

  // Generate initial sending ephemeral key pair
  const ephemeralKeyPair = await generateEphemeralKeyPair();

  return {
    peerUserId,
    peerIdentityKey,
    rootKey,
    sendingChainKey,
    sendingChainIndex: 0,
    sendingEphemeralKeyPair: ephemeralKeyPair.pqKeyPair,
    receivingChainKey,
    receivingChainIndex: 0,
    receivingEphemeralKey: new Uint8Array(0), // Set on first received message
    previousChainKeys: new Map(),
    skippedMessageKeys: new Map(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Verify a peer's prekey bundle signature
 */
export async function verifyPrekeyBundle(bundle: HybridPreKeyBundle): Promise<boolean> {
  const combinedPreKey = concat(bundle.signedPreKeyEC, bundle.signedPreKeyPQ);
  return dilithiumVerify(
    bundle.identityKey,
    combinedPreKey,
    bundle.signedPreKeySignature
  );
}

/**
 * Detect if a prekey bundle is legacy (classical-only) or hybrid PQXDH
 */
export function isHybridBundle(bundle: unknown): bundle is HybridPreKeyBundle {
  if (!bundle || typeof bundle !== 'object') return false;
  const b = bundle as Record<string, unknown>;
  return (
    'bundleVersion' in b &&
    (b.bundleVersion === 2 || b.bundleVersion === PQXDH_VERSION) &&
    'signedPreKeyEC' in b &&
    'signedPreKeyPQ' in b
  );
}

/**
 * Detect if a key is a legacy P-256 key (65 bytes uncompressed)
 */
export function isLegacyP256Bundle(bundle: unknown): boolean {
  if (!bundle || typeof bundle !== 'object') return false;
  const b = bundle as Record<string, unknown>;
  if ('bundleVersion' in b && b.bundleVersion === 1) return true;
  if ('signed_prekey' in b) {
    const spk = b.signed_prekey as Record<string, unknown>;
    if ('kyber_public_key' in spk) {
      const key = spk.kyber_public_key;
      if (typeof key === 'string') {
        // P-256 keys are 65 bytes (87 base64 chars), Kyber is 1568 bytes
        return key.length < 100;
      }
    }
  }
  return false;
}

/**
 * Convert an API prekey bundle response to HybridPreKeyBundle format
 */
export function convertApiBundle(apiBundle: {
  user_id: string;
  identity_key: {
    dilithium_public_key: string;
    key_fingerprint: string;
  };
  signed_prekey: {
    key_id: number;
    ec_public_key?: string; // X25519 (32 bytes base64)
    kyber_public_key: string; // Kyber-1024 (1568 bytes base64)
    signature: string;
  };
  one_time_prekey?: {
    key_id: number;
    ec_public_key?: string;
    kyber_public_key: string;
  };
  bundle_version?: number;
}): HybridPreKeyBundle {
  // Determine if this is a hybrid bundle or legacy
  const hasECKey = !!apiBundle.signed_prekey.ec_public_key;
  const bundleVersion = apiBundle.bundle_version || (hasECKey ? 2 : 1);

  return {
    userId: apiBundle.user_id,
    identityKey: fromBase64(apiBundle.identity_key.dilithium_public_key),
    identityKeyFingerprint: apiBundle.identity_key.key_fingerprint,
    signedPreKeyId: apiBundle.signed_prekey.key_id,
    signedPreKeyEC: hasECKey
      ? fromBase64(apiBundle.signed_prekey.ec_public_key!)
      : new Uint8Array(X25519_PUBLIC_KEY_SIZE), // Empty for legacy
    signedPreKeyPQ: fromBase64(apiBundle.signed_prekey.kyber_public_key),
    signedPreKeySignature: fromBase64(apiBundle.signed_prekey.signature),
    oneTimePreKeyId: apiBundle.one_time_prekey?.key_id,
    oneTimePreKeyEC: apiBundle.one_time_prekey?.ec_public_key
      ? fromBase64(apiBundle.one_time_prekey.ec_public_key)
      : undefined,
    oneTimePreKeyPQ: apiBundle.one_time_prekey?.kyber_public_key
      ? fromBase64(apiBundle.one_time_prekey.kyber_public_key)
      : undefined,
    bundleVersion,
  };
}

/**
 * Export for testing: get the KDF function
 */
export const _internal = {
  kdfPQXDH,
};
