# P2-008: Auditable Key Directory (Key Transparency)

| Field | Value |
|-------|-------|
| **Agent Type** | Feature Engineer (Senior) |
| **Complexity** | High |
| **Branch Name** | `feat/key-transparency` |
| **Blocked By** | P0-001, P0-002, P0-006 |
| **Created** | 2024-12 |
| **Research Basis** | [E2EE Competitive Analysis](./research/e2ee-competitive-analysis.md) |

---

## Objective

Implement an Auditable Key Directory (AKD) using Merkle trees to provide automated, cryptographic verification that the server is serving consistent keys to all users—eliminating the need for manual Safety Number verification.

---

## Context

### The Problem with TOFU

From our competitive analysis:

> "Signal and WhatsApp traditionally rely on TOFU. The app trusts the first key it sees. Users can manually verify 'Safety Numbers'... Research shows that the vast majority of users never perform this verification, leaving them vulnerable to transparent MITM attacks by the service provider."

Current state:
- We use Trust On First Use (TOFU)
- Users can theoretically verify key fingerprints manually
- In practice, almost no one does
- Server could serve different keys to different users (MITM)

### WhatsApp's Solution

> "WhatsApp deployed the Auditable Key Directory (AKD). This is a transparency log based on Merkle Trees... Clients can automatically verify that the key they are seeing is the same key visible to the entire world."

Benefits:
- **Automatic verification**: No user action required
- **Detectable attacks**: Server cannot serve "split view" keys
- **Append-only**: Keys can be added/rotated, but history is immutable
- **Third-party auditable**: Anyone can verify the tree's consistency

---

## Technical Specification

### Merkle Tree Structure

```
                    [Root Hash]
                   /          \
            [Hash A]          [Hash B]
           /       \         /       \
      [Hash 1]  [Hash 2] [Hash 3]  [Hash 4]
         |         |        |         |
      Alice's   Bob's   Carol's   Dave's
       Key       Key      Key       Key
```

Each leaf contains:
```typescript
{
  userId: string,
  identityKey: string,
  signedPrekeyFingerprint: string,
  version: number,
  timestamp: number
}
```

### Key Operations

**Key Registration/Rotation:**
1. User uploads new key
2. Server appends entry to Merkle tree
3. Server computes new root hash
4. Server signs the root hash with its transparency key
5. Server returns inclusion proof to user

**Key Lookup:**
1. Client requests Bob's key
2. Server returns:
   - Bob's key data
   - Inclusion proof (path from leaf to root)
   - Signed root hash
3. Client verifies:
   - Proof is mathematically valid
   - Root hash matches signed value
   - Root hash matches previously seen root (consistency)

**Consistency Check:**
1. Client periodically fetches latest signed root
2. Client requests consistency proof between old root and new root
3. If proof fails → alert user (server is misbehaving)

### Proof Types

**Inclusion Proof:**
Proves a specific key is in the tree.
```typescript
{
  leaf: KeyEntry,
  siblings: Hash[],  // Path from leaf to root
  rootHash: string,
  rootSignature: string
}
```

**Consistency Proof:**
Proves new tree is append-only extension of old tree.
```typescript
{
  oldRoot: string,
  newRoot: string,
  proof: Hash[],
  signature: string
}
```

### Monitoring and Auditing

**Client Monitoring:**
- Store last-seen root hash locally
- On each lookup, verify consistency with stored root
- Alert if consistency check fails

**Third-Party Auditors:**
- Publish root hashes to public log (like Certificate Transparency)
- External auditors can verify tree consistency
- Detect if server shows different trees to different users

---

## Relevant Files

### Backend
- New: `packages/server/internal/transparency/` domain
  - `merkle.go` - Merkle tree implementation
  - `proofs.go` - Proof generation
  - `audit.go` - Audit log endpoints
- `packages/server/internal/crypto/keys.go` - Integrate with key storage
- `packages/server/cmd/server/main.go` - New API endpoints

### Frontend
- New: `packages/web/src/crypto/transparency.ts`
- `packages/web/src/crypto/CryptoService.ts` - Verify proofs on key fetch
- `packages/web/src/hooks/use-crypto.ts` - Store/check root hashes

### Database
- New `merkle_tree` table (nodes)
- New `transparency_log` table (signed roots)
- New `audit_checkpoints` table (published roots)

---

## API Endpoints

```
POST /api/crypto/keys/identity
  - Now returns inclusion proof

GET /api/crypto/bundles/{user_id}
  - Now returns inclusion proof for identity key

GET /api/transparency/root
  - Returns current signed root hash

GET /api/transparency/consistency?from={old_root}&to={new_root}
  - Returns consistency proof

GET /api/transparency/inclusion?user_id={id}&root={hash}
  - Returns inclusion proof for specific root

GET /api/transparency/audit-log
  - Public endpoint: returns recent signed roots for auditors
```

---

## Implementation Checklist

### Phase 1: Merkle Tree Core
- [ ] Implement sparse Merkle tree data structure
- [ ] Implement leaf hashing: `H(userId || keyData || version)`
- [ ] Implement internal node hashing: `H(left || right)`
- [ ] Store tree nodes in PostgreSQL
- [ ] Implement tree update (insert/update leaf)

### Phase 2: Proof Generation
- [ ] Implement inclusion proof generation
- [ ] Implement consistency proof generation
- [ ] Implement proof verification (for testing)
- [ ] Sign root hashes with server transparency key

### Phase 3: API Integration
- [ ] Update key upload to return inclusion proof
- [ ] Update bundle fetch to include proof
- [ ] Add `/transparency/*` endpoints
- [ ] Rate limit audit endpoints (public)

### Phase 4: Client Verification
- [ ] Store last-seen root hash in IndexedDB
- [ ] Verify inclusion proof on every key fetch
- [ ] Verify consistency on root hash changes
- [ ] Alert UI on verification failure

### Phase 5: Public Auditability
- [ ] Publish root hashes to public endpoint
- [ ] Document audit process for third parties
- [ ] Consider integration with external CT-style logs

---

## Acceptance Criteria

- [ ] All key fetches include cryptographic inclusion proof
- [ ] Client automatically verifies proofs (no user action)
- [ ] Client detects and alerts on invalid proofs
- [ ] Client detects and alerts on consistency failures
- [ ] Audit log endpoint is publicly accessible
- [ ] Tree operations are O(log n) complexity
- [ ] Root hash signed by server transparency key

---

## Signing Key Management

**Initial Implementation: Environment Variable**

```bash
# Generate Ed25519 key pair
openssl genpkey -algorithm Ed25519 -out transparency_key.pem
openssl pkey -in transparency_key.pem -text

# Set on Fly.io
fly secrets set TRANSPARENCY_SIGNING_KEY="$(base64 < transparency_key.pem)"
```

```go
// Load signing key from environment
func NewTransparencySigner() (*Signer, error) {
    keyPEM := os.Getenv("TRANSPARENCY_SIGNING_KEY")
    keyBytes, _ := base64.StdEncoding.DecodeString(keyPEM)
    privateKey, _ := x509.ParsePKCS8PrivateKey(keyBytes)
    return &Signer{key: privateKey.(ed25519.PrivateKey)}, nil
}
```

**Rationale:**
- Fly.io compatible (`fly secrets set`)
- Separation from data (not in DB)
- Clear upgrade path to HSM/KMS later
- Simple operational model for MVP

**Future: HSM/KMS Migration**
```go
// Same interface, different backend
type Signer interface {
    Sign(data []byte) ([]byte, error)
    PublicKey() []byte
}

// Swap implementation when ready
signer := NewKMSSigner(awsKMSClient, keyARN)  // AWS
signer := NewVaultSigner(vaultClient, keyPath) // Hashicorp
```

---

## Constraints

**Do NOT:**
- Allow key deletion (append-only; mark as revoked instead)
- Skip proof verification on client (defeats purpose)
- Use sequential IDs in tree (use hash-based addressing)
- Store transparency private key in application database
- Log or expose signing key material

**Security Requirements:**
- Root signing key stored in environment variable (upgrade to HSM later)
- Proofs MUST be verified before trusting any key
- Consistency MUST be checked against locally stored root
- Alert MUST be shown if any verification fails
- Public key published for third-party auditors

---

## Performance Considerations

| Operation | Complexity | Typical Latency |
|-----------|------------|-----------------|
| Tree Update | O(log n) | ~5ms |
| Inclusion Proof | O(log n) | ~2ms |
| Consistency Proof | O(log n) | ~2ms |
| Proof Verification | O(log n) | ~1ms (client) |

For 1M users: tree depth ~20, proof size ~640 bytes

Acceptable overhead for the security benefit.

---

## Failure Modes

**Proof Verification Failure:**
- Show prominent warning to user
- Do NOT proceed with message send
- Offer to report issue
- Log for investigation

**Consistency Failure:**
- Critical security alert
- Potentially indicates server compromise or MITM
- Block all communication until resolved
- Notify security team

**Network Failure:**
- Cache last valid proof
- Allow communication with cached keys (time-limited)
- Retry verification when online

---

## References

- [WhatsApp Key Transparency](https://engineering.fb.com/2023/04/13/security/whatsapp-key-transparency/)
- [Google Key Transparency](https://github.com/google/keytransparency)
- [CONIKS Paper](https://eprint.iacr.org/2014/1004.pdf)
- [Certificate Transparency RFC 6962](https://datatracker.ietf.org/doc/html/rfc6962)

---

## Related

- Depends on: [P0-001](./P0-crypto-api-fix.md), [P0-002](./P0-ecdh-session-establishment.md), [P0-006](./P0-pqxdh-hybrid-implementation.md)
- Research: [E2EE Competitive Analysis](./research/e2ee-competitive-analysis.md)
- Replaces: Manual Safety Number verification
