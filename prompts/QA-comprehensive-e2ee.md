# QA: Comprehensive E2EE Feature Verification

| Field | Value |
|-------|-------|
| **Agent Type** | QA Engineer |
| **Scope** | Full E2EE stack verification |
| **Created** | 2024-12 |
| **Prerequisites** | All feature prompts (P0-001 through P2-008) completed |

---

## Objective

Verify that all implemented E2EE features work correctly individually and together. This includes regression testing for existing functionality and new feature validation.

---

## Test Environment Setup

```bash
# Start all services
docker-compose up -d

# Verify services are running
docker-compose ps

# Check app health
curl http://localhost:8080/health

# Open browser for testing
# Use two browser windows/profiles for two-user scenarios
```

**Tools needed:**
- Browser DevTools (Console, Network, Application/IndexedDB)
- Two browser windows or incognito for multi-user tests
- Playwright MCP for automated screenshots

---

## Test Scenarios

### Scenario A: Anonymous Onboarding (Regression)

**Purpose:** Verify basic onboarding still works after all changes.

**Steps:**
1. Navigate to https://localhost:3000 (or deployed URL)
2. Click "Sign in for secure messaging"
3. Wait for redirect to /chat

**Expected Results:**
- [ ] Redirected to /chat within 3 seconds
- [ ] "Start New Chat" button visible
- [ ] Console shows: `[CryptoService] Keys generated and stored`
- [ ] No 400 errors in console
- [ ] IndexedDB `keys` store populated

**Screenshot:** `scenario_a_onboarding.png`

---

### Scenario B: Crypto Key Upload (P0-001)

**Purpose:** Verify key upload endpoints return 200/201, not 400.

**Steps:**
1. Create fresh anonymous user
2. Open DevTools Network tab
3. Filter by `/api/crypto/`
4. Observe key upload requests

**Expected Results:**
- [ ] `POST /api/crypto/keys/identity` returns 200/201
- [ ] `POST /api/crypto/keys/prekey` returns 200/201
- [ ] `POST /api/crypto/keys/prekeys` returns 200/201 (batch OTK)
- [ ] No 400 errors for any crypto endpoint
- [ ] Console shows successful key upload messages

**Verify in database:**
```sql
-- Connect to postgres
docker-compose exec postgres psql -U postgres -d nochat

-- Check keys exist
SELECT user_id, LEFT(dilithium_public_key, 20) as identity_key FROM identity_keys LIMIT 5;
SELECT user_id, key_id FROM signed_prekeys LIMIT 5;
SELECT user_id, COUNT(*) as otk_count FROM one_time_prekeys GROUP BY user_id;
```

**Screenshot:** `scenario_b_key_upload.png`

---

### Scenario C: Rate Limiting (P0-001)

**Purpose:** Verify prekey bundle fetch is rate limited.

**Steps:**
1. Get a valid auth token
2. Run rapid bundle fetches:
```bash
TOKEN="<your_token>"
TARGET_USER="<other_user_id>"

# Rapid fire 15 requests (should hit 10/min limit)
for i in {1..15}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    http://localhost:8080/api/crypto/bundles/$TARGET_USER \
    -H "Authorization: Bearer $TOKEN"
done
```

**Expected Results:**
- [ ] First 10 requests return 200
- [ ] Requests 11-15 return 429 Too Many Requests
- [ ] Rate limit resets after 60 seconds
- [ ] Redis keys created: `ratelimit:bundle:requester:*`

**Screenshot:** `scenario_c_rate_limit.png`

---

### Scenario D: ECDH Session Establishment (P0-002)

**Purpose:** Verify peer sessions are created for 1:1 DMs.

**Steps:**
1. Open two browser windows (User A and User B)
2. Create anonymous users in both
3. User A creates a new conversation
4. User A adds User B to conversation
5. User A sends a message

**Expected Results (User A console):**
- [ ] `[useMessages] Sending encrypted message {isDM: true, peerCount: 1, secureMode: p2p}`
- [ ] NOT `secureMode: legacy`

**Expected Results (IndexedDB - both users):**
- [ ] `peerSessions` store contains session data
- [ ] Session includes `peerId`, `rootKey`, `chainKey`

**Expected Results (User B):**
- [ ] Message decrypts and displays correctly
- [ ] Lock icon visible with "Encrypted" indicator

**Screenshot:** `scenario_d_session_established.png`

---

### Scenario E: PQXDH Hybrid Key Exchange (P0-006)

**Purpose:** Verify Kyber keys are generated, uploaded, and used.

**Steps:**
1. Create fresh user
2. Check IndexedDB for Kyber keys
3. Fetch another user's prekey bundle
4. Verify Kyber components present

**Expected Results (IndexedDB):**
- [ ] `keys` store contains `kyberPublicKey` and `kyberPrivateKey`
- [ ] Keys are 1568 bytes (Kyber-1024)

**Expected Results (Bundle fetch):**
```bash
curl http://localhost:8080/api/crypto/bundles/$USER_ID \
  -H "Authorization: Bearer $TOKEN" | jq
```
- [ ] Response includes `pqSignedPrekey` (Kyber public key)
- [ ] Response includes `pqSignedPrekeySignature`

**Expected Results (Console during handshake):**
- [ ] Log shows hybrid key derivation (ECDH + KEM)
- [ ] `[PQXDH]` or similar prefix in logs

**Screenshot:** `scenario_e_pqxdh.png`

---

### Scenario F: Sealed Sender (P1-007)

**Purpose:** Verify sender identity is hidden from server.

**Steps:**
1. Enable Network tab recording
2. User A sends message to User B
3. Inspect the WebSocket/HTTP message payload

**Expected Results (Network):**
- [ ] Outgoing message contains `recipientId` but NOT `senderId` in envelope
- [ ] Message body is `sealedContent` (opaque blob)

**Expected Results (Server logs):**
```bash
docker-compose logs app | grep -i "sealed"
```
- [ ] No sender user ID logged for sealed messages

**Expected Results (Recipient):**
- [ ] User B can decrypt and see message
- [ ] User B sees correct sender identity (decrypted from sealed content)

**Expected Results (UI):**
- [ ] Sealed messages show 🔒 "Private" badge (if implemented)
- [ ] Non-sealed show 🔐 "Encrypted" badge

**Screenshot:** `scenario_f_sealed_sender.png`

---

### Scenario G: Sealed Sender Fallback (P1-007)

**Purpose:** Verify graceful fallback when recipient doesn't support sealed sender.

**Steps:**
1. Create a user without sealed sender keys (simulate legacy client)
2. Send message from sealed-sender-enabled user

**Expected Results:**
- [ ] Message sends successfully (no error)
- [ ] Console shows: `[SealedSender] Recipient does not support sealed sender, falling back`
- [ ] Message is E2EE encrypted (just not sealed)

**Screenshot:** `scenario_g_fallback.png`

---

### Scenario H: Offline Indicator (P2-004)

**Purpose:** Verify offline state is communicated to user.

**Steps:**
1. Open app in Chrome
2. Open DevTools > Network tab
3. Set Network to "Offline"
4. Observe UI

**Expected Results:**
- [ ] Offline banner/indicator appears within 2 seconds
- [ ] Banner text indicates offline state
- [ ] User can still type message (queued)

**Steps (continued):**
5. Set Network back to "Online"
6. Observe UI

**Expected Results:**
- [ ] Offline indicator disappears within 2 seconds
- [ ] Queued message sends automatically
- [ ] Message appears in conversation

**Screenshot:** `scenario_h_offline.png`

---

### Scenario I: Key Transparency (P2-008)

**Purpose:** Verify Merkle proofs are generated and validated.

**Steps:**
1. Fetch a user's prekey bundle
2. Check for inclusion proof

**Expected Results (API):**
```bash
curl http://localhost:8080/api/crypto/bundles/$USER_ID \
  -H "Authorization: Bearer $TOKEN" | jq '.inclusionProof'
```
- [ ] Response includes `inclusionProof` object
- [ ] Proof contains `siblings`, `rootHash`, `rootSignature`

**Expected Results (Client):**
- [ ] Console shows proof verification: `[KeyTransparency] Proof verified`
- [ ] No verification failure warnings

**Expected Results (Transparency endpoint):**
```bash
curl http://localhost:8080/api/transparency/root
```
- [ ] Returns signed root hash
- [ ] Signature verifiable with published public key

**Screenshot:** `scenario_i_transparency.png`

---

### Scenario J: Prekey Replenishment (P0-001)

**Purpose:** Verify client replenishes one-time prekeys.

**Steps:**
1. Check current OTK count:
```bash
curl http://localhost:8080/api/crypto/keys/prekeys/count \
  -H "Authorization: Bearer $TOKEN"
```
2. Consume some prekeys by fetching bundles from other users
3. Wait 5 minutes (or trigger replenishment manually)
4. Check count again

**Expected Results:**
- [ ] Initial count > 50
- [ ] After consumption, count replenishes to ~100
- [ ] Console shows: `[useCrypto] Replenishing prekeys`

**Screenshot:** `scenario_j_replenishment.png`

---

### Scenario K: Start New Chat Flow (CRITICAL)

**Purpose:** Verify "Start New Chat" button works and users can initiate conversations.

**Known Issue:** Start Chat button reportedly deadends.

**Steps:**
1. Login as User A
2. Click "Start New Chat" button on dashboard
3. Observe what happens

**Expected Results:**
- [ ] Modal or page opens to select/search for contacts
- [ ] Can search for or select User B
- [ ] Can initiate conversation with User B
- [ ] Redirected to conversation view
- [ ] Can send first message

**Failure Documentation:**
If button deadends, document:
- What happens when clicked (nothing? error? wrong page?)
- Console errors
- Network requests made (if any)

**Screenshot:** `scenario_k_start_chat.png`

---

### Scenario L: Video/Audio Call Buttons (CRITICAL)

**Purpose:** Verify video and audio call buttons function.

**Known Issue:** Video and audio call buttons in dashboard are non-functional.

**Steps:**
1. Login as User A
2. Locate video call button on dashboard
3. Click video call button
4. Observe behavior

**Expected Results:**
- [ ] Click triggers call initiation flow
- [ ] Camera/mic permission prompt appears (or pre-existing permission used)
- [ ] Call room/lobby created
- [ ] Can invite or wait for other user

**Repeat for audio call button.**

**Failure Documentation:**
If buttons non-functional, document:
- Button location and state (disabled? clickable?)
- What happens on click (nothing? error?)
- Console errors
- Missing click handlers or routes

**Screenshot:** `scenario_l_call_buttons.png`

---

### Scenario M: End-to-End Message Flow (Integration)

**Purpose:** Verify complete message flow with all features.

**Steps:**
1. User A (fresh) creates conversation with User B (fresh)
2. User A sends: "Hello, this is a test message"
3. User B replies: "Message received!"
4. Both users refresh page
5. Verify messages persist and decrypt

**Expected Results:**
- [ ] Both messages display correctly
- [ ] Encryption indicators visible
- [ ] No console errors
- [ ] Messages persist after refresh
- [ ] Session keys cached and reused

**Verify server-side (messages are encrypted):**
```sql
SELECT id, LEFT(encrypted_content, 50) as content_preview
FROM messages
ORDER BY created_at DESC LIMIT 5;
```
- [ ] `encrypted_content` is Base64 ciphertext, NOT plaintext

**Screenshot:** `scenario_k_e2e_flow.png`

---

## Bug Report Template

For any failures, document:

```markdown
## BUG-XXX: [Title]

**Severity:** Critical / High / Medium / Low
**Scenario:** [Which scenario failed]
**Component:** [Crypto / API / UI / etc.]

**Steps to Reproduce:**
1. ...
2. ...

**Expected:** [What should happen]
**Actual:** [What happened]

**Console Errors:**
```
[paste errors]
```

**Screenshots:** [filename]
```

---

## Acceptance Criteria

**Must Pass (P0 - Ship Blockers):**
- [ ] Scenario A: Onboarding works
- [ ] Scenario B: Key upload succeeds (no 400s)
- [ ] Scenario C: Rate limiting enforced
- [ ] Scenario D: ECDH sessions establish (`secureMode: p2p`)
- [ ] Scenario K: **Start New Chat button works** (KNOWN ISSUE)
- [ ] Scenario L: **Video/Audio call buttons work** (KNOWN ISSUE)
- [ ] Scenario M: End-to-end message flow works

**Should Pass (P1):**
- [ ] Scenario E: PQXDH keys present
- [ ] Scenario F: Sealed sender hides sender
- [ ] Scenario G: Fallback works
- [ ] Scenario I: Transparency proofs validate

**Nice to Have (P2):**
- [ ] Scenario H: Offline indicator
- [ ] Scenario J: Prekey replenishment

---

## Deliverables

1. **Test Report:** Summary table of all scenarios with pass/fail
2. **Screenshots:** All scenario screenshots saved to `.playwright-mcp/`
3. **Bug Reports:** Any failures documented with reproduction steps
4. **Recommendations:** Follow-up items for issues found

---

## Notes

- Use fresh anonymous users for each scenario to avoid state pollution
- Clear IndexedDB between tests if needed: `indexedDB.deleteDatabase('nochat-crypto')`
- Server logs: `docker-compose logs -f app`
- If Playwright MCP available, automate screenshot capture
