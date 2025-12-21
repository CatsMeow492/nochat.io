# Engineering Prompts

This directory contains structured prompts for delegating work to AI agents and engineers. Each prompt includes context, acceptance criteria, and constraints.

## Current Sprint

Based on QA findings and competitive research, our priority is achieving **true zero-trust E2EE** that matches or exceeds Signal's security model.

## Active Prompts

| ID | File | Priority | Status | Blocked By |
|----|------|----------|--------|------------|
| **NEW** | [P0-ecdh-key-sync.md](./P0-ecdh-key-sync.md) | **P0** | **URGENT - START HERE** | - |
| - | [P0-qa-fixes.md](./P0-qa-fixes.md) | P0 | **Complete** | - |
| 001 | [P0-crypto-api-fix.md](./P0-crypto-api-fix.md) | P0 | Superseded | - |
| 002 | [P0-ecdh-session-establishment.md](./P0-ecdh-session-establishment.md) | P0 | Superseded | - |
| 003 | [P1-competitive-e2ee-research.md](./P1-competitive-e2ee-research.md) | P1 | **Complete** | - |
| 004 | [P2-offline-indicator.md](./P2-offline-indicator.md) | P2 | Ready | - |
| 005 | [P2-e2ee-documentation.md](./P2-e2ee-documentation.md) | P2 | Blocked | #001, #002 |
| 006 | [P0-pqxdh-hybrid-implementation.md](./P0-pqxdh-hybrid-implementation.md) | P0 | Blocked | NEW |
| 007 | [P1-sealed-sender.md](./P1-sealed-sender.md) | P1 | Blocked | NEW |
| 008 | [P2-key-transparency.md](./P2-key-transparency.md) | P2 | Blocked | NEW, #006 |

## Research Outputs

| File | Status | Key Findings |
|------|--------|--------------|
| [e2ee-competitive-analysis.md](./research/e2ee-competitive-analysis.md) | Complete | PQXDH required, prekey exhaustion vulnerability, Sealed Sender gap |

## Priority Definitions

- **P0**: Ship blocker. Must fix before release. Security critical.
- **P1**: Important. Should complete this sprint. Competitive parity.
- **P2**: Nice to have. Backlog candidate. Future differentiation.

## Execution Order

```
Phase 0: Critical ECDH Key Sync Fix (CURRENT)
└── P0-ecdh-key-sync.md: P2P decryption fails  ← START HERE
    ├── Fix asymmetric session key derivation
    ├── Ensure both parties derive identical keys
    └── Enable true P2P E2EE for DMs

Phase 1: Foundation (COMPLETE)
├── P0-qa-fixes.md: All QA blocking issues ✓
│   ├── Fix in-chat call buttons ✓
│   ├── Fix crypto API 500 errors ✓
│   └── Fix ECDH session establishment ✓
├── P0-001: Crypto API Fix (superseded) ✓
└── P0-002: ECDH Session Establishment (superseded) ✓

Phase 2: Quantum Readiness
└── P0-006: PQXDH Hybrid Implementation (blocked by NEW)

Phase 3: Metadata Protection
└── P1-007: Sealed Sender (blocked by NEW)

Phase 4: Trust Infrastructure
└── P2-008: Key Transparency (AKD)

Parallel (anytime):
├── P2-004: Offline Indicator (UX)
└── P2-005: Documentation (after crypto stable)
```

## Gap Analysis (from Research)

| Capability | Industry Standard | NoChat Status | Priority |
|------------|-------------------|---------------|----------|
| Key Upload API | Working endpoints | **Fixed** ✓ | P0-001 |
| ECDH Sessions | Pairwise sessions | **Establishing but keys asymmetric** | P0-NEW |
| P2P Decryption | Symmetric session keys | **BROKEN - keys don't match** | P0-NEW |
| PQ Key Exchange | PQXDH (Kyber-1024) | ECDH only | P0-006 |
| Prekey Rate Limiting | Strict server-side | None | P0-001 |
| Metadata Protection | Sealed Sender | None | P1-007 |
| Identity Verification | AKD / Transparency | TOFU only | P2-008 |

## Prompt Structure

Each prompt follows this format:

```markdown
# Title
- Agent Type
- Complexity
- Branch Name
- Dependencies
- Research Basis (if applicable)

## Objective
## Context
## Technical Specification (for implementation prompts)
## Relevant Files
## Implementation Checklist
## Acceptance Criteria
## Constraints (Do NOT)
## Related
```

## Usage

### Assigning Work

1. Select a prompt that's not blocked
2. Assign to appropriate agent or engineer
3. Create branch using specified naming convention
4. Complete all acceptance criteria
5. Update status in this README

### Running Prompts with Claude

```
Read the prompt at /prompts/P0-crypto-api-fix.md and implement it.
```

### Parallel Execution

Prompts without dependencies can run in parallel:
- P0-001 and P2-004 can run simultaneously
- P0-006 requires P0-001 and P0-002 complete first

## QA Prompts

| Prompt | Scope | Status |
|--------|-------|--------|
| [QA-comprehensive-e2ee.md](./QA-comprehensive-e2ee.md) | E2EE stack verification | Complete - bugs found |
| [QA-core-features.md](./QA-core-features.md) | All core features (messaging, calls) | **Complete - bugs found** |

### QA Results Summary (2024-12)

**Passing:**
- Anonymous onboarding
- Start New Chat (creates conversations)
- Send/receive encrypted messages
- Homepage Start/Join Meeting (video calls work)

**Failing (addressed in P0-qa-fixes.md):**
- In-chat call buttons non-functional
- Crypto API returns 500 errors
- ECDH sessions not establishing (falls back to legacy mode)

## QA Reference

These prompts were generated from:
- QA report dated 2024-12 (`.playwright-mcp/` for screenshots)
- Competitive E2EE research (`./research/e2ee-competitive-analysis.md`)

## Security Notes

Several prompts address critical security gaps:

1. **Prekey Exhaustion** (P0-001): WhatsApp-style vulnerability where attackers drain one-time prekeys
2. **HNDL Attacks** (P0-006): Harvest-Now-Decrypt-Later requires post-quantum cryptography
3. **Metadata Leakage** (P1-007): Server currently sees full social graph
4. **TOFU Weakness** (P2-008): Manual verification doesn't work at scale

## Changelog

- **2024-12**: Initial prompts from QA report
- **2024-12**: Added P0-006, P1-007, P2-008 from competitive research
- **2024-12**: Updated P0-001 with rate limiting requirements
