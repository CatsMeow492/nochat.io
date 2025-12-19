/**
 * CryptoService - Main E2EE service for nochat.io
 *
 * This service provides:
 * - Key generation and management
 * - Session establishment (X3DH)
 * - Message encryption/decryption (Double Ratchet)
 * - File encryption
 * - Key persistence (IndexedDB)
 */

import {
  KyberKeyPair,
  DilithiumKeyPair,
  LocalIdentityKeys,
  PreKeyBundle,
  SessionState,
  E2EEMessagePayload,
  EncryptedFileInfo,
  DEFAULT_CRYPTO_CONFIG,
} from './types';
import {
  initPQC,
  isPQCReady,
  generateDilithiumKeyPair,
  generateKyberKeyPair,
  createSignedPreKey,
  generateOneTimePreKeys,
  dilithiumSign,
  dilithiumVerify,
} from './pqc';
import { initiateX3DH, completeX3DH, createSessionFromX3DH } from './x3dh';
import { ratchetEncrypt, ratchetDecrypt, serializeSessionState, deserializeSessionState } from './ratchet';
import { encryptFile, decryptFile, encrypt, decrypt, generateSymmetricKey } from './symmetric';
import { toBase64, fromBase64, keyFingerprint, generateDeviceId } from './utils';

const DB_NAME = 'nochat-crypto';
const DB_VERSION = 1;
const STORE_KEYS = 'keys';
const STORE_SESSIONS = 'sessions';

/**
 * CryptoService singleton for E2EE operations
 */
export class CryptoService {
  private static instance: CryptoService;
  private db: IDBDatabase | null = null;
  private localKeys: LocalIdentityKeys | null = null;
  private sessions: Map<string, SessionState> = new Map();
  private userId: string | null = null;
  private deviceId: string;
  private initialized = false;

  private constructor() {
    this.deviceId = generateDeviceId();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService();
    }
    return CryptoService.instance;
  }

  /**
   * Initialize the crypto service
   */
  async initialize(userId: string): Promise<void> {
    if (this.initialized && this.userId === userId) {
      return;
    }

    console.log('[CryptoService] Initializing for user:', userId);

    // Initialize PQC module
    await initPQC();

    // Open IndexedDB
    this.db = await this.openDatabase();
    this.userId = userId;

    // Load or generate keys
    await this.loadOrGenerateKeys();

    // Load sessions
    await this.loadSessions();

    this.initialized = true;
    console.log('[CryptoService] Initialized successfully');
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized && isPQCReady();
  }

  /**
   * Get the local identity key fingerprint
   */
  async getIdentityFingerprint(): Promise<string | null> {
    if (!this.localKeys) return null;
    return keyFingerprint(this.localKeys.identityKeyPair.publicKey);
  }

  /**
   * Get keys for server upload
   */
  async getKeysForUpload(): Promise<{
    identityPublicKey: string;
    signedPreKey: { keyId: number; publicKey: string; signature: string };
    oneTimePreKeys: Array<{ keyId: number; publicKey: string }>;
  } | null> {
    if (!this.localKeys) return null;

    const otks: Array<{ keyId: number; publicKey: string }> = [];
    for (const [keyId, keyPair] of this.localKeys.oneTimePreKeys) {
      otks.push({
        keyId,
        publicKey: toBase64(keyPair.publicKey),
      });
    }

    return {
      identityPublicKey: toBase64(this.localKeys.identityKeyPair.publicKey),
      signedPreKey: {
        keyId: this.localKeys.signedPreKeyId,
        publicKey: toBase64(this.localKeys.signedPreKeyPair.publicKey),
        signature: toBase64(this.localKeys.signedPreKeySignature),
      },
      oneTimePreKeys: otks,
    };
  }

  /**
   * Establish a session with a peer using their prekey bundle
   */
  async establishSession(peerBundle: PreKeyBundle): Promise<void> {
    if (!this.localKeys) {
      throw new Error('Local keys not initialized');
    }

    console.log('[CryptoService] Establishing session with:', peerBundle.userId);

    // Perform X3DH key exchange
    const x3dhResult = await initiateX3DH(this.localKeys, peerBundle);

    // Create session state
    const session = await createSessionFromX3DH(
      peerBundle.userId,
      peerBundle.identityKey,
      x3dhResult,
      true // isInitiator
    );

    // Store session
    this.sessions.set(peerBundle.userId, session);
    await this.saveSession(peerBundle.userId, session);

    console.log('[CryptoService] Session established');
  }

  /**
   * Process an incoming key exchange message
   */
  async processKeyExchange(
    peerUserId: string,
    peerIdentityKey: Uint8Array,
    signedPreKeyCiphertext: Uint8Array,
    oneTimePreKeyId?: number,
    oneTimePreKeyCiphertext?: Uint8Array
  ): Promise<void> {
    if (!this.localKeys) {
      throw new Error('Local keys not initialized');
    }

    // Complete X3DH
    const x3dhResult = await completeX3DH(
      this.localKeys,
      peerIdentityKey,
      signedPreKeyCiphertext,
      oneTimePreKeyId,
      oneTimePreKeyCiphertext
    );

    // Create session state
    const session = await createSessionFromX3DH(
      peerUserId,
      peerIdentityKey,
      x3dhResult,
      false // isInitiator
    );

    // Store session
    this.sessions.set(peerUserId, session);
    await this.saveSession(peerUserId, session);
  }

  /**
   * Encrypt a message for a peer
   */
  async encryptMessage(
    peerId: string,
    plaintext: string
  ): Promise<E2EEMessagePayload> {
    const session = this.sessions.get(peerId);
    if (!session) {
      throw new Error(`No session with peer: ${peerId}`);
    }
    if (!this.localKeys) {
      throw new Error('Local keys not initialized');
    }

    const plaintextBytes = new TextEncoder().encode(plaintext);

    // Encrypt using Double Ratchet
    const result = await ratchetEncrypt(session, plaintextBytes);

    // Sign the ciphertext
    const signature = await dilithiumSign(
      this.localKeys.identityKeyPair.privateKey,
      result.ciphertext
    );

    // Save updated session
    await this.saveSession(peerId, session);

    return {
      ciphertext: toBase64(result.ciphertext),
      nonce: toBase64(result.nonce),
      ephemeralKey: toBase64(result.ephemeralPublicKey),
      signature: toBase64(signature),
      algorithm: DEFAULT_CRYPTO_CONFIG.defaultAlgorithm,
      senderKeyId: this.localKeys.signedPreKeyId,
      chainIndex: result.chainIndex,
    };
  }

  /**
   * Decrypt a message from a peer
   */
  async decryptMessage(
    peerId: string,
    payload: E2EEMessagePayload
  ): Promise<string> {
    const session = this.sessions.get(peerId);
    if (!session) {
      throw new Error(`No session with peer: ${peerId}`);
    }

    // Verify signature
    const isValid = await dilithiumVerify(
      session.peerIdentityKey,
      fromBase64(payload.ciphertext),
      fromBase64(payload.signature)
    );

    if (!isValid) {
      throw new Error('Invalid message signature');
    }

    // Decrypt using Double Ratchet
    const plaintext = await ratchetDecrypt(
      session,
      fromBase64(payload.ciphertext),
      fromBase64(payload.nonce),
      fromBase64(payload.ephemeralKey),
      payload.chainIndex
    );

    // Save updated session
    await this.saveSession(peerId, session);

    return new TextDecoder().decode(plaintext);
  }

  /**
   * Encrypt a file
   */
  async encryptFileForUpload(
    file: Uint8Array,
    messageKey: Uint8Array
  ): Promise<{ encryptedFile: Uint8Array; fileInfo: EncryptedFileInfo }> {
    // Encrypt file with random key
    const result = await encryptFile(file);

    // Encrypt file key with message key
    const encryptedKeyResult = await encrypt(
      DEFAULT_CRYPTO_CONFIG.defaultAlgorithm,
      messageKey,
      result.fileKey
    );

    return {
      encryptedFile: result.encryptedFile,
      fileInfo: {
        storageKey: '', // Will be set after upload
        encryptedFileKey: encryptedKeyResult.ciphertext,
        fileKeyNonce: encryptedKeyResult.nonce,
        algorithm: DEFAULT_CRYPTO_CONFIG.defaultAlgorithm,
      },
    };
  }

  /**
   * Decrypt a file
   */
  async decryptDownloadedFile(
    encryptedFile: Uint8Array,
    fileInfo: EncryptedFileInfo,
    messageKey: Uint8Array
  ): Promise<Uint8Array> {
    // Decrypt file key
    const fileKey = await decrypt(messageKey, {
      ciphertext: fileInfo.encryptedFileKey,
      nonce: fileInfo.fileKeyNonce,
      algorithm: fileInfo.algorithm as 'aes-256-gcm' | 'xchacha20-poly1305',
    });

    // Decrypt file
    return decryptFile(encryptedFile, fileKey, fileInfo.fileKeyNonce);
  }

  /**
   * Check if we have a session with a peer
   */
  hasSession(peerId: string): boolean {
    return this.sessions.has(peerId);
  }

  /**
   * Generate additional one-time prekeys
   */
  async generateMorePreKeys(count: number = DEFAULT_CRYPTO_CONFIG.preKeyBatchSize): Promise<void> {
    if (!this.localKeys) return;

    const maxKeyId = Math.max(...this.localKeys.oneTimePreKeys.keys(), 0);
    const newKeys = await generateOneTimePreKeys(maxKeyId + 1, count);

    for (const [keyId, keyPair] of newKeys) {
      this.localKeys.oneTimePreKeys.set(keyId, keyPair);
    }

    await this.saveKeys();
  }

  /**
   * Get current one-time prekey count
   */
  getPreKeyCount(): number {
    return this.localKeys?.oneTimePreKeys.size ?? 0;
  }

  // Private methods

  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_KEYS)) {
          db.createObjectStore(STORE_KEYS, { keyPath: 'userId' });
        }

        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          db.createObjectStore(STORE_SESSIONS, { keyPath: 'peerId' });
        }
      };
    });
  }

  private async loadOrGenerateKeys(): Promise<void> {
    if (!this.db || !this.userId) return;

    // Try to load existing keys
    const storedKeys = await this.loadKeys();

    if (storedKeys) {
      this.localKeys = storedKeys;
      console.log('[CryptoService] Loaded existing keys');
    } else {
      // Generate new keys
      await this.generateNewKeys();
      console.log('[CryptoService] Generated new keys');
    }
  }

  private async generateNewKeys(): Promise<void> {
    console.log('[CryptoService] Generating new identity keys...');

    // Generate identity key pair (Dilithium)
    const identityKeyPair = await generateDilithiumKeyPair();

    // Generate signed prekey (Kyber)
    const signedPreKeyId = 1;
    const signedPreKey = await createSignedPreKey(identityKeyPair.privateKey, signedPreKeyId);

    // Generate one-time prekeys
    const oneTimePreKeys = await generateOneTimePreKeys(1, DEFAULT_CRYPTO_CONFIG.preKeyBatchSize);

    this.localKeys = {
      identityKeyPair,
      signedPreKeyPair: signedPreKey.keyPair,
      signedPreKeyId,
      signedPreKeySignature: signedPreKey.signature,
      oneTimePreKeys,
      registrationId: Math.floor(Math.random() * 16380) + 1,
    };

    await this.saveKeys();
  }

  private async loadKeys(): Promise<LocalIdentityKeys | null> {
    if (!this.db || !this.userId) return null;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_KEYS, 'readonly');
      const store = tx.objectStore(STORE_KEYS);
      const request = store.get(this.userId);

      request.onsuccess = () => {
        if (request.result) {
          resolve(this.deserializeKeys(request.result.keys));
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async saveKeys(): Promise<void> {
    if (!this.db || !this.userId || !this.localKeys) return;

    const serialized = this.serializeKeys(this.localKeys);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_KEYS, 'readwrite');
      const store = tx.objectStore(STORE_KEYS);
      const request = store.put({ userId: this.userId, keys: serialized });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async loadSessions(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SESSIONS, 'readonly');
      const store = tx.objectStore(STORE_SESSIONS);
      const request = store.getAll();

      request.onsuccess = () => {
        for (const record of request.result) {
          try {
            const session = deserializeSessionState(record.sessionData);
            this.sessions.set(record.peerId, session);
          } catch (e) {
            console.error('[CryptoService] Failed to load session:', e);
          }
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async saveSession(peerId: string, session: SessionState): Promise<void> {
    if (!this.db) return;

    const sessionData = serializeSessionState(session);

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_SESSIONS, 'readwrite');
      const store = tx.objectStore(STORE_SESSIONS);
      const request = store.put({ peerId, sessionData });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private serializeKeys(keys: LocalIdentityKeys): any {
    return {
      identityKeyPair: {
        publicKey: toBase64(keys.identityKeyPair.publicKey),
        privateKey: toBase64(keys.identityKeyPair.privateKey),
      },
      signedPreKeyPair: {
        publicKey: toBase64(keys.signedPreKeyPair.publicKey),
        privateKey: toBase64(keys.signedPreKeyPair.privateKey),
      },
      signedPreKeyId: keys.signedPreKeyId,
      signedPreKeySignature: toBase64(keys.signedPreKeySignature),
      oneTimePreKeys: Object.fromEntries(
        Array.from(keys.oneTimePreKeys.entries()).map(([k, v]) => [
          k.toString(),
          {
            publicKey: toBase64(v.publicKey),
            privateKey: toBase64(v.privateKey),
          },
        ])
      ),
      registrationId: keys.registrationId,
    };
  }

  private deserializeKeys(data: any): LocalIdentityKeys {
    return {
      identityKeyPair: {
        publicKey: fromBase64(data.identityKeyPair.publicKey),
        privateKey: fromBase64(data.identityKeyPair.privateKey),
      },
      signedPreKeyPair: {
        publicKey: fromBase64(data.signedPreKeyPair.publicKey),
        privateKey: fromBase64(data.signedPreKeyPair.privateKey),
      },
      signedPreKeyId: data.signedPreKeyId,
      signedPreKeySignature: fromBase64(data.signedPreKeySignature),
      oneTimePreKeys: new Map(
        Object.entries(data.oneTimePreKeys).map(([k, v]: [string, any]) => [
          parseInt(k),
          {
            publicKey: fromBase64(v.publicKey),
            privateKey: fromBase64(v.privateKey),
          },
        ])
      ),
      registrationId: data.registrationId,
    };
  }
}

// Export singleton instance
export const cryptoService = CryptoService.getInstance();
