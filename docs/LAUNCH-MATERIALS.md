# NoChat Launch Materials

## Product Hunt Launch

### Product Name
**NoChat**

### Tagline (60 characters max)
**Primary:** "Private conversations. Finally."
**Alt 1:** "Encrypted messaging without a phone number"
**Alt 2:** "The messenger that can't read your messages"

### Short Description (260 characters)
End-to-end encrypted messaging and video calls with zero-knowledge architecture. No phone number required. We mathematically cannot read your messages - your keys never leave your device. Open source and available on Web, iOS, and Android.

### Full Description
NoChat is a privacy-first messenger built for people who believe their conversations should stay private.

🔐 **End-to-End Encrypted** - All messages and calls use AES-256-GCM encryption
📵 **No Phone Number Required** - Use anonymously or create an account with just an email
📹 **Encrypted Video Calls** - Peer-to-peer WebRTC calls that never touch our servers
🔑 **Zero-Knowledge Architecture** - Your private keys never leave your device
💎 **Open Source** - Verify our security claims yourself on GitHub
📱 **Cross-Platform** - Available on Web, iOS, and Android

Unlike other "secure" messengers, NoChat doesn't require your phone number. This means:
- No linking your identity to a phone carrier
- No SIM-swap attack vectors
- True anonymous communication when you need it

We built NoChat because we believe privacy isn't a feature - it's a fundamental right.

### Launch Topics/Tags
- Privacy
- Messaging
- Security
- Open Source
- Mobile Apps

### Pricing
**Free** - No premium tier, no ads, no data monetization

---

## Maker's First Comment (Post this immediately after launch)

```
Hey Product Hunt! 👋

I'm [Name], co-founder of NoChat. We built NoChat because we were frustrated with the state of "secure" messaging:

**The Problem:**
- Signal requires your phone number (tied to your real identity)
- WhatsApp is owned by Meta (enough said)
- Telegram's E2EE is opt-in and their crypto is questioned
- Most alternatives are clunky or incomplete

**Our Solution:**
NoChat is built on a zero-knowledge architecture. This isn't marketing speak - it's a mathematical guarantee:

1. Your private keys are generated on your device and never leave it
2. Messages are encrypted with AES-256-GCM before transmission
3. Key exchange uses P-256 ECDH (same as Signal)
4. Our servers only ever see encrypted blobs we cannot decrypt

Even if we received a court order, we couldn't provide your message content. We literally don't have access to it.

**What makes us different:**
- **No phone number** - Use completely anonymously or with just an email
- **Video calls included** - P2P encrypted calls, not just messaging
- **Actually open source** - https://github.com/kindlyrobotics/nochat

**What's next:**
- Post-quantum cryptography (Kyber/ML-KEM) - already in development
- Sealed sender (metadata protection)
- Key transparency for automated verification

We'd love your feedback! What features would make you switch from your current messenger?

🔒 NoChat - Private conversations. Finally.
```

---

## Screenshots Needed

1. **Hero Shot** - Landing page on desktop showing the headline
2. **Chat Interface** - Mobile view of an active conversation with the lock icon visible
3. **Video Call** - Two users in an encrypted video call
4. **Anonymous Login** - The "Start Meeting" flow showing no account required
5. **Security Page** - The /security page showing cryptographic details
6. **Cross-Platform** - Composite showing Web, iOS, and Android side by side

---

## Hacker News "Show HN" Post

### Title
Show HN: NoChat – E2EE messaging without phone number requirement

### Post Body
```
I built NoChat because I wanted Signal's security without having to give up my phone number.

Tech stack:
- Frontend: React + TypeScript
- Backend: Go (single binary, modular monolith)
- Crypto: P-256 ECDH key exchange, AES-256-GCM encryption, HKDF-SHA256
- Calls: WebRTC peer-to-peer with DTLS-SRTP
- Storage: PostgreSQL + Redis

The key insight: your phone number is a tracking identifier. Even with E2EE, requiring a phone number means your identity is tied to a carrier, vulnerable to SIM swaps, and creates a metadata trail.

NoChat lets you:
- Use completely anonymously (no signup required for video calls)
- Create an account with just an email (optional)
- Send E2EE messages and make E2EE video calls

Zero-knowledge architecture means we store only encrypted blobs. Private keys never leave your device.

Open source: https://github.com/kindlyrobotics/nochat
Live: https://nochat.io

Would love feedback from the security community. Cryptographic implementation details in our /security page and CLAUDE.md in the repo.
```

---

## Reddit Launch Strategy

### r/privacy (Primary - 2.3M members)

**Title:** I built an E2EE messenger that doesn't require a phone number - NoChat

**Post:**
```
After years of frustration with messaging apps that claim to be "private" but still require your phone number, I built NoChat.

Why phone numbers matter for privacy:
- They're tied to your real identity via carrier records
- SIM swap attacks can compromise your account
- Metadata reveals who you're communicating with
- Even with E2EE, the phone number creates a traceable identity

NoChat is:
✅ End-to-end encrypted (AES-256-GCM, P-256 ECDH)
✅ No phone number required
✅ Anonymous usage available
✅ Open source
✅ Video calls included
✅ Zero-knowledge architecture

The crypto details: https://nochat.io/security
Source code: https://github.com/kindlyrobotics/nochat

I'd genuinely appreciate feedback from this community - what would make you trust and use a new messenger?
```

### r/degoogle

**Title:** Built a privacy-first messenger as an alternative to Google Messages/Duo - no phone number needed

### r/selfhosted (if applicable later)

Save for when self-hosting option is available.

---

## Twitter/X Launch Thread

```
🧵 Announcing NoChat - Private conversations. Finally.

We built the messenger we wished existed: E2EE messaging + video calls, no phone number required.

Here's why we think this matters 👇

1/ The problem with "secure" messengers:

Signal = great crypto, but requires your phone number
WhatsApp = E2EE but Meta owns your metadata
Telegram = E2EE is opt-in, crypto is questionable

Your phone number IS your identity. It's tied to your carrier, your billing address, and can be SIM-swapped.

2/ NoChat's approach:

🔐 E2EE by default (AES-256-GCM)
📵 No phone number required
📹 Encrypted video calls (P2P WebRTC)
🔑 Zero-knowledge architecture
💎 Open source

3/ Zero-knowledge means:

- Your private keys never leave your device
- We only see encrypted blobs
- Even with a court order, we can't read your messages
- It's not a policy choice, it's math

4/ Available now:

🌐 Web: nochat.io
📱 iOS: [App Store link]
🤖 Android: [Play Store link]
💻 Source: github.com/kindlyrobotics/nochat

5/ What's next:

- Post-quantum cryptography (Kyber/ML-KEM)
- Sealed sender for metadata protection
- Key transparency

We'd love your feedback. What would make you switch?

🔒 nochat.io
```

---

## Press Kit

### One-Liner
NoChat is an end-to-end encrypted messaging and video calling app that doesn't require a phone number.

### Boilerplate (100 words)
NoChat is a privacy-first communication platform featuring end-to-end encrypted messaging and video calls. Unlike other secure messengers, NoChat doesn't require a phone number - users can communicate anonymously or with just an email address. Built on a zero-knowledge architecture, NoChat's servers only ever see encrypted data that even the company cannot decrypt. The app uses industry-standard cryptography (AES-256-GCM, P-256 ECDH) and is fully open source. Available on Web, iOS, and Android.

### Key Facts
- **Founded:** 2024
- **Headquarters:** [City, State]
- **Founders:** [Names]
- **Pricing:** Free
- **Platforms:** Web, iOS, Android
- **Open Source:** Yes (GitHub)

### Key Differentiators
1. No phone number required (vs. Signal, WhatsApp)
2. Zero-knowledge architecture
3. Encrypted video calls included
4. Open source
5. Cross-platform

### Contact
- **Press:** press@nochat.io
- **Security:** security@nochat.io
- **General:** hello@nochat.io

### Assets
- Logo (SVG, PNG)
- App screenshots
- Founder headshots
- OG image

---

## Launch Timing

### Best Days for Product Hunt
- **Tuesday, Wednesday, Thursday** are highest traffic
- Launch at **12:01 AM PT** (midnight Pacific)

### Suggested Launch Date
- Wait for App Store approval confirmation
- Aim for a Tuesday or Wednesday
- Avoid holidays and major tech news days

### Day-of Checklist
- [ ] Product Hunt listing goes live at 12:01 AM PT
- [ ] Post maker comment immediately
- [ ] Share on Twitter/X
- [ ] Post to r/privacy
- [ ] Post Show HN
- [ ] Email friends/network to upvote and comment
- [ ] Monitor and respond to all comments within 1 hour
- [ ] Post updates throughout the day

---

## Metrics to Track

- Product Hunt upvotes and comments
- Website traffic (source breakdown)
- App downloads (iOS, Android)
- Sign-ups vs. anonymous usage
- Social media mentions
- Press coverage
