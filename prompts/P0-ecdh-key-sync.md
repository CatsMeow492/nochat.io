# P0: ECDH Key Synchronization Bug - P2P Decryption Fails

| Field | Value |
|-------|-------|
| **Agent Type** | Cryptography Engineer |
| **Priority** | P0 - Ship Blocker |
| **Complexity** | High |
| **Branch** | `fix/ecdh-key-sync` |
| **Dependencies** | None |
| **Created** | 2024-12-20 |
| **QA Report** | `.playwright-mcp/TWO-USER-MESSAGING-REPORT.md` |

---

## Objective

Fix the ECDH key synchronization bug that causes P2P-encrypted messages to fail decryption. Currently, when two users exchange messages using P2P encryption, the recipient cannot decrypt because each party derives a **different session key**.

---

## Problem Statement

### Current Behavior

When testuser1 and testuser2 exchange messages:

1. **testuser1** sends a message → Uses **legacy encryption** (testuser2 had no keys yet)
2. **testuser2** receives and reads message → Legacy decryption works
3. **testuser2** responds → Uses **P2P encryption** (both users now have keys)
4. **testuser1** cannot decrypt testuser2's response → **"Could not decrypt message"**

Console logs show:
```
[CryptoService] Using secure peer-based encryption
[useMessages] Sending encrypted message {isDM: true, peerCount: 1, secureMode: p2p}
[CryptoService] Peer decryption failed, trying legacy: OperationError
```

### Root Cause

The ECDH session key derivation is **asymmetric**:

```
testuser1 computes: sessionKey = ECDH(testuser1.privateKey, testuser2.publicKey)
testuser2 computes: sessionKey = ECDH(testuser2.privateKey, testuser1.publicKey)
```

These produce **different values** because standard ECDH produces:
- `ECDH(A.priv, B.pub) = A.priv * B.pub`
- `ECDH(B.priv, A.pub) = B.priv * A.pub`

These are mathematically **equal** only when using the same key pair on both sides. The bug is that each user is using their **own** private key with the peer's public key, but the derivation context or implementation is producing different results.

### Expected Behavior

Both parties should derive the **identical session key** so that:
- Messages encrypted by testuser1 can be decrypted by testuser2
- Messages encrypted by testuser2 can be decrypted by testuser1

---

## Technical Analysis

### Likely Causes

1. **Different HKDF context/info strings**: The key derivation may use user-specific info that differs between parties

2. **Non-deterministic salt**: If a random salt is used during HKDF without being transmitted

3. **Asymmetric key selection**: Each party might be selecting different keys for the ECDH computation

4. **Missing key agreement protocol**: The implementation may be missing a proper handshake where both parties agree on which keys to use

### ECDH Correct Implementation

For ECDH to work symmetrically:

```
Shared Secret = ECDH(A.privateKey, B.publicKey) = ECDH(B.privateKey, A.publicKey)
```

This is a mathematical property of elliptic curve Diffie-Hellman. If the shared secrets differ, the issue is in:
1. Which keys are being used
2. How the session key is derived FROM the shared secret

---

## Files to Investigate

### Primary (Frontend Crypto)

```
packages/web/src/crypto/CryptoService.ts    # Main crypto service, session key derivation
packages/web/src/crypto/symmetric.ts        # AES-GCM encryption/decryption
packages/web/src/crypto/x3dh.ts            # X3DH key exchange (if used)
packages/web/src/crypto/pqc.ts             # Post-quantum crypto (Kyber/Dilithium)
packages/web/src/hooks/use-messages.ts     # Message encryption/decryption logic
```

### Secondary (Backend)

```
packages/server/internal/crypto/keys.go     # Key storage and retrieval
packages/server/cmd/server/main.go          # API endpoints for key bundles
```

---

## Implementation Checklist

### Step 1: Diagnose the Key Derivation

Add detailed logging to identify where keys diverge:

```typescript
// In CryptoService.ts - deriveSessionKey method
console.log('[ECDH] Deriving session key:', {
  myUserId: this.userId,
  peerId: peerId,
  myPublicKey: await exportKey(myPublicKey),      // Log both public keys
  peerPublicKey: await exportKey(peerPublicKey),
  sharedSecret: arrayToHex(sharedSecret),         // Log the raw shared secret
  salt: arrayToHex(salt),                         // Log the salt used
  info: info,                                      // Log the HKDF info string
  derivedKey: arrayToHex(sessionKey)              // Log the final session key
});
```

- [ ] Add logging to both sender and receiver
- [ ] Compare logs to identify where values diverge
- [ ] Document the exact point of divergence

### Step 2: Fix Symmetric Key Derivation

The session key derivation MUST be deterministic and symmetric. Implement one of these approaches:

**Option A: Sorted User IDs in HKDF Info**

```typescript
async deriveSessionKey(peerId: string): Promise<CryptoKey> {
  const myPublicKey = await this.getExchangePublicKey();
  const peerBundle = await this.fetchPeerPrekeyBundle(peerId);

  // Compute ECDH shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerBundle.exchangeKey },
    this.exchangeKeyPair.privateKey,
    256
  );

  // CRITICAL: Use sorted user IDs to ensure both parties derive same key
  const sortedIds = [this.userId, peerId].sort();
  const info = `nochat-session-${sortedIds[0]}-${sortedIds[1]}`;

  // CRITICAL: Use deterministic salt (e.g., hash of sorted public keys)
  const myPubBytes = await exportKeyBytes(myPublicKey);
  const peerPubBytes = await exportKeyBytes(peerBundle.exchangeKey);
  const sortedKeys = [myPubBytes, peerPubBytes].sort(compareBytes);
  const salt = await sha256(concat(sortedKeys[0], sortedKeys[1]));

  // Derive session key with HKDF
  const sessionKey = await hkdf(sharedSecret, salt, info, 32);

  return sessionKey;
}
```

**Option B: X3DH-style with Initiator/Responder Roles**

```typescript
// Designate initiator based on sorted user IDs
const isInitiator = this.userId < peerId;

// Use X3DH with consistent roles
const sharedSecret = await x3dh(
  isInitiator ? myIdentityKey : peerIdentityKey,
  isInitiator ? peerPrekey : myPrekey,
  ephemeralKey
);
```

- [ ] Choose approach (A recommended for simplicity)
- [ ] Implement symmetric key derivation
- [ ] Ensure both parties use identical inputs to HKDF

### Step 3: Fix Session Storage

Ensure session keys are stored and retrieved consistently:

```typescript
// Store session with peer ID as key
await this.storeSession(peerId, {
  sessionKey: sessionKey,
  createdAt: Date.now(),
  myPublicKey: myPublicKey,
  peerPublicKey: peerPublicKey
});

// Retrieve using same peer ID
const session = await this.getSession(peerId);
```

- [ ] Verify session storage uses consistent keys
- [ ] Verify session retrieval works for both sender and receiver

### Step 4: Update Encryption/Decryption Flow

```typescript
// Encrypt message
async encryptForPeer(peerId: string, plaintext: string): Promise<EncryptedMessage> {
  const sessionKey = await this.getOrDeriveSessionKey(peerId);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await encryptAESGCM(sessionKey, nonce, plaintext);

  return {
    ciphertext: base64Encode(ciphertext),
    nonce: base64Encode(nonce),
    senderId: this.userId,
    recipientId: peerId
  };
}

// Decrypt message
async decryptFromPeer(senderId: string, message: EncryptedMessage): Promise<string> {
  // CRITICAL: Derive session key using SENDER's ID, not recipient
  const sessionKey = await this.getOrDeriveSessionKey(senderId);
  const plaintext = await decryptAESGCM(
    sessionKey,
    base64Decode(message.nonce),
    base64Decode(message.ciphertext)
  );

  return plaintext;
}
```

- [ ] Ensure encryption uses recipient's peer ID
- [ ] Ensure decryption uses sender's peer ID
- [ ] Verify session key is identical in both directions

### Step 5: Handle Legacy Fallback

Keep legacy encryption as fallback but log when it's used:

```typescript
try {
  // Try P2P decryption first
  return await this.decryptFromPeer(senderId, message);
} catch (p2pError) {
  console.warn('[CryptoService] P2P decryption failed, trying legacy:', p2pError);

  // Fall back to legacy (conversation-based) decryption
  return await this.decryptLegacy(conversationId, message);
}
```

- [ ] Keep legacy fallback for backwards compatibility
- [ ] Add metrics/logging to track P2P vs legacy usage
- [ ] Goal: 100% P2P for new DM conversations

---

## Testing Instructions

### Test 1: Verify Key Derivation Symmetry

```typescript
// Run in browser console for BOTH users, compare output:
const crypto = window.cryptoService; // Get service instance
const peerId = 'other-user-id';

// Log all derivation inputs
const sessionKey = await crypto.deriveSessionKey(peerId);
console.log('Session key:', await crypto.exportKey(sessionKey));
```

**Expected**: Both users should log the IDENTICAL session key hex string.

### Test 2: Two-User Message Exchange

1. Open browser window 1 → Login as testuser1
2. Open browser window 2 (incognito) → Login as testuser2
3. testuser1 creates conversation with testuser2
4. **Wait for testuser2 to open the conversation** (ensures both have keys)
5. testuser1 sends: "Hello from user1"
6. Verify: testuser2 sees the message (not "Could not decrypt")
7. testuser2 responds: "Hello from user2"
8. Verify: testuser1 sees the response (not "Could not decrypt")

### Test 3: Console Verification

After sending a message, console should show:

```
[ECDH] Encryption decision: {useP2P: true, isDM: true, hasPeers: true, sessionReady: true}
[CryptoService] Using secure peer-based encryption
[useMessages] Sending encrypted message {isDM: true, peerCount: 1, secureMode: p2p}
```

On receiving side:
```
[CryptoService] P2P decryption successful
```

**NOT**:
```
[CryptoService] Peer decryption failed, trying legacy: OperationError
```

### Test 4: IndexedDB Verification

```javascript
// Check that peer sessions are stored
(async () => {
  const request = indexedDB.open('nochat-crypto');
  request.onsuccess = (e) => {
    const db = e.target.result;
    const tx = db.transaction('peerSessions', 'readonly');
    const store = tx.objectStore('peerSessions');
    store.getAll().onsuccess = (e) => {
      console.log('Peer sessions:', e.target.result);
      // Should show session data for each peer
    };
  };
})();
```

---

## Acceptance Criteria

- [ ] testuser1 can send a P2P-encrypted message to testuser2
- [ ] testuser2 can decrypt and read testuser1's message
- [ ] testuser2 can send a P2P-encrypted response to testuser1
- [ ] testuser1 can decrypt and read testuser2's response
- [ ] Console shows `secureMode: p2p` for all DM messages
- [ ] No "Could not decrypt message" errors for P2P messages
- [ ] No "Peer decryption failed" warnings in console
- [ ] Session keys are identical when logged by both parties

---

## Constraints

**DO NOT:**
- Remove the legacy encryption fallback (keep for backwards compatibility)
- Change the message format/protocol (maintain API compatibility)
- Store private keys anywhere except local IndexedDB
- Transmit session keys over the network (only public keys)

**DO:**
- Use deterministic key derivation (sorted user IDs, sorted public keys)
- Add comprehensive logging for debugging
- Write unit tests for symmetric key derivation
- Document the key agreement protocol

---

## Related Documentation

- **QA Report**: `.playwright-mcp/TWO-USER-MESSAGING-REPORT.md`
- **Screenshots**: `.playwright-mcp/two_user_*.png`
- **Crypto Inventory**: `docs/crypto-inventory.md`
- **Existing Prompts**: `prompts/P0-qa-fixes.md` (Issue 3 is related)

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| P2P message delivery success | 0% | 100% |
| "Could not decrypt" errors | 100% for P2P | 0% |
| Session key symmetry | Asymmetric | Symmetric |
| Two-user DM encryption mode | Legacy fallback | P2P |

---

## References

- [ECDH on Wikipedia](https://en.wikipedia.org/wiki/Elliptic-curve_Diffie%E2%80%93Hellman)
- [HKDF RFC 5869](https://tools.ietf.org/html/rfc5869)
- [Signal Protocol Specification](https://signal.org/docs/)
- [Web Crypto API - ECDH](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey#ecdh)
