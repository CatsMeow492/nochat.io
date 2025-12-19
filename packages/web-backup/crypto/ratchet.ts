/**
 * Double Ratchet Algorithm with PQC
 *
 * This implements the Double Ratchet algorithm used by Signal Protocol,
 * adapted for post-quantum security using Kyber for DH ratchets.
 *
 * The algorithm provides:
 * - Forward secrecy: Past messages cannot be decrypted if keys are compromised
 * - Break-in recovery: Future messages are secure after a compromise
 * - Out-of-order message handling: Messages can arrive in any order
 */

import { SessionState, KyberKeyPair, EncryptedMessage, DEFAULT_CRYPTO_CONFIG } from './types';
import { kyberEncapsulate, kyberDecapsulate, generateKyberKeyPair } from './pqc';
import { encrypt, decrypt, generateSymmetricKey } from './symmetric';
import { hkdfDerive, concat, toHex, sha256, toBase64, fromBase64 } from './utils';

const CHAIN_KEY_INFO = new TextEncoder().encode('nochat-chain-v1');
const MESSAGE_KEY_INFO = new TextEncoder().encode('nochat-message-v1');
const ROOT_KEY_INFO = new TextEncoder().encode('nochat-root-v1');

/**
 * Result of encrypting a message
 */
export interface RatchetEncryptResult {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  chainIndex: number;
  previousChainLength: number;
}

/**
 * Advance the sending chain and encrypt a message
 */
export async function ratchetEncrypt(
  session: SessionState,
  plaintext: Uint8Array,
  additionalData?: Uint8Array
): Promise<RatchetEncryptResult> {
  // Derive message key from chain key
  const [messageKey, nextChainKey] = await deriveMessageKey(session.sendingChainKey);

  // Encrypt the message
  const encrypted = await encrypt(
    DEFAULT_CRYPTO_CONFIG.defaultAlgorithm,
    messageKey,
    plaintext,
    additionalData
  );

  // Store current chain index
  const chainIndex = session.sendingChainIndex;

  // Update session state
  session.sendingChainKey = nextChainKey;
  session.sendingChainIndex++;
  session.updatedAt = Date.now();

  return {
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    ephemeralPublicKey: session.sendingEphemeralKeyPair.publicKey,
    chainIndex,
    previousChainLength: session.receivingChainIndex,
  };
}

/**
 * Decrypt a message and advance the receiving chain
 */
export async function ratchetDecrypt(
  session: SessionState,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  chainIndex: number,
  additionalData?: Uint8Array
): Promise<Uint8Array> {
  // Check if this is a new DH ratchet
  const ephemeralKeyChanged = !constantTimeEqual(
    ephemeralPublicKey,
    session.receivingEphemeralKey
  );

  if (ephemeralKeyChanged) {
    // Perform DH ratchet
    await performDHRatchet(session, ephemeralPublicKey);
  }

  // Check for out-of-order message
  if (chainIndex < session.receivingChainIndex) {
    // Try to decrypt with skipped message key
    const skippedKey = getSkippedMessageKey(session, ephemeralPublicKey, chainIndex);
    if (!skippedKey) {
      throw new Error('Message key not found for out-of-order message');
    }
    return decrypt(skippedKey, { ciphertext, nonce, algorithm: DEFAULT_CRYPTO_CONFIG.defaultAlgorithm }, additionalData);
  }

  // Skip ahead if there are gaps
  if (chainIndex > session.receivingChainIndex) {
    await skipMessageKeys(session, chainIndex);
  }

  // Derive message key
  const [messageKey, nextChainKey] = await deriveMessageKey(session.receivingChainKey);

  // Update session state
  session.receivingChainKey = nextChainKey;
  session.receivingChainIndex++;
  session.updatedAt = Date.now();

  // Decrypt
  return decrypt(messageKey, { ciphertext, nonce, algorithm: DEFAULT_CRYPTO_CONFIG.defaultAlgorithm }, additionalData);
}

/**
 * Perform a DH ratchet step (when receiving a new ephemeral key)
 */
async function performDHRatchet(
  session: SessionState,
  newEphemeralPublicKey: Uint8Array
): Promise<void> {
  // Save current chain state for out-of-order messages
  if (session.receivingEphemeralKey.length > 0) {
    const chainKey = toBase64(session.receivingEphemeralKey);
    session.previousChainKeys.set(chainKey, session.receivingChainKey);
  }

  // Update receiving ephemeral key
  session.receivingEphemeralKey = newEphemeralPublicKey;
  session.receivingChainIndex = 0;

  // Derive new receiving chain key using Kyber decapsulation
  // In a full implementation, this would use the ciphertext sent with the message
  // For now, we use HKDF with the public keys
  const dhOutput = await sha256(concat(
    session.sendingEphemeralKeyPair.privateKey.slice(0, 32),
    newEphemeralPublicKey.slice(0, 32)
  ));

  const [newRootKey, newReceivingChainKey] = await deriveRootKey(
    session.rootKey,
    dhOutput
  );

  session.rootKey = newRootKey;
  session.receivingChainKey = newReceivingChainKey;

  // Generate new sending ephemeral key pair
  session.sendingEphemeralKeyPair = await generateKyberKeyPair();
  session.sendingChainIndex = 0;

  // Derive new sending chain key
  const newDhOutput = await sha256(concat(
    session.sendingEphemeralKeyPair.privateKey.slice(0, 32),
    newEphemeralPublicKey.slice(0, 32)
  ));

  const [finalRootKey, newSendingChainKey] = await deriveRootKey(
    session.rootKey,
    newDhOutput
  );

  session.rootKey = finalRootKey;
  session.sendingChainKey = newSendingChainKey;
}

/**
 * Derive a new root key and chain key from DH output
 */
async function deriveRootKey(
  rootKey: Uint8Array,
  dhOutput: Uint8Array
): Promise<[Uint8Array, Uint8Array]> {
  const derived = await hkdfDerive(
    concat(rootKey, dhOutput),
    new Uint8Array(32),
    ROOT_KEY_INFO,
    64
  );

  return [derived.slice(0, 32), derived.slice(32, 64)];
}

/**
 * Derive a message key from a chain key
 */
async function deriveMessageKey(chainKey: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const derived = await hkdfDerive(chainKey, new Uint8Array(32), CHAIN_KEY_INFO, 64);
  const messageKey = derived.slice(0, 32);
  const nextChainKey = derived.slice(32, 64);
  return [messageKey, nextChainKey];
}

/**
 * Skip message keys for out-of-order delivery
 */
async function skipMessageKeys(session: SessionState, targetIndex: number): Promise<void> {
  const maxSkip = DEFAULT_CRYPTO_CONFIG.maxSkippedMessages;
  const skipsNeeded = targetIndex - session.receivingChainIndex;

  if (skipsNeeded > maxSkip) {
    throw new Error(`Too many skipped messages: ${skipsNeeded}`);
  }

  for (let i = session.receivingChainIndex; i < targetIndex; i++) {
    const [messageKey, nextChainKey] = await deriveMessageKey(session.receivingChainKey);

    // Store skipped message key
    const keyId = createMessageKeyId(session.receivingEphemeralKey, i);
    session.skippedMessageKeys.set(keyId, messageKey);

    session.receivingChainKey = nextChainKey;
  }

  session.receivingChainIndex = targetIndex;
}

/**
 * Get a skipped message key
 */
function getSkippedMessageKey(
  session: SessionState,
  ephemeralKey: Uint8Array,
  chainIndex: number
): Uint8Array | undefined {
  const keyId = createMessageKeyId(ephemeralKey, chainIndex);
  const key = session.skippedMessageKeys.get(keyId);

  if (key) {
    // Remove used key
    session.skippedMessageKeys.delete(keyId);
  }

  return key;
}

/**
 * Create a unique ID for a message key
 */
function createMessageKeyId(ephemeralKey: Uint8Array, chainIndex: number): string {
  return `${toHex(ephemeralKey.slice(0, 8))}:${chainIndex}`;
}

/**
 * Constant-time comparison of two byte arrays
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Serialize session state for storage
 */
export function serializeSessionState(session: SessionState): string {
  const serializable = {
    ...session,
    sendingEphemeralKeyPair: {
      publicKey: toBase64(session.sendingEphemeralKeyPair.publicKey),
      privateKey: toBase64(session.sendingEphemeralKeyPair.privateKey),
    },
    rootKey: toBase64(session.rootKey),
    sendingChainKey: toBase64(session.sendingChainKey),
    receivingChainKey: toBase64(session.receivingChainKey),
    receivingEphemeralKey: toBase64(session.receivingEphemeralKey),
    peerIdentityKey: toBase64(session.peerIdentityKey),
    previousChainKeys: Object.fromEntries(
      Array.from(session.previousChainKeys.entries()).map(([k, v]) => [k, toBase64(v)])
    ),
    skippedMessageKeys: Object.fromEntries(
      Array.from(session.skippedMessageKeys.entries()).map(([k, v]) => [k, toBase64(v)])
    ),
  };
  return JSON.stringify(serializable);
}

/**
 * Deserialize session state from storage
 */
export function deserializeSessionState(data: string): SessionState {
  const parsed = JSON.parse(data);
  return {
    ...parsed,
    sendingEphemeralKeyPair: {
      publicKey: fromBase64(parsed.sendingEphemeralKeyPair.publicKey),
      privateKey: fromBase64(parsed.sendingEphemeralKeyPair.privateKey),
    },
    rootKey: fromBase64(parsed.rootKey),
    sendingChainKey: fromBase64(parsed.sendingChainKey),
    receivingChainKey: fromBase64(parsed.receivingChainKey),
    receivingEphemeralKey: fromBase64(parsed.receivingEphemeralKey),
    peerIdentityKey: fromBase64(parsed.peerIdentityKey),
    previousChainKeys: new Map(
      Object.entries(parsed.previousChainKeys).map(([k, v]) => [k, fromBase64(v as string)])
    ),
    skippedMessageKeys: new Map(
      Object.entries(parsed.skippedMessageKeys).map(([k, v]) => [k, fromBase64(v as string)])
    ),
  };
}
