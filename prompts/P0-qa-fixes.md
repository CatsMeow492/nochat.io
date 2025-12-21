# P0: QA Critical Fixes - All Blocking Issues

| Field | Value |
|-------|-------|
| **Agent Type** | Full-Stack Developer |
| **Priority** | P0 - Ship Blocker |
| **Complexity** | High |
| **Branch** | `fix/qa-critical-issues` |
| **Dependencies** | None |
| **Created** | 2024-12 |

---

## Objective

Fix all critical issues discovered during QA testing to achieve a shippable state. This prompt addresses three interconnected bugs that prevent core functionality from working correctly.

---

## Issues to Fix

### Issue 1: In-Chat Call Buttons Non-Functional (HIGH)

**Location:** Conversation header in chat view

**Current Behavior:**
- Conversation view has video/audio call buttons (icons in header)
- Clicking them does nothing - no navigation, no console errors, no action
- The buttons exist at `packages/web/src/components/chat/chat-view.tsx` (or similar)

**Expected Behavior:**
- Clicking video button should initiate a video call with conversation participants
- Clicking audio button should initiate an audio-only call
- Should either:
  - Navigate to `/meeting/{roomId}` with participants pre-invited, OR
  - Open a call UI inline within the conversation

**Technical Approach:**
1. Find the call button components in the chat header
2. Add onClick handlers that either:
   - Create a new meeting room via API and navigate to it
   - Use the existing signaling WebSocket to initiate a call
3. Pass conversation participants as initial meeting attendees

**Files to Investigate:**
```
packages/web/src/components/chat/chat-view.tsx
packages/web/src/components/chat/chat-header.tsx (if exists)
packages/web/src/app/chat/[conversationId]/page.tsx
packages/web/src/app/meeting/[roomId]/page.tsx (reference for working implementation)
```

**Acceptance Criteria:**
- [ ] Video call button in conversation header initiates video call
- [ ] Audio call button in conversation header initiates audio call
- [ ] Call connects participants from the current conversation
- [ ] No console errors on button click

---

### Issue 2: Crypto API 500 Errors (MEDIUM)

**Location:** Backend crypto endpoints

**Current Behavior:**
```
POST /api/crypto/keys/identity => 500 Internal Server Error
POST /api/crypto/keys/prekey => 500 Internal Server Error
```

Console shows:
```
[WARNING] [useCrypto] Failed to upload identity key: Error: Request failed: 500
[WARNING] [useCrypto] Failed to upload signed prekey: Error: Request failed: 500
```

**Expected Behavior:**
- Both endpoints should return 200/201 on successful key upload
- Keys should be stored in PostgreSQL tables (`identity_keys`, `signed_prekeys`)

**Technical Approach:**
1. Check server logs for the actual error: `docker-compose logs app | grep -i error`
2. Common causes:
   - Database schema mismatch (missing columns or tables)
   - UNIQUE constraint violations (key already exists)
   - Missing migrations
   - JSON parsing errors in request body
3. Fix the root cause in the Go handlers

**Files to Investigate:**
```
packages/server/cmd/server/main.go (route handlers)
packages/server/internal/crypto/keys.go (key storage service)
packages/server/migrations/*.sql (schema definitions)
```

**Debug Steps:**
```bash
# Check server logs
docker-compose logs app | tail -100

# Check if tables exist
docker-compose exec postgres psql -U postgres -d nochat -c "\dt"

# Check table schemas
docker-compose exec postgres psql -U postgres -d nochat -c "\d identity_keys"
docker-compose exec postgres psql -U postgres -d nochat -c "\d signed_prekeys"

# Run migrations manually if needed
docker-compose exec postgres psql -U postgres -d nochat -f /path/to/migration.sql
```

**Acceptance Criteria:**
- [ ] `POST /api/crypto/keys/identity` returns 200/201
- [ ] `POST /api/crypto/keys/prekey` returns 200/201
- [ ] Keys visible in database after upload
- [ ] No 500 errors in console during onboarding

---

### Issue 3: ECDH Session Establishment Failing (HIGH)

**Location:** Frontend crypto service + messaging hooks

**Current Behavior:**
```
[useMessages] Sending encrypted message {isDM: false, peerCount: 0, secureMode: legacy}
[CryptoService] DEPRECATED: Using insecure conversation-based key derivation
[ECDH] Skipping session establishment: {isEncryptionReady: true, isDM: false, peerCount: 0}
```

- `peerSessions` IndexedDB store is EMPTY
- All messages use `secureMode: legacy` (conversation-based key derivation)
- No ECDH key exchange occurs between peers

**Expected Behavior:**
- For 1:1 DMs: `isDM: true`, `peerCount: 1`, `secureMode: p2p`
- `peerSessions` should contain session data for each peer
- ECDH key exchange should occur when conversation has 2 participants

**Root Cause Analysis:**

The issue appears to be in the DM detection logic. Console shows:
```
[ECDH] Computed peerIds: 0 peers for user: {userId}
```

This means either:
1. Participants are not being fetched correctly
2. The current user is being filtered out incorrectly
3. The `isDM` check is failing (requires exactly 2 participants)

**Technical Approach:**

1. **Fix participant fetching:**
   ```typescript
   // In useMessages or useConversation hook
   // Ensure participants are fetched and include peer user IDs
   const participants = await api.getParticipants(conversationId);
   const peerIds = participants
     .filter(p => p.userId !== currentUserId)
     .map(p => p.userId);
   ```

2. **Fix DM detection:**
   ```typescript
   // A conversation is a DM if it has exactly 2 participants
   const isDM = participants.length === 2;
   ```

3. **Trigger ECDH session establishment:**
   ```typescript
   // When isDM && peerCount === 1, establish ECDH session
   if (isDM && peerIds.length === 1) {
     await cryptoService.establishSession(peerIds[0]);
   }
   ```

4. **Use peer session for encryption:**
   ```typescript
   // Instead of conversation-based key derivation
   const sessionKey = await cryptoService.getSessionKey(peerId);
   const ciphertext = await encrypt(message, sessionKey);
   ```

**Files to Investigate:**
```
packages/web/src/hooks/use-messages.ts
packages/web/src/hooks/use-conversations.ts
packages/web/src/crypto/CryptoService.ts
packages/web/src/crypto/x3dh.ts (or ecdh.ts)
packages/web/src/components/chat/chat-view.tsx
```

**Acceptance Criteria:**
- [ ] Console shows `isDM: true` for 2-person conversations
- [ ] Console shows `peerCount: 1` for DMs
- [ ] Console shows `secureMode: p2p` (not `legacy`)
- [ ] `peerSessions` IndexedDB store contains session data
- [ ] No "DEPRECATED" warnings for DM conversations

---

## Testing Instructions

After implementing fixes, run this verification:

### Test 1: Key Upload
```bash
# Clear browser storage and create fresh anonymous user
# Open DevTools Network tab
# Filter by /api/crypto/
# Verify:
# - POST /api/crypto/keys/identity => 200/201
# - POST /api/crypto/keys/prekey => 200/201
```

### Test 2: ECDH Sessions
```javascript
// In browser console after opening a 1:1 conversation:
const db = await indexedDB.open('nochat-crypto');
// Check peerSessions store has entries
```

### Test 3: Call Buttons
1. Open a conversation
2. Click video call button
3. Verify: Call UI appears or navigation to meeting room
4. Click audio call button
5. Verify: Audio call initiates

### Test 4: E2E Message Flow
1. Open two browser windows (User A and User B)
2. Create conversation between them
3. User A sends message
4. Verify console shows: `secureMode: p2p`
5. User B receives and decrypts message

---

## Constraints

**DO NOT:**
- Change the IndexedDB schema (maintain backwards compatibility)
- Remove fallback to legacy encryption (keep as safety net)
- Modify the signaling WebSocket protocol
- Break existing meeting functionality (homepage Start/Join works)

**DO:**
- Add comprehensive console logging for debugging
- Handle errors gracefully with user-friendly messages
- Maintain the existing API contract
- Add code comments explaining the ECDH flow

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Key upload success rate | 0% (500 errors) | 100% |
| ECDH session establishment | 0% | 100% for DMs |
| In-chat call button functionality | 0% | 100% |
| `secureMode: p2p` usage | 0% | 100% for DMs |

---

## Related Files

**Frontend:**
- `packages/web/src/crypto/CryptoService.ts`
- `packages/web/src/crypto/symmetric.ts`
- `packages/web/src/hooks/use-messages.ts`
- `packages/web/src/hooks/use-conversations.ts`
- `packages/web/src/components/chat/chat-view.tsx`

**Backend:**
- `packages/server/cmd/server/main.go`
- `packages/server/internal/crypto/keys.go`
- `packages/server/internal/messaging/messaging.go`
- `packages/server/migrations/004_pqxdh_hybrid_keys.sql`

**Reference (working implementation):**
- `packages/web/src/app/meeting/[roomId]/page.tsx` (for call functionality)

---

## Verification Commands

```bash
# Start services
docker-compose up -d

# Watch server logs
docker-compose logs -f app

# Start frontend
cd packages/web && npm run dev

# Run in browser console to verify ECDH:
(async () => {
  const request = indexedDB.open('nochat-crypto');
  request.onsuccess = (e) => {
    const db = e.target.result;
    const tx = db.transaction('peerSessions', 'readonly');
    const store = tx.objectStore('peerSessions');
    store.getAll().onsuccess = (e) => console.log('Peer sessions:', e.target.result);
  };
})();
```
