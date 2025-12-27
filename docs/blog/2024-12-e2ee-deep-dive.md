# How NoChat Implements End-to-End Encryption: A Technical Deep Dive

*December 2024*

When we say NoChat is "end-to-end encrypted," we mean something very specific: your messages are encrypted on your device before they ever leave it, and only the intended recipient can decrypt them. Our servers never see plaintext. This isn't a policy choice—it's a mathematical guarantee.

This post explains exactly how our encryption works, what security properties it provides, and why we made the design decisions we did.

## TL;DR

- **Key Exchange**: P-256 ECDH (Elliptic Curve Diffie-Hellman)
- **Message Encryption**: AES-256-GCM (Authenticated Encryption)
- **Key Derivation**: HKDF-SHA256
- **Key Storage**: Private keys never leave your device (IndexedDB)
- **Server sees**: Only opaque ciphertext blobs

## The Zero-Trust Architecture

NoChat operates on a **zero-trust model**. This means we designed the system assuming our own servers could be compromised. Even in that worst-case scenario, your message content remains protected.

Here's what our servers store:

```
┌──────────────────────────────────────────┐
│           Server Database                 │
├──────────────────────────────────────────┤
│ messages table:                          │
│   - conversation_id (UUID)               │
│   - sender_id (UUID)                     │
│   - encrypted_content (Base64 blob)  <── │ We can't read this
│   - created_at (timestamp)               │
│                                          │
│ identity_keys table:                     │
│   - user_id (UUID)                       │
│   - public_key (Base64)              <── │ Only public keys
│   - key_fingerprint (hex)                │
└──────────────────────────────────────────┘
```

Notice what's missing? Private keys. They exist only on your device.

## How Key Exchange Works

When you first message someone on NoChat, a secure session is established using the **Elliptic Curve Diffie-Hellman (ECDH)** protocol. Here's the flow:

### Step 1: Key Generation (First Launch)

When you first open NoChat, your device generates three key pairs:

```typescript
// Identity Key - Your long-term identity
identityKey = ECDSA.generateKeyPair(P-256)

// Exchange Key - Used for Diffie-Hellman key exchange
exchangeKey = ECDH.generateKeyPair(P-256)

// Signature Key - Signs your exchange key
signatureKey = ECDSA.generateKeyPair(P-256)
```

The **private** portions of these keys are stored in your browser's IndexedDB (or device keychain on mobile). They never leave your device.

The **public** portions are uploaded to our server so other users can establish sessions with you.

### Step 2: Session Establishment

When Alice wants to message Bob for the first time:

```
Alice                          Server                          Bob
  │                              │                              │
  │── Request Bob's public key ─>│                              │
  │<── Bob's P-256 public key ───│                              │
  │                              │                              │
  │  Local computation:          │                              │
  │  sharedSecret = ECDH(        │                              │
  │    Alice.privateKey,         │                              │
  │    Bob.publicKey             │                              │
  │  )                           │                              │
  │                              │                              │
  │  sessionKey = HKDF(          │                              │
  │    sharedSecret,             │                              │
  │    salt,                     │                              │
  │    info,                     │                              │
  │    32 bytes                  │                              │
  │  )                           │                              │
```

The magic of Diffie-Hellman: Bob can perform the same computation with *his* private key and *Alice's* public key, arriving at the **exact same shared secret**—without either party ever transmitting their private key.

### Step 3: Key Derivation

The raw ECDH shared secret is passed through HKDF (HMAC-based Key Derivation Function) to produce the actual encryption key:

```typescript
// Salt is deterministic based on both user IDs (sorted)
// This ensures both parties derive the same key
const saltString = `nochat-session-${sortedUserIds[0]}-${sortedUserIds[1]}`;
const salt = SHA256(saltString);

const info = "nochat-e2ee-v2";

const sessionKey = HKDF-SHA256(
  sharedSecret,  // From ECDH
  salt,          // Deterministic
  info,          // Context string
  32             // Output 256 bits for AES-256
);
```

**Why sorted user IDs?** This ensures both Alice and Bob derive the same key regardless of who initiates the conversation. If Alice's ID is `aaa...` and Bob's is `bbb...`, both compute: `nochat-session-aaa...-bbb...`.

## How Messages Are Encrypted

Once a session key exists, every message is encrypted with **AES-256-GCM**:

```typescript
// 1. Generate random 12-byte nonce (IV)
const nonce = crypto.getRandomValues(new Uint8Array(12));

// 2. Encrypt with AES-256-GCM
const ciphertext = AES-GCM.encrypt(
  sessionKey,
  nonce,
  plaintext
);
// GCM mode produces ciphertext + 16-byte authentication tag

// 3. Pack for transmission
const packed = nonce || ciphertext || authTag;
const encoded = Base64(packed);
```

### Why AES-256-GCM?

- **AES-256**: The symmetric cipher used by governments and financial institutions worldwide. Quantum computers would need ~2^128 operations to break it.
- **GCM Mode**: Provides both confidentiality AND integrity. If anyone tampers with the ciphertext (including our servers), decryption fails.
- **Random Nonces**: Each message gets a fresh 12-byte random nonce, preventing replay attacks.

### Message Format

```
┌─────────────────────────────────────────────────────┐
│                 Encrypted Message                    │
├──────────────┬─────────────────────┬────────────────┤
│   Nonce      │    Ciphertext       │   Auth Tag     │
│  (12 bytes)  │    (variable)       │  (16 bytes)    │
└──────────────┴─────────────────────┴────────────────┘
                        ↓
              Base64 encode for transmission
```

## Security Properties

### What We Guarantee

1. **Confidentiality**: Only sender and recipient can read messages
2. **Integrity**: Any tampering is detected (GCM authentication tag)
3. **Forward Secrecy**: Each peer pair has a unique session key
4. **Zero-Knowledge**: Servers never see plaintext or private keys

### Current Limitations (Transparency)

We believe in honest communication about security. Here's what the current implementation doesn't do:

1. **Per-message forward secrecy**: We use the same session key for all messages with a peer. Signal's Double Ratchet provides per-message key rotation. This is on our roadmap.

2. **Post-quantum resistance**: Our P-256 keys are not quantum-resistant. We have Kyber/Dilithium code prepared but not yet active. When NIST-standardized PQC becomes stable, we'll enable hybrid mode.

3. **Sender authentication**: Messages aren't signed. A sophisticated attacker who compromised our servers could potentially inject messages (though not read them). Key transparency is in development.

## Why Not Signal Protocol?

Signal Protocol is excellent. We considered using it directly. Here's why we started with a simpler approach:

| Aspect | Signal Protocol | NoChat (Current) |
|--------|----------------|------------------|
| Key Exchange | X3DH (Extended Triple DH) | P-256 ECDH |
| Ratcheting | Double Ratchet (per-message) | Session key (per-peer) |
| Prekeys | One-time prekeys | Signed prekeys only |
| Complexity | High | Moderate |
| Audit Surface | Large | Smaller |

Our philosophy: **Ship secure, iterate to more secure**. Our current implementation provides strong guarantees while we build toward Signal-equivalent properties.

## Implementation Details

### Web Crypto API

We use the browser's native Web Crypto API—not a JavaScript cryptography library. This provides:

- **Hardware-backed operations** on supported devices
- **Side-channel resistance** handled by the browser
- **No npm supply chain risk** for core crypto

```typescript
// All crypto operations use Web Crypto
const sharedSecret = await crypto.subtle.deriveBits(
  { name: 'ECDH', public: peerPublicKey },
  ourPrivateKey,
  256  // bits
);
```

### Key Storage

Private keys are stored in IndexedDB, encrypted by the browser's origin isolation:

```typescript
// Stored in IndexedDB 'nochat-crypto' database
{
  userId: "uuid",
  identityPublicKey: "base64...",
  identityPrivateKey: "{ JWK format }",  // Never sent to server
  exchangePublicKey: "base64...",
  exchangePrivateKey: "{ JWK format }",  // Never sent to server
  // ...
}
```

On iOS and Android (via Capacitor), keys are stored in the platform's secure storage (Keychain/Keystore).

## Comparing to Other Messengers

| Feature | NoChat | Signal | WhatsApp | Telegram |
|---------|--------|--------|----------|----------|
| E2EE by default | Yes | Yes | Yes | **No** (opt-in) |
| Phone number required | **No** | Yes | Yes | Yes |
| Open source | Yes | Yes | No | Partial |
| Server sees metadata | Minimal | Minimal | Yes (Meta) | Yes |
| Zero-knowledge architecture | Yes | Yes | No | No |

## What's Next

We're actively working on:

1. **Double Ratchet Protocol**: Per-message forward secrecy
2. **Post-Quantum Cryptography**: Hybrid ML-KEM (Kyber) + P-256
3. **Sealed Sender**: Hide sender identity from our servers
4. **Key Transparency**: Verifiable key distribution (like CT for TLS)

## Audit Our Code

Everything described here is open source:

- **Frontend Crypto**: [`packages/web/src/crypto/`](https://github.com/kindlyrobotics/nochat/tree/main/packages/web/src/crypto)
- **Backend Key Storage**: [`packages/server/internal/crypto/`](https://github.com/kindlyrobotics/nochat/tree/main/packages/server/internal/crypto)
- **Crypto Inventory**: [`docs/crypto-inventory.md`](https://github.com/kindlyrobotics/nochat/blob/main/docs/crypto-inventory.md)

We welcome security researchers to review our implementation. If you find issues, please report them to security@nochat.io.

## Conclusion

End-to-end encryption isn't magic—it's math. NoChat uses well-established cryptographic primitives (P-256, AES-256-GCM, HKDF) implemented through battle-tested Web Crypto APIs.

Our zero-trust architecture means that even if our servers were completely compromised, attackers would see only meaningless ciphertext. Your private keys exist only on your devices, and your messages can only be read by their intended recipients.

This is what we mean by "private by design."

---

*Questions about our cryptography? Email security@nochat.io or open an issue on [GitHub](https://github.com/kindlyrobotics/nochat).*

*For a machine-readable summary of our cryptographic implementation, see [docs/crypto-inventory.md](https://github.com/kindlyrobotics/nochat/blob/main/docs/crypto-inventory.md).*
