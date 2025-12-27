# NoChat Press Kit

**Last Updated:** December 2024

---

## Quick Facts

| | |
|---|---|
| **Company Name** | NoChat |
| **Website** | [nochat.io](https://nochat.io) |
| **Founded** | 2024 |
| **Category** | Privacy / Security / Communication |
| **Pricing** | Free (no ads, no premium tier) |
| **Platforms** | Web, iOS, Android |
| **Open Source** | Yes - [GitHub](https://github.com/kindlyrobotics/nochat) |

---

## One-Liner

> NoChat is an end-to-end encrypted messaging and video calling app that doesn't require a phone number.

---

## Short Description (100 words)

NoChat is a privacy-first communication platform featuring end-to-end encrypted messaging and video calls. Unlike other secure messengers, NoChat doesn't require a phone number—users can communicate anonymously or with just an email address. Built on a zero-knowledge architecture, NoChat's servers only ever see encrypted data that even the company cannot decrypt. The app uses industry-standard cryptography (P-256 ECDH, AES-256-GCM) and is fully open source for security verification. Available on Web, iOS, and Android.

---

## Long Description (250 words)

NoChat is a next-generation secure messenger designed for people who believe their conversations should remain private.

**The Problem We're Solving**

Most "secure" messengers require a phone number for signup. Your phone number is a unique identifier tied to your real identity through carrier records, vulnerable to SIM-swap attacks, and creates a metadata trail even when message content is encrypted. NoChat eliminates this requirement entirely.

**How NoChat Works**

NoChat uses end-to-end encryption powered by established cryptographic primitives: P-256 ECDH for key exchange and AES-256-GCM for message encryption. Private keys are generated on your device and never leave it. Our servers store only encrypted blobs they cannot decrypt—even with a court order, we couldn't provide message content because we simply don't have access to it.

**Key Features**

- **End-to-End Encrypted**: All messages and calls encrypted by default
- **No Phone Number**: Use anonymously or with just an email
- **Encrypted Video Calls**: Peer-to-peer WebRTC with DTLS-SRTP
- **Zero-Knowledge**: Private keys never leave your device
- **Open Source**: Full transparency for security verification
- **Cross-Platform**: Web, iOS, and Android

**What's Next**

We're actively developing post-quantum cryptography (ML-KEM/Kyber) to protect against future quantum computing threats, sealed sender technology to hide metadata, and key transparency for verifiable key distribution.

NoChat is free forever. No ads. No data monetization. Privacy isn't a premium feature—it's a fundamental right.

---

## Key Differentiators

### vs. Signal
- **No phone number required** - Signal requires phone verification
- Anonymous usage possible with NoChat

### vs. WhatsApp
- **Not owned by Meta** - No connection to advertising ecosystem
- **Zero metadata collection** - We don't track who talks to whom

### vs. Telegram
- **E2EE by default** - Telegram's Secret Chats are opt-in
- **Proven cryptography** - No homegrown crypto protocols

### vs. iMessage
- **Cross-platform** - Works on Android, not just Apple devices
- **Open source** - Verifiable security claims

---

## Technology Overview

| Component | Technology |
|-----------|------------|
| **Key Exchange** | P-256 ECDH (Elliptic Curve Diffie-Hellman) |
| **Message Encryption** | AES-256-GCM (Authenticated Encryption) |
| **Key Derivation** | HKDF-SHA256 |
| **Video/Voice** | WebRTC with DTLS-SRTP |
| **Backend** | Go (single binary, modular monolith) |
| **Frontend** | React + TypeScript |
| **Database** | PostgreSQL |
| **Hosting** | Fly.io (distributed edge) |

---

## Security Highlights

1. **Zero-Knowledge Architecture**: Servers never see plaintext or private keys
2. **Industry-Standard Crypto**: Same primitives used by banks and governments
3. **Web Crypto API**: Native browser crypto, no npm supply chain risk
4. **Open Source**: Full source code available for audit
5. **No Analytics**: No third-party tracking or analytics SDKs

---

## Founder Quotes

> "We built NoChat because we believe privacy isn't a feature—it's a fundamental right. Your phone number shouldn't be the price of secure communication."

> "When we say zero-knowledge, we mean it mathematically. Even if our servers were completely compromised, attackers would see only meaningless ciphertext."

> "End-to-end encryption isn't magic—it's math. We use well-established cryptographic primitives and invite security researchers to verify our claims."

---

## Product Screenshots

*(Screenshots available in /docs/press-kit/screenshots/)*

1. **Landing Page** - Hero section showing value proposition
2. **Chat Interface** - Mobile view with encryption indicator
3. **Video Call** - Two users in encrypted call
4. **Anonymous Mode** - No-signup required flow
5. **Security Page** - Cryptographic implementation details

---

## Logo & Brand Assets

*(Assets available in /docs/press-kit/assets/)*

### Logo Specifications
- **Primary Color**: `oklch(0.75 0.18 156.17)` (vibrant green/teal)
- **Background**: Dark theme (`oklch(0.145 0 0)`)
- **Typography**: System font stack (clean, modern)

### Available Formats
- Logo (SVG, PNG - various sizes)
- Icon (SVG, PNG - app icon format)
- OG Image (1200x630 PNG)
- Banner (various sizes)

---

## Press Coverage Guidelines

When covering NoChat, please:

- **Do** mention the no-phone-number requirement as a key differentiator
- **Do** note that it's open source and verifiable
- **Do** link to our GitHub for technical verification
- **Don't** call it "unhackable" (no system is)
- **Don't** imply government endorsement

### Accuracy Notes

- NoChat uses E2EE, but we're transparent about current limitations
- Post-quantum cryptography is in development, not yet deployed
- We're a small team, not a large corporation

---

## Interview Availability

Founders available for:

- Podcast interviews (remote)
- Written Q&A
- Technical deep-dives (with engineering team)
- Security/privacy commentary

---

## Contact Information

| Purpose | Email |
|---------|-------|
| **Press Inquiries** | press@nochat.io |
| **Security Issues** | security@nochat.io |
| **General Contact** | hello@nochat.io |
| **Partnership** | partners@nochat.io |

### Social Media

- **GitHub**: [github.com/kindlyrobotics/nochat](https://github.com/kindlyrobotics/nochat)
- **Twitter/X**: [@nochat_io](https://twitter.com/nochat_io) *(if applicable)*

---

## Embargo Policy

We respect embargoes. If you're working on a story and need early access or information under embargo, please contact press@nochat.io.

---

## Additional Resources

- **Technical Blog Post**: [How NoChat Implements E2EE](/docs/blog/2024-12-e2ee-deep-dive.md)
- **Cryptographic Inventory**: [crypto-inventory.md](/docs/crypto-inventory.md)
- **Security Policy**: [SECURITY.md](/SECURITY.md)
- **Launch Materials**: [LAUNCH-MATERIALS.md](/docs/LAUNCH-MATERIALS.md)

---

*For the most up-to-date press materials, visit nochat.io/press or contact press@nochat.io*
