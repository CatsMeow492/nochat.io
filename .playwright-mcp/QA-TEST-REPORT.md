# NoChat.io E2EE QA Test Report

**Date:** 2025-12-20
**Tester:** Claude (Automated QA)
**Environment:** Local Docker (localhost:3000 / localhost:8080)

---

## Executive Summary

| Priority | Total | Passed | Failed | Partial |
|----------|-------|--------|--------|---------|
| P0 (Ship Blockers) | 7 | 4 | 1 | 2 |
| P1 | 4 | 0 | 0 | 0 (not tested) |
| P2 | 2 | 0 | 0 | 0 (not tested) |

**Overall Status: BLOCKED - 1 Critical Bug, 2 High-Priority Issues**

---

## P0 Scenarios (Ship Blockers)

### Scenario A: Anonymous Onboarding
**Status: PASS**

| Check | Result |
|-------|--------|
| Redirected to /chat within 3 seconds | PASS |
| "Start New Chat" button visible | PASS |
| Console shows key generation | PASS |
| No 400 errors in console | PASS (500s exist - see bugs) |
| IndexedDB keys populated | PASS |

**Screenshot:** `scenario_a_onboarding.png`

---

### Scenario B: Crypto Key Upload
**Status: PARTIAL PASS**

| Check | Result |
|-------|--------|
| POST /api/crypto/keys/identity returns 200/201 | PASS (first time) |
| POST /api/crypto/keys/prekey returns 200/201 | FAIL (500 on subsequent) |
| POST /api/crypto/keys/prekeys returns 200/201 | N/A (not implemented) |
| No 400 errors for crypto endpoints | PASS |
| Keys exist in database | PASS |

**Bug Found:** BUG-001 (Critical)

**Screenshot:** `scenario_b_key_upload.png`

---

### Scenario C: Rate Limiting
**Status: PASS**

| Check | Result |
|-------|--------|
| First 10 requests return 200 | PASS |
| Requests 11-15 return 429 | PASS |
| Redis keys created | PASS |

**Evidence:**
```
Request 1-10: 200
Request 11-15: 429
```

**Screenshot:** `scenario_c_rate_limit.png`

---

### Scenario D: ECDH Session Establishment
**Status: PARTIAL PASS**

| Check | Result |
|-------|--------|
| Session establishment attempted | PASS |
| secureMode: p2p | FAIL (falls back to legacy) |
| Message encryption works | PASS (legacy mode) |
| Lock icon visible | PASS |

**Console Evidence:**
```
[ECDH] Encryption decision: {useP2P: false, isDM: true, hasPeers: true, sessionReady: true}
[useMessages] Sending encrypted message {isDM: true, peerCount: 1, secureMode: legacy}
[CryptoService] DEPRECATED: Using insecure conversation-based key derivation
```

**Bug Found:** BUG-002 (High) - P2P session establishment fails

**Screenshot:** `scenario_d_p2p_unavailable.png`

---

### Scenario K: Start New Chat Flow (CRITICAL)
**Status: FAIL**

| Check | Result |
|-------|--------|
| Modal/page opens to select contacts | FAIL |
| Can search for User B | FAIL |
| Can initiate conversation | PARTIAL (creates empty conv) |
| Redirected to conversation view | FAIL |
| Can send first message | N/A |

**What Happens:**
1. Click "Start New Chat" button
2. New conversation is created (API returns 200)
3. Conversation appears in sidebar
4. User STAYS on welcome screen (no navigation)
5. No way to add participants or share invite link
6. Menu only has "Conversation info" (which does nothing)

**Bug Found:** BUG-003 (Critical)

**Screenshot:** `scenario_k_start_chat.png`, `scenario_k_start_chat_menu.png`

---

### Scenario L: Video/Audio Call Buttons (CRITICAL)
**Status: PASS**

| Check | Result |
|-------|--------|
| Start Meeting button works | PASS |
| Creates anonymous user | PASS |
| Navigates to meeting room | PASS |
| WebSocket connects | PASS |
| Join Meeting dialog works | PASS |
| Video controls visible | PASS |

**Console Evidence:**
```
[Meeting] Connecting to ws://localhost:8080/api/signaling?user_id=...
[Meeting] WebSocket connected
[Meeting] My peer ID: e93ea4ea
[Meeting] WS message: userCount 1
```

**Screenshot:** `scenario_l_meeting_lobby.png`, `scenario_l_video_call_active.png`

---

### Scenario M: End-to-End Message Flow
**Status: PASS**

| Check | Result |
|-------|--------|
| Messages display correctly | PASS |
| Encryption indicators visible | PASS |
| Messages persist after refresh | PASS |
| Messages encrypted in database | PASS |

**Database Evidence:**
```sql
SELECT encode(encrypted_content, 'base64') FROM messages LIMIT 1;
-- Returns Base64 ciphertext, NOT plaintext
```

**Screenshot:** `scenario_d_single_user.png`

---

## Bug Reports

### BUG-001: Signed Prekey Upload Fails with 500 on Duplicate Key ID

**Severity:** Critical
**Scenario:** B - Crypto Key Upload
**Component:** API / Database

**Steps to Reproduce:**
1. Create anonymous user (first time)
2. Keys upload successfully
3. Refresh page or revisit
4. Signed prekey upload fails with 500

**Expected:** Prekey upload should succeed or update existing key
**Actual:** 500 Internal Server Error

**Root Cause:**
The `StoreSignedPreKey` function in `/packages/server/internal/crypto/keys.go`:
1. Marks existing prekeys as `status = 'rotated'`
2. Attempts INSERT with same `key_id`
3. Fails due to UNIQUE constraint on `(user_id, key_id)`

**Fix Required:** Either:
- Use `ON CONFLICT DO UPDATE` in INSERT
- Delete old row instead of just updating status
- Increment `key_id` for new uploads

**Console Errors:**
```
[WARNING] [useCrypto] Failed to upload signed prekey: Error: Request failed: 500
```

---

### BUG-002: ECDH P2P Session Establishment Fails

**Severity:** High
**Scenario:** D - ECDH Session Establishment
**Component:** Crypto / Session Management

**Steps to Reproduce:**
1. Create conversation with 2 participants
2. Open conversation
3. Session establishment is attempted
4. Falls back to legacy mode

**Expected:** P2P ECDH session established, `secureMode: p2p`
**Actual:** Session fails, falls back to `secureMode: legacy`

**Console Evidence:**
```
[ECDH] Proactively establishing ECDH session with peer: xxx
[CryptoService] Fetched peer prekey bundle, key length: 65
[CryptoService] Failed to establish session with peer: xxx
[ECDH] ECDH session failed, will use legacy mode
```

**Impact:** Messages are still encrypted but use deprecated conversation-based key derivation instead of true P2P encryption.

---

### BUG-003: Start New Chat Button Deadends

**Severity:** Critical (Ship Blocker)
**Scenario:** K - Start New Chat Flow
**Component:** UI / Navigation

**Steps to Reproduce:**
1. Login as anonymous user
2. Click "Start New Chat" button
3. Observe behavior

**Expected:**
- Modal opens to search/select contacts OR
- Navigate to new conversation with invite link OR
- Some way to add participants

**Actual:**
- Conversation created silently
- User stays on welcome screen
- No navigation to new conversation
- No way to invite others
- "Conversation info" menu item does nothing

**Root Cause:**
In `/packages/web/src/app/chat/page.tsx`:
```tsx
<Button onClick={() => createConversation({ type: "direct" })}>
```
The `createConversation` mutation only invalidates queries, doesn't navigate.

In `/packages/web/src/hooks/use-conversations.ts`:
```tsx
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ["conversations"] });
  // Missing: navigate to new conversation
  // Missing: open invite modal
},
```

**Fix Required:**
1. Add navigation to new conversation on success
2. Implement invite link generation
3. Add "Add Participants" or "Share Invite" functionality

---

### BUG-004: Key Transparency Endpoint Returns 500

**Severity:** Medium
**Scenario:** Multiple (background)
**Component:** API

**Steps to Reproduce:**
1. Any page load
2. Check network requests

**Actual:**
```
GET /api/transparency/signing-keys => 500 Internal Server Error
GET /api/transparency/root => 500 Internal Server Error
```

**Console:**
```
[Transparency] Signing keys not available
[Transparency] Failed to fetch tree head: 500
```

**Impact:** Key transparency features non-functional but app continues to work.

---

### BUG-005: Identity Key Upload Fails on Subsequent Requests

**Severity:** High
**Scenario:** B - Crypto Key Upload
**Component:** API / Database

**Steps to Reproduce:**
1. User already has identity key in database
2. Page reloads, attempts to upload identity key again
3. Returns 500

**Related to:** BUG-001 (same pattern - unique constraint violation)

---

## Recommendations

### Immediate (Before Ship):
1. **Fix BUG-003** - Start New Chat is completely broken for user flow
2. **Fix BUG-001/005** - Key upload failures cause 500 errors on every page load
3. **Fix BUG-002** - P2P encryption not working (security degradation)

### Short-term:
4. Fix Key Transparency endpoints (BUG-004)
5. Implement one-time prekey batch upload
6. Add invite link functionality for conversations

### Testing Improvements:
7. Add E2E tests for critical user flows
8. Add integration tests for crypto endpoints
9. Monitor for 500 errors in production

---

## Screenshots

| Scenario | File |
|----------|------|
| A - Onboarding | `scenario_a_onboarding.png` |
| B - Key Upload | `scenario_b_key_upload.png` |
| C - Rate Limit | `scenario_c_rate_limit.png` |
| D - Session (single) | `scenario_d_single_user.png` |
| D - Session (establishing) | `scenario_d_session_establishing.png` |
| D - P2P unavailable | `scenario_d_p2p_unavailable.png` |
| K - Start Chat | `scenario_k_start_chat.png` |
| K - Menu | `scenario_k_start_chat_menu.png` |
| L - Meeting Lobby | `scenario_l_meeting_lobby.png` |
| L - Video Call | `scenario_l_video_call_active.png` |

---

## Test Environment Details

- **Frontend:** http://localhost:3000 (Next.js)
- **Backend:** http://localhost:8080 (Go)
- **Database:** PostgreSQL (Docker)
- **Redis:** Redis 7 (Docker)
- **Browser:** Playwright Chromium

---

*Report generated by Claude QA Agent*
