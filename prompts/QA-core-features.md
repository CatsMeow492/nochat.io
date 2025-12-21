# QA Plan: NoChat Core Features

| Field | Value |
|-------|-------|
| **Agent Type** | QA Engineer |
| **Scope** | All core functionality |
| **Created** | 2024-12 |
| **Priority** | P0 - Ship Blocker |

---

## Overview

This QA plan covers all core NoChat features across two user modes:
- **Anonymous Mode**: No account, ephemeral identity
- **Logged In Mode**: Email/password or wallet authentication

---

## Test Matrix

| Feature | Anonymous | Logged In | Two Users | Priority |
|---------|-----------|-----------|-----------|----------|
| Onboarding | ✓ | ✓ | - | P0 |
| Start New Chat | ✓ | ✓ | ✓ | P0 |
| Send/Receive Messages | ✓ | ✓ | ✓ | P0 |
| Audio Call | ✓ | ✓ | ✓ | P0 |
| Video Call | ✓ | ✓ | ✓ | P0 |
| Message Persistence | - | ✓ | ✓ | P1 |
| Contact Management | - | ✓ | ✓ | P1 |
| E2EE Indicators | ✓ | ✓ | ✓ | P1 |

---

## Part 1: Onboarding Flows

### 1.1 Anonymous Onboarding

**Steps:**
1. Navigate to app (fresh browser, clear storage)
2. Click "Sign in for secure messaging" or equivalent
3. Observe automatic anonymous account creation

**Expected:**
- [ ] Redirected to /chat within 3 seconds
- [ ] No login form required
- [ ] Crypto keys generated (check console)
- [ ] User ID assigned (check IndexedDB)
- [ ] Dashboard/chat interface displayed

**Screenshot:** `onboarding_anonymous.png`

---

### 1.2 Email/Password Registration

**Steps:**
1. Navigate to app (fresh browser)
2. Click "Create Account" or "Sign Up"
3. Enter email, password, confirm password
4. Submit registration

**Expected:**
- [ ] Registration form validates inputs
- [ ] Password requirements enforced (if any)
- [ ] Account created successfully
- [ ] Redirected to chat interface
- [ ] Crypto keys generated

**Screenshot:** `onboarding_register.png`

---

### 1.3 Email/Password Login

**Steps:**
1. Register a new account (1.2)
2. Log out
3. Log back in with same credentials

**Expected:**
- [ ] Login form accepts credentials
- [ ] Successful authentication
- [ ] Previous conversations restored
- [ ] Crypto keys loaded from server/storage

**Screenshot:** `onboarding_login.png`

---

### 1.4 Wallet Authentication (if applicable)

**Steps:**
1. Navigate to app
2. Click "Connect Wallet"
3. Approve wallet connection
4. Sign authentication message

**Expected:**
- [ ] Wallet prompt appears
- [ ] Signature request shown
- [ ] Account created/logged in
- [ ] Redirected to chat interface

**Screenshot:** `onboarding_wallet.png`

---

## Part 2: Messaging (Two Users)

### 2.1 Start New Chat - Anonymous to Anonymous

**Setup:**
- Browser A: Anonymous User A
- Browser B: Anonymous User B

**Steps:**
1. User A clicks "Start New Chat"
2. User A obtains User B's ID (share link, QR, manual entry)
3. User A initiates conversation with User B
4. Conversation appears for both users

**Expected:**
- [ ] "Start New Chat" opens contact/ID entry interface
- [ ] Can enter User B's ID or share invite link
- [ ] Conversation created for User A
- [ ] User B receives notification or conversation appears
- [ ] Both users see empty conversation ready for messages

**Known Issue:** Start New Chat button currently deadends - document exact behavior

**Screenshot:** `messaging_start_chat.png`

---

### 2.2 Send First Message

**Setup:** Conversation established between User A and User B

**Steps:**
1. User A types "Hello, this is User A"
2. User A clicks send (or presses Enter)
3. Observe message delivery

**Expected (User A):**
- [ ] Message appears in conversation immediately
- [ ] Sent indicator shown (checkmark, timestamp)
- [ ] Message encrypted (check Network tab - no plaintext)

**Expected (User B):**
- [ ] Message appears within 2 seconds
- [ ] Sender identified correctly
- [ ] Message content matches exactly

**Screenshot:** `messaging_send_receive.png`

---

### 2.3 Message Reply Flow

**Steps:**
1. User B replies: "Hello User A, message received!"
2. Observe bidirectional messaging

**Expected:**
- [ ] Reply appears for User A within 2 seconds
- [ ] Conversation shows both messages in order
- [ ] Timestamps accurate
- [ ] No duplicate messages

**Screenshot:** `messaging_reply.png`

---

### 2.4 Message Types

Test each message type:

| Type | Test Content | Expected |
|------|--------------|----------|
| Short text | "Hi" | Displays correctly |
| Long text | 500+ characters | Displays, possibly truncated with expand |
| Emoji | "👋🎉🔐" | Renders correctly |
| URL | "https://nochat.io" | Clickable link |
| Mixed | "Check this: https://example.com 🔥" | All elements render |

**Screenshot:** `messaging_types.png`

---

### 2.5 Message Persistence (Logged In Only)

**Steps:**
1. User A (logged in) sends message to User B (logged in)
2. Both users close browser completely
3. Both users reopen browser and log in
4. Navigate to conversation

**Expected:**
- [ ] Previous messages still visible
- [ ] Messages decrypt correctly
- [ ] Conversation state preserved
- [ ] No "Unable to decrypt" errors

**Screenshot:** `messaging_persistence.png`

---

### 2.6 Offline Message Queuing

**Steps:**
1. User A goes offline (DevTools > Network > Offline)
2. User A types and sends a message
3. User A goes back online

**Expected:**
- [ ] Message shows "pending" or queued state while offline
- [ ] Message sends automatically when online
- [ ] User B receives message after User A reconnects
- [ ] No message loss

**Screenshot:** `messaging_offline.png`

---

## Part 3: Audio Calls (Two Users)

### 3.1 Initiate Audio Call

**Setup:**
- Browser A: User A with microphone permission
- Browser B: User B with microphone permission

**Steps:**
1. User A opens conversation with User B
2. User A clicks audio call button (phone icon)
3. Observe call initiation

**Expected (User A):**
- [ ] Call UI appears (dialing/ringing state)
- [ ] Microphone permission requested if not granted
- [ ] Local audio indicator shows mic is active

**Expected (User B):**
- [ ] Incoming call notification/UI appears
- [ ] Caller identified (User A)
- [ ] Accept/Decline options visible

**Screenshot:** `call_audio_initiate.png`

---

### 3.2 Accept Audio Call

**Steps:**
1. User B clicks "Accept" on incoming call

**Expected:**
- [ ] Call connects within 3 seconds
- [ ] Both users hear each other
- [ ] Call duration timer starts
- [ ] Call controls visible (mute, end call)

**Screenshot:** `call_audio_connected.png`

---

### 3.3 Audio Call Controls

Test each control:

| Control | Action | Expected |
|---------|--------|----------|
| Mute | User A mutes | User B stops hearing User A |
| Unmute | User A unmutes | User B hears User A again |
| End Call | User A ends | Call terminates for both |

**Screenshot:** `call_audio_controls.png`

---

### 3.4 Decline Audio Call

**Steps:**
1. User A calls User B
2. User B clicks "Decline"

**Expected:**
- [ ] Call ends for User A (shows declined/unavailable)
- [ ] User B returns to normal chat view
- [ ] No error states

**Screenshot:** `call_audio_decline.png`

---

### 3.5 Audio Call - No Answer

**Steps:**
1. User A calls User B
2. User B does not answer for 30+ seconds

**Expected:**
- [ ] Call times out
- [ ] User A sees "No answer" or equivalent
- [ ] Graceful termination, no hanging state

**Screenshot:** `call_audio_timeout.png`

---

## Part 4: Video Calls (Two Users)

### 4.1 Initiate Video Call

**Setup:**
- Browser A: User A with camera + mic permission
- Browser B: User B with camera + mic permission

**Steps:**
1. User A clicks video call button (camera icon)
2. Observe video call initiation

**Expected (User A):**
- [ ] Camera permission requested if not granted
- [ ] Local video preview visible
- [ ] Calling/ringing state shown

**Expected (User B):**
- [ ] Incoming video call notification
- [ ] Accept/Decline options visible

**Screenshot:** `call_video_initiate.png`

---

### 4.2 Accept Video Call

**Steps:**
1. User B accepts video call

**Expected:**
- [ ] Video connection established within 5 seconds
- [ ] Both users see each other's video
- [ ] Audio working bidirectionally
- [ ] Video controls visible

**Screenshot:** `call_video_connected.png`

---

### 4.3 Video Call Controls

Test each control:

| Control | Action | Expected |
|---------|--------|----------|
| Mute audio | Click mic icon | Audio stops, icon shows muted |
| Unmute audio | Click mic icon again | Audio resumes |
| Disable video | Click camera icon | Video stops, shows avatar/blank |
| Enable video | Click camera icon again | Video resumes |
| Switch camera | Click switch icon (mobile) | Camera switches front/back |
| End call | Click end button | Call terminates for both |

**Screenshot:** `call_video_controls.png`

---

### 4.4 Video Call Quality

**Observe during call:**
- [ ] Video resolution acceptable (not pixelated)
- [ ] Audio/video in sync (no lip-sync issues)
- [ ] Latency acceptable (<500ms)
- [ ] No freezing or artifacts

---

### 4.5 Screen Share (if supported)

**Steps:**
1. During video call, User A clicks "Share Screen"
2. Select screen/window to share

**Expected:**
- [ ] Screen selection dialog appears
- [ ] Selected screen visible to User B
- [ ] Can stop sharing
- [ ] Video resumes after stopping share

**Screenshot:** `call_video_screenshare.png`

---

## Part 5: Dashboard & Navigation

### 5.1 Dashboard Elements

**Verify presence and functionality:**

| Element | Present | Clickable | Functions |
|---------|---------|-----------|-----------|
| Start New Chat button | [ ] | [ ] | [ ] |
| Video Call button | [ ] | [ ] | [ ] |
| Audio Call button | [ ] | [ ] | [ ] |
| Conversation list | [ ] | [ ] | [ ] |
| Settings/Profile | [ ] | [ ] | [ ] |
| Logout (if logged in) | [ ] | [ ] | [ ] |

**Known Issues:**
- Start New Chat deadends
- Video/Audio call buttons in dashboard may be non-functional

**Screenshot:** `dashboard_elements.png`

---

### 5.2 Conversation List

**Steps:**
1. Have multiple conversations
2. Observe conversation list

**Expected:**
- [ ] All conversations listed
- [ ] Most recent at top (or sorted correctly)
- [ ] Unread indicator for new messages
- [ ] Click navigates to conversation

**Screenshot:** `dashboard_conversations.png`

---

### 5.3 Navigation Between Views

Test navigation:

| From | To | Method | Works |
|------|-----|--------|-------|
| Dashboard | Conversation | Click conversation | [ ] |
| Conversation | Dashboard | Back button/icon | [ ] |
| Conversation | Call | Click call button | [ ] |
| Call | Conversation | End call | [ ] |
| Any | Settings | Click settings | [ ] |

---

## Part 6: Edge Cases & Error Handling

### 6.1 Network Interruption During Call

**Steps:**
1. Establish video call
2. User A: DevTools > Network > Offline for 5 seconds
3. User A: Go back online

**Expected:**
- [ ] Call attempts to reconnect
- [ ] Connection restored or graceful failure message
- [ ] No permanent hanging state

---

### 6.2 Browser Tab Close During Call

**Steps:**
1. Establish call
2. User A closes browser tab

**Expected (User B):**
- [ ] Call ends within 5 seconds
- [ ] Shows "User disconnected" or similar
- [ ] No hanging call state

---

### 6.3 Invalid User ID

**Steps:**
1. Try to start chat with invalid/nonexistent user ID

**Expected:**
- [ ] Error message shown
- [ ] "User not found" or equivalent
- [ ] No crash or hang

---

### 6.4 Simultaneous Actions

**Steps:**
1. User A and User B both try to call each other simultaneously

**Expected:**
- [ ] One call succeeds OR
- [ ] Clear resolution (one shows as incoming)
- [ ] No deadlock

---

## Part 7: Cross-Browser Testing

Test core flows on:

| Browser | Onboarding | Messaging | Audio Call | Video Call |
|---------|------------|-----------|------------|------------|
| Chrome (latest) | [ ] | [ ] | [ ] | [ ] |
| Firefox (latest) | [ ] | [ ] | [ ] | [ ] |
| Safari (latest) | [ ] | [ ] | [ ] | [ ] |
| Edge (latest) | [ ] | [ ] | [ ] | [ ] |
| Chrome Mobile | [ ] | [ ] | [ ] | [ ] |
| Safari iOS | [ ] | [ ] | [ ] | [ ] |

---

## Part 8: Security Verification

### 8.1 E2EE Indicators

**Verify for each feature:**

| Feature | Lock Icon | "Encrypted" Text | Console Confirms |
|---------|-----------|------------------|------------------|
| Messages | [ ] | [ ] | [ ] |
| Audio Call | [ ] | [ ] | [ ] |
| Video Call | [ ] | [ ] | [ ] |

---

### 8.2 No Plaintext in Transit

**Steps:**
1. Open Network tab
2. Send message / make call
3. Inspect WebSocket frames and HTTP requests

**Expected:**
- [ ] Message content is Base64/encrypted blob
- [ ] No readable message text in network traffic

---

## Execution Checklist

### Day 1: Core Flows
- [ ] All onboarding paths (1.1-1.4)
- [ ] Basic messaging (2.1-2.3)
- [ ] Audio call happy path (3.1-3.3)
- [ ] Video call happy path (4.1-4.3)

### Day 2: Extended Testing
- [ ] Message types and persistence (2.4-2.6)
- [ ] Call controls and edge cases (3.4-3.5, 4.4-4.5)
- [ ] Dashboard and navigation (5.1-5.3)

### Day 3: Edge Cases & Cross-Browser
- [ ] Error handling (6.1-6.4)
- [ ] Cross-browser testing (Part 7)
- [ ] Security verification (Part 8)

---

## Bug Report Template

```markdown
## BUG-XXX: [Title]

**Severity:** Critical / High / Medium / Low
**Feature:** Onboarding / Messaging / Audio Call / Video Call / Dashboard
**User Mode:** Anonymous / Logged In / Both
**Browser:** Chrome / Firefox / Safari / Edge

**Steps to Reproduce:**
1. ...
2. ...
3. ...

**Expected:** [What should happen]
**Actual:** [What happened]

**Console Errors:**
```
[paste errors]
```

**Network Errors:**
[any failed requests]

**Screenshots:** [filenames]
```

---

## Known Issues (Pre-QA)

| Issue | Feature | Status |
|-------|---------|--------|
| Start New Chat deadends | Dashboard | Needs investigation |
| Video/Audio buttons non-functional | Dashboard | Needs investigation |
| Signed prekey upload 500 | Crypto | UNIQUE constraint violation |
| P2P session falls back to legacy | Crypto | Session establishment failing |

---

## Deliverables

1. **Completed checklist** with pass/fail for each item
2. **Screenshots** for each major scenario
3. **Bug reports** for all failures
4. **Recommendations** for ship/no-ship decision
5. **Summary table** of feature status

---

## Success Criteria

**Must pass for ship:**
- All P0 scenarios pass
- No Critical bugs
- Messaging works end-to-end
- At least one call type works (audio or video)

**Can ship with known issues:**
- P1/P2 bugs documented
- Workarounds available
- No data loss or security issues
