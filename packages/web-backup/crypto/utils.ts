// Crypto utility functions

/**
 * Convert Uint8Array to Base64 string
 */
export function toBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

/**
 * Convert Base64 string to Uint8Array
 */
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function toHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Generate cryptographically secure random bytes
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Compute SHA-256 hash of data
 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

/**
 * Compute key fingerprint (first 8 bytes of SHA-256 in hex)
 */
export async function keyFingerprint(publicKey: Uint8Array): Promise<string> {
  const hash = await sha256(publicKey);
  return toHex(hash.slice(0, 8));
}

/**
 * Concatenate multiple Uint8Arrays
 */
export function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Compare two Uint8Arrays for equality (constant time)
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
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
 * Securely clear sensitive data from memory
 * Note: JavaScript doesn't guarantee memory clearing, but this is best effort
 */
export function secureClear(data: Uint8Array): void {
  crypto.getRandomValues(data);
  data.fill(0);
}

/**
 * HKDF key derivation using Web Crypto API
 */
export async function hkdfDerive(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  keyLength: number
): Promise<Uint8Array> {
  // Import IKM as raw key
  const ikmKey = await crypto.subtle.importKey(
    'raw',
    ikm,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );

  // Derive key material
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      salt: salt,
      info: info,
      hash: 'SHA-256',
    },
    ikmKey,
    keyLength * 8
  );

  return new Uint8Array(derivedBits);
}

/**
 * Derive multiple keys from a master key
 */
export async function deriveKeys(
  masterKey: Uint8Array,
  salt: Uint8Array,
  keyLengths: number[]
): Promise<Uint8Array[]> {
  const totalLength = keyLengths.reduce((sum, len) => sum + len, 0);
  const derived = await hkdfDerive(
    masterKey,
    salt,
    new TextEncoder().encode('nochat-keys'),
    totalLength
  );

  const keys: Uint8Array[] = [];
  let offset = 0;
  for (const length of keyLengths) {
    keys.push(derived.slice(offset, offset + length));
    offset += length;
  }

  return keys;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${toHex(randomBytes(8))}`;
}

/**
 * Generate a unique device ID
 */
export function generateDeviceId(): string {
  return `device_${toHex(randomBytes(16))}`;
}

/**
 * Check if WebCrypto is available
 */
export function isWebCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

/**
 * Create a storage key for IndexedDB
 */
export function createStorageKey(userId: string, type: string): string {
  return `${userId}:${type}`;
}
