# P2-005: E2EE Documentation & Security Audit Prep

| Field | Value |
|-------|-------|
| **Agent Type** | Technical Writer / Feature Engineer |
| **Complexity** | Medium |
| **Output Format** | Documentation + Code Comments |
| **Blocked By** | P0-001, P0-002 |
| **Created** | 2024-12 |

---

## Objective

Document the E2EE implementation accurately for external security auditors and ensure CLAUDE.md reflects the actual current-state architecture.

---

## Context

Our CLAUDE.md describes a PQC (Kyber/Dilithium) implementation, but QA testing shows the current frontend uses **P-256 ECDSA/ECDH**. This discrepancy could:

1. Confuse engineers working on the codebase
2. Mislead security auditors
3. Create legal/marketing issues if we claim PQC but don't have it

We need accurate documentation of:
- What's actually deployed (current state)
- What's planned (future roadmap)
- Clear threat model for security review

---

## Tasks

### Task 1: Audit Current Crypto Implementation

**Goal:** Create an accurate inventory of cryptographic algorithms in use.

**Checklist:**
- [ ] Document frontend crypto algorithms (from `packages/web/src/crypto/`)
- [ ] Document backend crypto algorithms (from `packages/server/internal/crypto/`)
- [ ] Identify all key types and their purposes
- [ ] Map key storage locations (IndexedDB, PostgreSQL)
- [ ] Document the actual message encryption flow (step by step)
- [ ] Note any discrepancies between frontend and backend

**Output:** Create `/docs/crypto-inventory.md`

```markdown
# Cryptographic Inventory

## Current Implementation (as of YYYY-MM)

### Asymmetric Algorithms
| Algorithm | Purpose | Location |
|-----------|---------|----------|
| P-256 ECDSA | Identity signatures | Frontend |
| P-256 ECDH | Key exchange | Frontend |
| ... | ... | ... |

### Symmetric Algorithms
| Algorithm | Purpose | Location |
|-----------|---------|----------|
| AES-256-GCM | Message encryption | Frontend |
| ... | ... | ... |

### Key Types
| Key | Algorithm | Lifespan | Storage |
|-----|-----------|----------|---------|
| Identity Key | ECDSA P-256 | Long-term | IndexedDB (private), PostgreSQL (public) |
| ... | ... | ... | ... |

### Encryption Flow
1. [Step by step current flow]
```

---

### Task 2: Update CLAUDE.md

**Goal:** Ensure CLAUDE.md accurately reflects current implementation.

**Changes Required:**
- [ ] Update "Zero-Trust Security Layer" section
- [ ] Change PQC references to "Planned" status where not implemented
- [ ] Correct algorithm names to match actual implementation
- [ ] Update key types table
- [ ] Add "Implementation Status" indicators

**Example Update:**

```markdown
### Cryptographic Primitives

**Currently Implemented:**
- **P-256 ECDH**: Key exchange for session establishment
- **P-256 ECDSA**: Digital signatures for identity
- **AES-256-GCM**: Symmetric message encryption
- **HKDF-SHA256**: Key derivation

**Planned (Post-Quantum):**
- **ML-KEM (Kyber1024)**: Key encapsulation (not yet implemented)
- **ML-DSA (Dilithium3)**: Digital signatures (not yet implemented)
```

---

### Task 3: Create SECURITY.md

**Goal:** Provide security researchers with threat model and responsible disclosure info.

**Location:** `/SECURITY.md` (root of repository)

**Template:**

```markdown
# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| main | Yes |
| ... | ... |

## Threat Model

### What We Protect Against
- Server compromise (zero-trust: server cannot read messages)
- Man-in-the-middle attacks (E2EE with identity verification)
- Message tampering (AEAD encryption)
- [Add more]

### What We Do NOT Protect Against
- Client/device compromise (if attacker has device access)
- Metadata (server sees who talks to whom, when)
- [Add more]

### Trust Assumptions
- Client device is not compromised
- Browser/WebCrypto implementation is correct
- [Add more]

## Cryptographic Details

See [/docs/crypto-inventory.md](./docs/crypto-inventory.md) for full details.

## Reporting a Vulnerability

[Instructions for responsible disclosure]

## Security Audits

[List any completed audits or planned audits]
```

---

### Task 4: Add Code Comments

**Goal:** Add explanatory comments to crypto modules for auditor clarity.

**Files to Document:**
- `packages/web/src/crypto/CryptoService.ts`
- `packages/web/src/crypto/symmetric.ts`
- `packages/web/src/crypto/pqc.ts`
- `packages/web/src/crypto/x3dh.ts`
- `packages/server/internal/crypto/keys.go`

**Comment Style:**

```typescript
/**
 * Encrypts a message using AES-256-GCM.
 *
 * Security notes:
 * - Nonce is randomly generated (12 bytes) for each message
 * - Key is derived from session key via HKDF
 * - Ciphertext includes authentication tag (16 bytes)
 *
 * @param plaintext - UTF-8 encoded message content
 * @param key - 256-bit session key
 * @returns Base64-encoded ciphertext with prepended nonce
 */
```

---

## Acceptance Criteria

- [ ] `/docs/crypto-inventory.md` created with accurate algorithm inventory
- [ ] CLAUDE.md updated with correct current-state information
- [ ] PQC clearly marked as "Planned" where not implemented
- [ ] `/SECURITY.md` created with threat model
- [ ] Code comments added to all crypto modules
- [ ] No claims of PQC if not actually implemented
- [ ] Documentation reviewed for accuracy by crypto-knowledgeable engineer

---

## Constraints

**Do NOT:**
- Claim security properties that aren't implemented
- Remove documentation of planned features (just mark as planned)
- Add implementation code (this is documentation only)
- Expose any secrets or private key material in examples
- Make security claims without verification

---

## Why This Matters

1. **Security Audits:** Auditors need accurate documentation to assess the system
2. **Legal Compliance:** Marketing claims must match implementation
3. **Engineer Onboarding:** New engineers need to understand actual vs. planned
4. **User Trust:** Users deserve accurate information about their security

---

## Related

- Depends on: [P0-001](./P0-crypto-api-fix.md), [P0-002](./P0-ecdh-session-establishment.md)
- Informed by: [P1-003: Competitive E2EE Research](./P1-competitive-e2ee-research.md)
