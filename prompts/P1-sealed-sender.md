# P1-007: Sealed Sender Metadata Protection

| Field | Value |
|-------|-------|
| **Agent Type** | Feature Engineer (Senior) |
| **Complexity** | High |
| **Branch Name** | `feat/sealed-sender` |
| **Blocked By** | P0-001, P0-002 |
| **Created** | 2024-12 |
| **Research Basis** | [E2EE Competitive Analysis](./research/e2ee-competitive-analysis.md) |

---

## Objective

Implement Sealed Sender to hide message sender identity from the server, preventing metadata collection on the social graph (who talks to whom).

---

## Context

### The Problem

From our competitive analysis:

> "In standard TLS-wrapped messaging, the server knows who is sending a message to whom. This metadata is often more sensitive than the content itself, revealing social graphs and patterns of life."

Currently, our server sees:
- Sender user ID
- Recipient user ID
- Timestamp
- Message size
- Conversation ID

Even with E2EE, this metadata reveals:
- Who Alice talks to
- How frequently
- At what times
- Relationship patterns

### Signal's Solution

> "The envelope contains the destination (so the server knows where to route it), but the sender's identity is encrypted inside the envelope alongside the message. The server processes the message without knowing who sent it."

---

## Technical Specification

### Architecture Overview

```
Without Sealed Sender:
┌─────────┐    ┌─────────┐    ┌─────────┐
│  Alice  │───▶│ Server  │───▶│   Bob   │
└─────────┘    └─────────┘    └─────────┘
               Sees: Alice→Bob

With Sealed Sender:
┌─────────┐    ┌─────────┐    ┌─────────┐
│  Alice  │───▶│ Server  │───▶│   Bob   │
└─────────┘    └─────────┘    └─────────┘
               Sees: ???→Bob
               Bob decrypts to learn: Alice
```

### Sealed Sender Message Format

**Outer Envelope (server sees):**
```typescript
{
  recipientId: string,           // Server needs this for routing
  deliveryToken: string,         // Proves Alice is allowed to message Bob
  sealedContent: Uint8Array,     // Encrypted blob
  timestamp: number              // For ordering (can be bucketed)
}
```

**Inner Envelope (Bob decrypts):**
```typescript
{
  senderId: string,              // Alice's identity (hidden from server)
  senderIdentityKey: string,     // For verification
  messageContent: Uint8Array,    // The actual encrypted message
  timestamp: number              // True timestamp
}
```

### Delivery Token System

To prevent anonymous spam/abuse, Bob must authorize who can send him Sealed Sender messages.

**Token Generation (Bob):**
```typescript
// Bob generates a delivery token for Alice
const deliveryToken = HMAC-SHA256(
  Bob_deliverySecret,
  Alice_identityKeyFingerprint
);
```

**Token Distribution: Include in Prekey Bundle**

When Alice fetches Bob's prekey bundle, include the delivery token in the response:

```typescript
// GET /api/crypto/bundles/{bob_id}
// Server computes token using Alice's identity (from auth)
{
  identityKey: "...",
  signedPrekey: "...",
  oneTimePrekey: "...",
  // Sealed Sender additions
  sealedSenderPublicKey: "...",
  deliveryToken: HMAC(Bob_secret, Alice_fingerprint)  // Computed server-side
}
```

**Rationale for bundle inclusion:**
- Timing aligns: Alice fetches bundle to start conversation, needs token for same purpose
- No extra API calls: One round trip instead of two
- Matches Signal's pattern: Delivery capability bundled with profile/prekey data
- Avoids chicken-and-egg: Deriving from session key requires session first

**Server Validation:**
- Server validates token without learning Alice's identity
- Uses Bob's public delivery verification key
- Rejects messages with invalid tokens (prevents spam from strangers)

### Encryption Layers

**Layer 1: Sealed Sender Encryption**
```typescript
// Alice encrypts the inner envelope to Bob
const sealedContent = SealedSenderEncrypt(
  innerEnvelope,
  Bob_sealedSenderPublicKey,  // Separate from identity key
  Alice_ephemeralPrivateKey
);
```

**Layer 2: Message Content Encryption**
```typescript
// Standard Double Ratchet encryption
const messageContent = DoubleRatchetEncrypt(
  plaintext,
  sessionKey
);
```

### Traffic Analysis Padding

> "Signal mandates that all ciphertext be padded to the nearest multiple of 160 bytes."

All Sealed Sender messages must be padded to fixed block sizes:
- Small messages: pad to 256 bytes
- Medium messages: pad to 1KB
- Large messages: pad to 4KB increments

This prevents fingerprinting based on message length.

---

## Relevant Files

### Backend
- `packages/server/internal/messaging/messaging.go` - Message handling
- `packages/server/cmd/server/main.go` - API endpoints
- New: `packages/server/internal/sealedsender/` domain

### Frontend
- `packages/web/src/crypto/CryptoService.ts` - Add sealed sender encryption
- `packages/web/src/hooks/use-messages.ts` - Update send flow
- New: `packages/web/src/crypto/sealed-sender.ts`

### Database
- Add `delivery_tokens` table
- Add `sealed_sender_keys` to users

---

## Implementation Checklist

### Phase 1: Key Infrastructure
- [ ] Add sealed sender key pair generation (separate from identity)
- [ ] Add delivery secret generation per user
- [ ] Store sealed sender public key in user profile
- [ ] API to fetch sealed sender key with prekey bundle

### Phase 2: Delivery Tokens
- [ ] Implement token generation: `HMAC(secret, peer_fingerprint)`
- [ ] Include delivery token in profile/bundle responses
- [ ] Server-side token validation endpoint
- [ ] Rate limiting on invalid token attempts

### Phase 3: Sealed Sender Encryption
- [ ] Implement `SealedSenderEncrypt(innerEnvelope, recipientKey)`
- [ ] Implement `SealedSenderDecrypt(sealedContent, privateKey)`
- [ ] Wrap existing message encryption in sealed sender layer
- [ ] Update message send flow to use sealed format

### Phase 4: Server Changes
- [ ] Update message ingestion to not log sender
- [ ] Validate delivery token before accepting message
- [ ] Route based on recipientId only
- [ ] Ensure no sender metadata in logs/database

### Phase 5: Padding
- [ ] Implement block padding (256B / 1KB / 4KB)
- [ ] Apply padding before sealed sender encryption
- [ ] Strip padding after decryption on recipient

### Phase 6: UI Updates
- [ ] Indicator for sealed sender status
- [ ] Settings to enable/disable sealed sender (default: **enabled**)
- [ ] Warning when messaging user without sealed sender support

### Default State

**Sealed Sender: Enabled by default for all new users**

```typescript
// User creation defaults
const defaultUserSettings = {
  sealedSenderEnabled: true,  // Privacy by default
  // ...
};
```

**Rationale:**
- Secure by default: Privacy features should be opt-out, not opt-in
- Brand alignment: Zero-trust positioning requires default protection
- Adoption: Most users never open settings; opt-in means 5% adoption
- Signal's pattern: Sealed sender on by default for contacts

---

## Fallback Behavior

**When recipient has no Sealed Sender key: Fall back to regular messages**

```typescript
async function sendMessage(recipientId: string, content: string) {
  const bundle = await fetchPrekeyBundle(recipientId);

  if (bundle.sealedSenderPublicKey && bundle.deliveryToken) {
    // Full sealed sender
    return sendSealedMessage(recipientId, content, bundle);
  } else {
    // Graceful fallback to non-sealed
    console.log('[SealedSender] Recipient does not support sealed sender, falling back');
    return sendRegularMessage(recipientId, content, bundle);
  }
}
```

**Rationale:**
- Gradual rollout: Not all users will have Sealed Sender immediately
- Signal's pattern: Graceful fallback to non-sealed for older clients
- Avoids user confusion: No decision points about security they don't understand

**UI Indicators:**
- Sealed message: 🔒 with "Private" badge
- Non-sealed E2EE message: 🔐 with "Encrypted" badge (no metadata protection)
- Track fallback rate in analytics to monitor adoption

---

## Acceptance Criteria

- [ ] Server cannot determine sender identity from message envelope
- [ ] Server logs contain no sender information for sealed messages
- [ ] Delivery tokens prevent unauthorized sealed sender messages
- [ ] Messages are padded to fixed block sizes
- [ ] Backwards compatible (non-sealed messages still work)
- [ ] Bob can decode sender identity from sealed content
- [ ] Invalid tokens rejected with rate limiting
- [ ] Graceful fallback when recipient lacks sealed sender support
- [ ] UI distinguishes sealed vs non-sealed messages

---

## Constraints

**Do NOT:**
- Store sender ID in server database for sealed messages
- Log sender identity anywhere on server
- Skip delivery token validation (enables spam)
- Use predictable padding (must be random fill)
- Break existing non-sealed message flow

**Privacy Requirements:**
- Server MUST NOT be able to correlate messages to senders
- Delivery tokens MUST NOT be reversible to sender identity
- Padding MUST NOT leak message length patterns

---

## Abuse Prevention

Without sender identity, abuse is harder to prevent. Mitigations:

1. **Delivery Tokens**: Only authorized contacts can send
2. **Rate Limiting**: Per-recipient rate limits (server can still count)
3. **Reporting**: Bob can reveal sender when reporting abuse
4. **Blocklist**: Bob can revoke delivery tokens for specific users

---

## Performance Considerations

| Operation | Overhead |
|-----------|----------|
| Token Generation | ~0.1ms |
| Sealed Encryption | ~1-2ms |
| Padding | negligible |
| Total per message | ~2-3ms |

Acceptable for messaging use case.

---

## References

- [Signal Sealed Sender Blog Post](https://signal.org/blog/sealed-sender/)
- [Signal Sealed Sender Protocol](https://signal.org/docs/)

---

## Related

- Depends on: [P0-001](./P0-crypto-api-fix.md), [P0-002](./P0-ecdh-session-establishment.md)
- Research: [E2EE Competitive Analysis](./research/e2ee-competitive-analysis.md)
- Future: Contact discovery privacy (private set intersection)
