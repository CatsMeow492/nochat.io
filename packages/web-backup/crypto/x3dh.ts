/**
 * X3DH-style Key Exchange Protocol with PQC
 *
 * This is an adaptation of the Signal Protocol's Extended Triple Diffie-Hellman
 * key exchange, but using Kyber (ML-KEM) for post-quantum security.
 *
 * Key Exchange Flow:
 * 1. Alice fetches Bob's prekey bundle (identity key, signed prekey, one-time prekey)
 * 2. Alice generates ephemeral Kyber key pair
 * 3. Alice performs Kyber encapsulation with:
 *    - Bob's signed prekey
 *    - Bob's one-time prekey (if available)
 * 4. Alice derives shared secret from the encapsulated keys
 * 5. Alice sends encrypted initial message + ephemeral public key to Bob
 * 6. Bob decapsulates and derives the same shared secret
 * 7. Both now have a shared root key for the Double Ratchet
 */

import {
  KyberKeyPair,
  PreKeyBundle,
  LocalIdentityKeys,
  SessionState,
} from './types';
import {
  kyberEncapsulate,
  kyberDecapsulate,
  dilithiumSign,
  dilithiumVerify,
  generateKyberKeyPair,
} from './pqc';
import { hkdfDerive, concat, sha256, toBase64 } from './utils';
import { generateSymmetricKey } from './symmetric';

const X3DH_INFO = new TextEncoder().encode('nochat-x3dh-v1');
const RATCHET_INFO = new TextEncoder().encode('nochat-ratchet-v1');

/**
 * Result of X3DH key exchange (initiator side)
 */
export interface X3DHInitResult {
  sharedSecret: Uint8Array;
  ephemeralKeyPair: KyberKeyPair;
  ephemeralCiphertexts: {
    signedPreKeyCiphertext: Uint8Array;
    oneTimePreKeyCiphertext?: Uint8Array;
  };
  associatedData: Uint8Array;
}

/**
 * Result of X3DH key exchange (responder side)
 */
export interface X3DHResponseResult {
  sharedSecret: Uint8Array;
  associatedData: Uint8Array;
}

/**
 * Initiate X3DH key exchange (Alice's side)
 *
 * @param localKeys Our identity keys
 * @param peerBundle Peer's prekey bundle
 * @returns X3DH result including shared secret and ephemeral data
 */
export async function initiateX3DH(
  localKeys: LocalIdentityKeys,
  peerBundle: PreKeyBundle
): Promise<X3DHInitResult> {
  // 1. Verify the signed prekey
  const isValidSignedPreKey = await dilithiumVerify(
    peerBundle.identityKey,
    peerBundle.signedPreKey,
    peerBundle.signedPreKeySignature
  );

  if (!isValidSignedPreKey) {
    throw new Error('Invalid signed prekey signature');
  }

  // 2. Generate ephemeral Kyber key pair
  const ephemeralKeyPair = await generateKyberKeyPair();

  // 3. Perform Kyber encapsulation with signed prekey
  const signedPreKeyEncap = await kyberEncapsulate(peerBundle.signedPreKey);

  // 4. Perform Kyber encapsulation with one-time prekey (if available)
  let oneTimePreKeyEncap: { ciphertext: Uint8Array; sharedSecret: Uint8Array } | undefined;
  if (peerBundle.oneTimePreKey) {
    oneTimePreKeyEncap = await kyberEncapsulate(peerBundle.oneTimePreKey);
  }

  // 5. Combine shared secrets using HKDF
  let combinedSecret: Uint8Array;
  if (oneTimePreKeyEncap) {
    combinedSecret = concat(
      signedPreKeyEncap.sharedSecret,
      oneTimePreKeyEncap.sharedSecret
    );
  } else {
    combinedSecret = signedPreKeyEncap.sharedSecret;
  }

  // 6. Create associated data (for AEAD binding)
  const associatedData = concat(
    localKeys.identityKeyPair.publicKey,
    peerBundle.identityKey
  );

  // 7. Derive the final shared secret using HKDF
  const salt = await sha256(associatedData);
  const sharedSecret = await hkdfDerive(combinedSecret, salt, X3DH_INFO, 32);

  return {
    sharedSecret,
    ephemeralKeyPair,
    ephemeralCiphertexts: {
      signedPreKeyCiphertext: signedPreKeyEncap.ciphertext,
      oneTimePreKeyCiphertext: oneTimePreKeyEncap?.ciphertext,
    },
    associatedData,
  };
}

/**
 * Complete X3DH key exchange (Bob's side)
 *
 * @param localKeys Our identity keys
 * @param peerIdentityKey Peer's identity public key
 * @param ephemeralPublicKey Peer's ephemeral public key
 * @param signedPreKeyCiphertext Ciphertext from our signed prekey
 * @param oneTimePreKeyId ID of used one-time prekey (if any)
 * @param oneTimePreKeyCiphertext Ciphertext from our one-time prekey (if any)
 */
export async function completeX3DH(
  localKeys: LocalIdentityKeys,
  peerIdentityKey: Uint8Array,
  signedPreKeyCiphertext: Uint8Array,
  oneTimePreKeyId?: number,
  oneTimePreKeyCiphertext?: Uint8Array
): Promise<X3DHResponseResult> {
  // 1. Decapsulate using our signed prekey
  const signedPreKeySecret = await kyberDecapsulate(
    localKeys.signedPreKeyPair.privateKey,
    signedPreKeyCiphertext
  );

  // 2. Decapsulate using one-time prekey (if used)
  let oneTimePreKeySecret: Uint8Array | undefined;
  if (oneTimePreKeyId !== undefined && oneTimePreKeyCiphertext) {
    const oneTimePreKeyPair = localKeys.oneTimePreKeys.get(oneTimePreKeyId);
    if (!oneTimePreKeyPair) {
      throw new Error(`One-time prekey ${oneTimePreKeyId} not found`);
    }
    oneTimePreKeySecret = await kyberDecapsulate(
      oneTimePreKeyPair.privateKey,
      oneTimePreKeyCiphertext
    );

    // Remove used one-time prekey
    localKeys.oneTimePreKeys.delete(oneTimePreKeyId);
  }

  // 3. Combine shared secrets
  let combinedSecret: Uint8Array;
  if (oneTimePreKeySecret) {
    combinedSecret = concat(signedPreKeySecret, oneTimePreKeySecret);
  } else {
    combinedSecret = signedPreKeySecret;
  }

  // 4. Create associated data (same as initiator)
  const associatedData = concat(
    peerIdentityKey,
    localKeys.identityKeyPair.publicKey
  );

  // 5. Derive the final shared secret
  const salt = await sha256(associatedData);
  const sharedSecret = await hkdfDerive(combinedSecret, salt, X3DH_INFO, 32);

  return {
    sharedSecret,
    associatedData,
  };
}

/**
 * Create an initial session state after X3DH
 */
export async function createSessionFromX3DH(
  peerUserId: string,
  peerIdentityKey: Uint8Array,
  x3dhResult: X3DHInitResult | X3DHResponseResult,
  isInitiator: boolean
): Promise<SessionState> {
  // Derive initial chain keys from the shared secret
  const [rootKey, sendingChainKey, receivingChainKey] = await deriveChainKeys(
    x3dhResult.sharedSecret,
    isInitiator
  );

  // Generate initial sending ephemeral key pair
  const sendingEphemeralKeyPair = await generateKyberKeyPair();

  return {
    peerUserId,
    peerIdentityKey,
    rootKey,
    sendingChainKey,
    sendingChainIndex: 0,
    sendingEphemeralKeyPair,
    receivingChainKey,
    receivingChainIndex: 0,
    receivingEphemeralKey: new Uint8Array(0), // Will be set on first received message
    previousChainKeys: new Map(),
    skippedMessageKeys: new Map(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Derive initial chain keys from shared secret
 */
async function deriveChainKeys(
  sharedSecret: Uint8Array,
  isInitiator: boolean
): Promise<[Uint8Array, Uint8Array, Uint8Array]> {
  const derived = await hkdfDerive(sharedSecret, new Uint8Array(32), RATCHET_INFO, 96);

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

  return [rootKey, sendingChainKey, receivingChainKey];
}

/**
 * Verify peer's identity key fingerprint
 */
export async function verifyIdentityFingerprint(
  identityKey: Uint8Array,
  expectedFingerprint: string
): Promise<boolean> {
  const hash = await sha256(identityKey);
  const fingerprint = toBase64(hash.slice(0, 8));
  return fingerprint === expectedFingerprint;
}
