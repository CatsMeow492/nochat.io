# Cryptographic Inventory

**Last Updated:** December 2024
**Purpose:** Accurate inventory of cryptographic algorithms for security audit

---

## Implementation Status Overview

| Component | Status | Notes |
|-----------|--------|-------|
| E2EE Messaging | **Deployed** | Uses P-256 ECDH + AES-256-GCM |
| PQC Key Exchange | **Prepared** | Backend supports, frontend not wired |
| Sealed Sender | **Prepared** | Code exists, not fully integrated |
| Double Ratchet | **Partial** | Types defined, not actively used |

---

## Current Implementation (Deployed)

### Frontend Crypto (`packages/web/src/crypto/CryptoService.ts`)

The **CryptoService** is the active encryption service used for E2EE messaging.

#### Asymmetric Algorithms

| Algorithm | Purpose | Implementation | Key Size |
|-----------|---------|----------------|----------|
| **P-256 ECDSA** | Identity key signatures | Web Crypto API | 65 bytes (uncompressed public) |
| **P-256 ECDH** | Key exchange (session derivation) | Web Crypto API | 65 bytes (public) |

#### Symmetric Algorithms

| Algorithm | Purpose | Implementation | Key Size |
|-----------|---------|----------------|----------|
| **AES-256-GCM** | Message encryption | Web Crypto API | 256 bits |
| **HKDF-SHA256** | Key derivation | Web Crypto API | N/A |
| **SHA-256** | Fingerprinting | Web Crypto API | 256 bits |

#### Key Types (Current)

| Key | Algorithm | Lifespan | Storage |
|-----|-----------|----------|---------|
| Identity Key | P-256 ECDSA | Long-term | IndexedDB (private), PostgreSQL (public) |
| Exchange Key | P-256 ECDH | Long-term | IndexedDB (private), PostgreSQL (public) |
| Signature Key | P-256 ECDSA | Long-term | IndexedDB (private) |
| Session Key | AES-256 | Per-peer | Memory cache, IndexedDB |

### Backend Crypto (`packages/server/internal/crypto/`)

The backend **accepts both classical and PQC keys**, providing forward compatibility.

#### Supported Key Sizes

| Key Type | Accepted Sizes | Notes |
|----------|----------------|-------|
| Identity Key | 65 bytes (P-256) or 1952 bytes (Dilithium3) | Both accepted |
| Signed PreKey | 65 bytes (P-256), 32 bytes (X25519), or 1568 bytes (Kyber1024) | All accepted |
| Signature | 64-72 bytes (P-256 ECDSA) or 3293 bytes (Dilithium3) | Both accepted |

#### Symmetric Algorithms (Backend)

| Algorithm | Purpose | Library |
|-----------|---------|---------|
| **AES-256-GCM** | Envelope encryption | `crypto/aes` + `crypto/cipher` |
| **XChaCha20-Poly1305** | Alternative AEAD | `golang.org/x/crypto/chacha20poly1305` |
| **HKDF-SHA256** | Key derivation | `golang.org/x/crypto/hkdf` |

---

## Current Encryption Flow (1:1 DM)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Message Encryption Flow                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Alice                           Server                     Bob      │
│    │                               │                          │      │
│    │──── Fetch Bob's PreKey ──────>│                          │      │
│    │<─── P-256 Public Key ─────────│                          │      │
│    │                               │                          │      │
│    │  ECDH(Alice.priv, Bob.pub)    │                          │      │
│    │  ────────────────────────>    │                          │      │
│    │     = Shared Secret           │                          │      │
│    │                               │                          │      │
│    │  HKDF(secret, salt, info)     │                          │      │
│    │  ────────────────────────>    │                          │      │
│    │     = Session Key             │                          │      │
│    │                               │                          │      │
│    │  AES-256-GCM(sessionKey, msg) │                          │      │
│    │  ────────────────────────>    │                          │      │
│    │     = Ciphertext              │                          │      │
│    │                               │                          │      │
│    │───── Encrypted Message ──────>│──── Encrypted Message ──>│      │
│    │      (opaque to server)       │     (opaque to server)   │      │
│    │                               │                          │      │
│    │                               │   Bob performs same ECDH │      │
│    │                               │   ECDH(Bob.priv, Alice.pub)     │
│    │                               │   = Same Shared Secret   │      │
│    │                               │   = Same Session Key     │      │
│    │                               │   Decrypts message       │      │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Salt Derivation
```
salt = SHA-256("nochat-session-{sorted_user_ids}")
info = "nochat-e2ee-v2"
session_key = HKDF-SHA-256(shared_secret, salt, info, 32)
```

### Message Format
```
Packed Message = Nonce (12 bytes) || Ciphertext (variable) || Auth Tag (16 bytes)
Encoded = Base64(Packed Message)
```

---

## Available But Not Active (Prepared for Future)

### Frontend PQC Module (`packages/web/src/crypto/pqc.ts`)

The following algorithms are **imported and available** but **NOT used by CryptoService**:

| Algorithm | Library | Purpose | Status |
|-----------|---------|---------|--------|
| **ML-KEM (Kyber-1024)** | `@noble/post-quantum/ml-kem` | Key encapsulation | Available, unused |
| **X25519** | `@noble/curves/ed25519` | Classical ECDH | Available, unused |
| **Ed25519** | `@noble/curves/ed25519` | Digital signatures | Available (Dilithium placeholder) |

#### PQC Key Sizes (If Activated)

| Key Type | Size |
|----------|------|
| Kyber-1024 Public Key | 1568 bytes |
| Kyber-1024 Private Key | 3168 bytes |
| Kyber-1024 Ciphertext | 1568 bytes |
| Kyber-1024 Shared Secret | 32 bytes |
| X25519 Public/Private Key | 32 bytes each |
| Ed25519 Public Key | 32 bytes |
| Ed25519 Private Key | 32 bytes |
| Ed25519 Signature | 64 bytes |

### Backend PQC Implementation (`packages/server/internal/crypto/pqc.go`)

The backend has **full PQC implementations** via `cloudflare/circl`:

| Algorithm | Library | Purpose | Status |
|-----------|---------|---------|--------|
| **Kyber-1024** | `cloudflare/circl/kem/kyber/kyber1024` | Key encapsulation | Implemented |
| **Dilithium3** | `cloudflare/circl/sign/dilithium/mode3` | Digital signatures | Implemented |
| **X25519** | `golang.org/x/crypto/curve25519` | ECDH for hybrid | Implemented |

#### Dilithium3 Key Sizes

| Component | Size |
|-----------|------|
| Public Key | 1952 bytes |
| Private Key | 4016 bytes |
| Signature | 3293 bytes |

### Hybrid PQXDH (Prepared)

The backend has structures for **hybrid X25519 + Kyber-1024 key exchange**:

```go
type HybridKeyPair struct {
    ECPublicKey  []byte // X25519 (32 bytes)
    ECPrivateKey []byte // X25519 (32 bytes)
    PQPublicKey  []byte // Kyber-1024 (1568 bytes)
    PQPrivateKey []byte // Kyber-1024 (3168 bytes)
}
```

### Sealed Sender (Prepared)

Metadata protection module exists at `packages/web/src/crypto/sealed-sender.ts`:

| Feature | Status |
|---------|--------|
| Sender identity hiding | Implemented |
| Timestamp bucketing (15 min) | Implemented |
| Message padding | Implemented |
| Delivery tokens | Implemented |

---

## Key Storage Locations

### Frontend (IndexedDB)

| Store Name | Contents |
|------------|----------|
| `keys` | Identity, exchange, signature key pairs (JWK format) |
| `peerSessions` | Per-peer session keys (derived ECDH secrets) |
| `sealedSender` | Sealed sender key pairs (if enabled) |
| `deliveryTokens` | Cached delivery tokens |

### Backend (PostgreSQL)

| Table | Contents |
|-------|----------|
| `identity_keys` | User public identity keys + fingerprints |
| `signed_prekeys` | Signed exchange keys (EC or hybrid) |
| `one_time_prekeys` | Single-use prekeys for forward secrecy |
| `sealed_sender_keys` | Sealed sender public keys |

---

## Security Comparison: Current vs. Planned

| Property | Current (P-256) | Planned (PQC) |
|----------|-----------------|---------------|
| **Quantum Resistance** | No | Yes (Kyber/Dilithium) |
| **Key Exchange** | P-256 ECDH | Hybrid X25519 + Kyber |
| **Signatures** | P-256 ECDSA | Dilithium3 |
| **Forward Secrecy** | Yes (per-session) | Yes (per-message with ratchet) |
| **Implementation Maturity** | Web Crypto (native) | WASM libraries |

---

## Known Discrepancies

### CLAUDE.md vs. Reality

| CLAUDE.md Claims | Actual Implementation |
|------------------|----------------------|
| "ML-KEM (Kyber1024) for key exchange" | P-256 ECDH |
| "ML-DSA (Dilithium3) for signatures" | P-256 ECDSA |
| "Identity Key: Dilithium3" | Identity Key: P-256 ECDSA |
| "Signed PreKey: Kyber1024" | Signed PreKey: P-256 ECDH |

### Why the Gap?

1. **Web Crypto API Availability**: P-256 is natively supported; PQC requires WASM
2. **Backwards Compatibility**: Backend accepts both; frontend uses classical
3. **Migration Path**: PQC modules exist but aren't wired to main flow

---

## Recommendations for Security Audit

1. **Focus Area**: Review `CryptoService.ts` as the active encryption implementation
2. **Verify**: ECDH shared secret derivation and HKDF parameters
3. **Check**: Nonce generation (12 bytes random for each message)
4. **Validate**: Session key caching and invalidation logic
5. **Note**: PQC code exists but is not in the active encryption path

---

## Files to Review

### Active Encryption (Deployed)
- `packages/web/src/crypto/CryptoService.ts` - Main encryption service
- `packages/web/src/crypto/symmetric.ts` - AES-256-GCM implementation
- `packages/web/src/crypto/utils.ts` - HKDF, hashing utilities
- `packages/server/internal/crypto/keys.go` - Key storage service

### Prepared for Future (Not Active)
- `packages/web/src/crypto/pqc.ts` - PQC primitives (unused)
- `packages/web/src/crypto/sealed-sender.ts` - Metadata protection (prepared)
- `packages/server/internal/crypto/pqc.go` - Backend PQC (accepts but not required)
