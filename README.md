# NoChat

**Private conversations. Finally.**

NoChat is an end-to-end encrypted messaging and video calling app that doesn't require a phone number.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

## Why NoChat?

Most "secure" messengers require your phone number to sign up. Your phone number is:
- Tied to your real identity via carrier records
- Vulnerable to SIM-swap attacks
- A metadata trail even when content is encrypted

NoChat eliminates this requirement. Use completely anonymously, or sign up with just an email.

## Features

- **End-to-End Encrypted** - All messages and calls use P-256 ECDH + AES-256-GCM
- **No Phone Number Required** - Use anonymously or with just an email
- **Encrypted Video Calls** - Peer-to-peer WebRTC with DTLS-SRTP
- **Zero-Knowledge Architecture** - Private keys never leave your device
- **Cross-Platform** - Web, iOS, Android, macOS, Windows, Linux
- **Open Source** - MIT licensed, fully auditable

## Quick Start

### Web
Visit [nochat.io](https://nochat.io)

### Desktop
Download from [GitHub Releases](https://github.com/kindlyrobotics/nochat/releases)

### Mobile
- **iOS**: [App Store](https://apps.apple.com/app/nochat-private-messenger/id6740683624)
- **Android**: Coming soon to Google Play

## Development

### Prerequisites
- Go 1.20+
- Node.js 18+
- Docker & Docker Compose

### Local Development

```bash
# Start all services (postgres, redis, minio, app)
docker-compose up

# Frontend development
cd packages/web
npm install
npm run dev

# Desktop development
cd packages/desktop
npm install
npm run dev
```

See [CLAUDE.md](./CLAUDE.md) for detailed development documentation.

## Architecture

NoChat uses a **modular monolith** architecture:

- **Backend**: Go (single binary)
- **Frontend**: React + TypeScript + Next.js
- **Desktop**: Tauri (Rust + Web)
- **Mobile**: Capacitor (iOS/Android)
- **Database**: PostgreSQL
- **Cache**: Redis
- **Storage**: S3-compatible (MinIO local, AWS S3/R2 prod)

## Security

NoChat implements a zero-trust architecture where the server never sees user content:

| Feature | Implementation |
|---------|---------------|
| Key Exchange | P-256 ECDH |
| Message Encryption | AES-256-GCM |
| Key Derivation | HKDF-SHA256 |
| Video/Voice | WebRTC + DTLS-SRTP |

For detailed cryptographic implementation, see:
- [Security Page](https://nochat.io/security)
- [Crypto Inventory](./docs/crypto-inventory.md)
- [E2EE Deep Dive](./docs/blog/2024-12-e2ee-deep-dive.md)

### Report Security Issues
Email: security@nochat.io

See [SECURITY.md](./SECURITY.md) for our security policy.

## License

MIT License - see [LICENSE](./LICENSE)

Copyright (c) 2025 Kindly Robotics

## Links

- **Website**: [nochat.io](https://nochat.io)
- **GitHub**: [github.com/kindlyrobotics/nochat](https://github.com/kindlyrobotics/nochat)
- **Security**: [nochat.io/security](https://nochat.io/security)
- **Support**: support@nochat.io
