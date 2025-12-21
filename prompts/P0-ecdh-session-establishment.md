# P0-002: ECDH Session Establishment

| Field | Value |
|-------|-------|
| **Agent Type** | Feature Engineer |
| **Complexity** | High |
| **Branch Name** | `fix/ecdh-peer-sessions` |
| **Blocked By** | P0-001 (crypto-api-fix) |
| **Created** | 2024-12 |

---

## Objective

Ensure ECDH peer sessions are established when users start a 1:1 direct message conversation, enabling true zero-trust encryption.

---

## Context

After key uploads are fixed (P0-001), the next issue is that `peerSessions` in IndexedDB remains empty even in 1:1 DM conversations. The app falls back to `secureMode: legacy` instead of `secureMode: p2p`.

### Current Behavior

```javascript
[useMessages] Sending encrypted message {isDM: false, peerCount: 0, secureMode: legacy}
```

QA observed:
- `isDM: false` - Conversation not detected as direct message
- `peerCount: 0` - No peers connected
- `secureMode: legacy` - Using conversation-based key derivation

### Expected Behavior

```javascript
[useMessages] Sending encrypted message {isDM: true, peerCount: 1, secureMode: p2p}
```

### Root Cause Hypothesis

1. Conversation type detection failing (not recognizing 1:1 as DM)
2. Peer prekey bundle fetch not triggering
3. X3DH handshake not initiating
4. Session data not being written to IndexedDB

---

## Relevant Files

### Frontend Crypto
- `packages/web/src/crypto/x3dh.ts` - X3DH-style key exchange
- `packages/web/src/crypto/CryptoService.ts` - Session management
- `packages/web/src/crypto/ratchet.ts` - Double ratchet (if implemented)

### Frontend Hooks
- `packages/web/src/hooks/use-messages.ts` - Message sending logic
- `packages/web/src/hooks/use-conversations.ts` - Conversation metadata
- `packages/web/src/hooks/use-crypto.ts` - Crypto hook

### Backend
- `packages/server/internal/messaging/messaging.go` - Conversation service
- `packages/server/cmd/server/main.go` - WebSocket handlers

---

## Investigation Checklist

1. [ ] Trace how `isDM` is determined
   - What field/logic marks a conversation as "direct"?
   - Is it based on participant count, conversation type, or something else?

2. [ ] Find where peer prekey bundles are fetched
   - Search for `GET /api/crypto/bundles/`
   - When does this request trigger?

3. [ ] Locate X3DH initiation logic
   - Where is `x3dh.ts` called from?
   - What conditions must be met?

4. [ ] Check WebSocket key exchange messages
   - Are `keyExchange` type messages being sent?
   - Are they being received and processed?

5. [ ] Verify IndexedDB write operations
   - Is `peerSessions` object store being written to?
   - Check for errors in the write operation

6. [ ] Test with two browser sessions
   - User A creates conversation with User B
   - Check both consoles for key exchange logs
   - Verify both users have session data

---

## Acceptance Criteria

- [ ] Starting a 1:1 conversation triggers prekey bundle fetch for the peer
- [ ] X3DH handshake completes successfully
- [ ] `keyExchange` WebSocket messages are sent and received
- [ ] `peerSessions` in IndexedDB contains session data for the peer
- [ ] Console shows `isDM: true` for 1:1 conversations
- [ ] Console shows `peerCount: 1` for 1:1 conversations
- [ ] Console shows `secureMode: p2p` for 1:1 DM messages
- [ ] Messages decrypt correctly on both ends
- [ ] Session persists across page refresh

---

## Constraints

**Do NOT:**
- Break legacy mode fallback (still needed for group chats temporarily)
- Modify the symmetric encryption layer (AES-GCM)
- Remove existing encryption (users should never send plaintext)
- Change the key generation algorithms
- Store session secrets on the server

---

## Technical Notes

### X3DH Flow (Expected)

1. Alice wants to message Bob (first time)
2. Alice fetches Bob's prekey bundle from server
3. Alice verifies signature on Bob's signed prekey
4. Alice generates ephemeral key pair
5. Alice performs ECDH:
   - DH1 = ECDH(Alice_identity, Bob_signed_prekey)
   - DH2 = ECDH(Alice_ephemeral, Bob_identity)
   - DH3 = ECDH(Alice_ephemeral, Bob_signed_prekey)
   - DH4 = ECDH(Alice_ephemeral, Bob_one_time_prekey) [if available]
6. Alice derives shared secret via HKDF
7. Alice sends initial message + ephemeral public key
8. Bob decapsulates and derives same shared secret
9. Both store session in `peerSessions`

### Session Storage Schema

```typescript
interface PeerSession {
  peerId: string;
  rootKey: Uint8Array;
  chainKey: Uint8Array;
  messageNumber: number;
  peerPublicKey: string;
  established: number; // timestamp
}
```

---

## Testing

### Manual Test Procedure

1. Open two browser windows (or use incognito for second user)
2. Create anonymous users in both
3. User A creates a new conversation and adds User B
4. User A sends a message
5. Verify in User A's console:
   - Prekey bundle fetch for User B
   - Key exchange initiation
   - `secureMode: p2p`
6. Verify in User B's console:
   - Key exchange received
   - Session established
7. User B replies
8. Verify both messages decrypt correctly
9. Check IndexedDB `peerSessions` in both browsers

### Automated Test (if applicable)

```typescript
describe('ECDH Session', () => {
  it('establishes p2p session for 1:1 DM', async () => {
    // Create two users
    // Start conversation
    // Assert session created
    // Assert secureMode === 'p2p'
  });
});
```

---

## Related

- Depends on: [P0-001: Crypto API Fix](./P0-crypto-api-fix.md)
- Related: [P1-003: Competitive E2EE Research](./P1-competitive-e2ee-research.md)
- QA Report: `.playwright-mcp/` directory
