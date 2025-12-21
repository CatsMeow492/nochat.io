# P0-006: Hybrid PQXDH Implementation

| Field | Value |
|-------|-------|
| **Agent Type** | Feature Engineer (Senior) |
| **Complexity** | High |
| **Branch Name** | `feat/pqxdh-hybrid` |
| **Blocked By** | P0-001, P0-002 |
| **Created** | 2024-12 |
| **Research Basis** | [E2EE Competitive Analysis](./research/e2ee-competitive-analysis.md) |

---

## Objective

Implement hybrid Post-Quantum Extended Diffie-Hellman (PQXDH) key exchange, combining classical X25519 ECDH with ML-KEM (Kyber-1024) to protect against Harvest-Now-Decrypt-Later (HNDL) quantum attacks.

---

## Context

### Why This Matters

From our competitive analysis:

> "Signal has moved decisively to mitigate the HNDL threat by replacing X3DH with PQXDH... This represents a 'hybrid' approach, which is currently the gold standard for PQC migration."

Our current implementation uses P-256 ECDH only. This means:
- An adversary recording our traffic today could decrypt it once quantum computers mature
- We're behind Signal (shipped PQXDH in 2023)
- Our marketing claims "post-quantum" but we don't deliver it

### The HNDL Threat Model

```
Today: Attacker intercepts encrypted traffic → stores ciphertext
2030+: Quantum computer runs Shor's algorithm → breaks ECDH
Result: All historical messages decrypted
```

Hybrid PQXDH ensures that even if quantum computers break ECDH, the Kyber component remains secure (based on lattice problems, not discrete log).

---

## Technical Specification

### Prekey Bundle (Updated)

Current bundle:
```typescript
{
  identityKey: ECDSAPublicKey,      // P-256
  signedPrekey: ECDHPublicKey,      // P-256
  signedPrekeySignature: Signature,
  oneTimePrekey?: ECDHPublicKey     // P-256
}
```

PQXDH bundle:
```typescript
{
  // Classical (retain for hybrid)
  identityKey: ECDSAPublicKey,           // P-256 or Ed25519
  signedPrekey: ECDHPublicKey,           // X25519
  signedPrekeySignature: Signature,
  oneTimePrekey?: ECDHPublicKey,         // X25519

  // Post-Quantum (new)
  pqSignedPrekey: KyberPublicKey,        // Kyber-1024 (1568 bytes)
  pqSignedPrekeySignature: Signature,    // Sign with identity key
  pqOneTimePrekey?: KyberPublicKey       // Kyber-1024 (optional)
}
```

### Key Exchange Flow

**Alice initiating session with Bob:**

1. Alice fetches Bob's PQXDH prekey bundle
2. Alice verifies signatures on signed prekeys (both EC and PQ)
3. Alice generates ephemeral X25519 key pair
4. Alice performs classical DH operations:
   - DH1 = ECDH(Alice_identity, Bob_signedPrekey)
   - DH2 = ECDH(Alice_ephemeral, Bob_identity)
   - DH3 = ECDH(Alice_ephemeral, Bob_signedPrekey)
   - DH4 = ECDH(Alice_ephemeral, Bob_oneTimePrekey) [if available]
5. Alice performs KEM encapsulation:
   - (ss_pq, ct_pq) = Kyber.Encapsulate(Bob_pqSignedPrekey)
   - (ss_pq2, ct_pq2) = Kyber.Encapsulate(Bob_pqOneTimePrekey) [if available]
6. Alice derives shared secret:
   ```
   shared_secret = HKDF(
     DH1 || DH2 || DH3 || DH4 || ss_pq || ss_pq2,
     salt="PQXDH",
     info="nochat-pqxdh-v1"
   )
   ```
7. Alice sends initial message with:
   - Ephemeral EC public key
   - Kyber ciphertexts (ct_pq, ct_pq2)
   - Encrypted payload

**Bob receiving:**

1. Bob decapsulates Kyber ciphertexts to recover ss_pq, ss_pq2
2. Bob performs same ECDH operations
3. Bob derives identical shared_secret
4. Bob deletes one-time prekeys (both EC and PQ)

### Kyber-1024 Parameters

| Parameter | Value |
|-----------|-------|
| Public Key Size | 1568 bytes |
| Ciphertext Size | 1568 bytes |
| Shared Secret Size | 32 bytes |
| Security Level | NIST Level 5 (~AES-256) |

---

## Relevant Files

### Backend
- `packages/server/internal/crypto/pqc.go` - Add Kyber operations
- `packages/server/internal/crypto/keys.go` - Update key storage
- `packages/server/cmd/server/main.go` - Update bundle endpoints

### Frontend
- `packages/web/src/crypto/pqc.ts` - Kyber WASM bindings
- `packages/web/src/crypto/x3dh.ts` - Upgrade to PQXDH
- `packages/web/src/crypto/CryptoService.ts` - Key management
- `packages/web/src/crypto/types.ts` - Update type definitions

### Database
- New migration for PQ key columns in `signed_prekeys` and `one_time_prekeys`

---

## Implementation Checklist

### Phase 1: Backend Kyber Support
- [ ] Add `cloudflare/circl` or equivalent Go Kyber library
- [ ] Implement `KyberKeyPair()` generation
- [ ] Implement `KyberEncapsulate(publicKey)` → (ciphertext, sharedSecret)
- [ ] Implement `KyberDecapsulate(privateKey, ciphertext)` → sharedSecret
- [ ] Add database columns for PQ keys
- [ ] Update `/api/crypto/keys/prekey` to accept PQ keys
- [ ] Update `/api/crypto/bundles/{user_id}` to return PQ keys

### Phase 2: Frontend Kyber Support
- [ ] Integrate Kyber WASM (e.g., pqcrypto-wasm or crystals-kyber)
- [ ] Generate PQ prekeys alongside EC prekeys
- [ ] Upload PQ prekeys to server
- [ ] Store PQ private keys in IndexedDB

### Phase 3: PQXDH Protocol
- [ ] Update `x3dh.ts` to perform hybrid key exchange
- [ ] Combine EC DH outputs with KEM shared secrets
- [ ] Update HKDF derivation to include PQ components
- [ ] Handle backwards compatibility (peers without PQ keys)

### Phase 4: Testing
- [ ] Unit tests for Kyber operations
- [ ] Integration test: full PQXDH handshake
- [ ] Backwards compatibility: new client → old client (falls back to EC only)
- [ ] Performance benchmarks (Kyber is ~10x slower than X25519)

---

## Acceptance Criteria

- [ ] Prekey bundles include Kyber-1024 public keys
- [ ] Initial key exchange uses hybrid ECDH + KEM
- [ ] Shared secret derivation includes both EC and PQ components
- [ ] Sessions established with PQXDH show indicator in UI (e.g., "Quantum-resistant")
- [ ] Backwards compatible with EC-only peers (graceful fallback)
- [ ] Key sizes validated (Kyber pubkey = 1568 bytes)
- [ ] Performance: handshake completes in <500ms on mobile

---

## Constraints

**Do NOT:**
- Remove classical ECDH (hybrid requires both)
- Use Kyber-512 (insufficient security margin)
- Skip signature verification on PQ prekeys
- Store Kyber private keys on server
- Break existing sessions (migration must be seamless)

**Security Requirements:**
- PQ prekeys MUST be signed by identity key
- One-time PQ prekeys MUST be deleted after use
- Fallback to EC-only MUST be logged/flagged (not silent)

---

## Performance Considerations

Kyber-1024 is computationally heavier than X25519:

| Operation | X25519 | Kyber-1024 |
|-----------|--------|------------|
| Key Gen | ~0.1ms | ~1ms |
| Encaps/DH | ~0.1ms | ~1.5ms |
| Decaps | N/A | ~1.5ms |

Total PQXDH overhead: ~5-10ms per handshake (acceptable)

Bundle size increase: ~3KB per bundle (acceptable for initial fetch)

---

## Library Selection

### Frontend: @noble/post-quantum

```bash
npm install @noble/post-quantum
```

**Rationale:**
- Pure JavaScript, no WASM build complexity
- Maintained by @paulmillr (author of @noble/curves, industry standard)
- 5ms performance is sufficient for handshakes (we're not doing bulk encryption)
- Works in all environments (browser, Node, React Native)
- Audited, actively maintained

**Usage:**
```typescript
import { ml_kem1024 } from '@noble/post-quantum';

// Key generation
const { publicKey, secretKey } = ml_kem1024.keygen();

// Encapsulation (Alice)
const { cipherText, sharedSecret } = ml_kem1024.encapsulate(bobPublicKey);

// Decapsulation (Bob)
const sharedSecret = ml_kem1024.decapsulate(cipherText, bobSecretKey);
```

### Backend: cloudflare/circl

Go library with production-grade ML-KEM implementation.

```go
import "github.com/cloudflare/circl/kem/mlkem/mlkem1024"
```

---

## References

- [Signal PQXDH Specification](https://signal.org/docs/specifications/pqxdh/)
- [NIST ML-KEM (Kyber) Standard](https://csrc.nist.gov/pubs/fips/203/final)
- [@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum)
- [cloudflare/circl Go Library](https://github.com/cloudflare/circl)

---

## Related

- Depends on: [P0-001](./P0-crypto-api-fix.md), [P0-002](./P0-ecdh-session-establishment.md)
- Research: [E2EE Competitive Analysis](./research/e2ee-competitive-analysis.md)
- Future: SPQR (Sparse Post-Quantum Ratchet) for ongoing sessions
