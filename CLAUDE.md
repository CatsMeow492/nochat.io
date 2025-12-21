# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

nochat.io is a secure peer-to-peer video conferencing and messaging platform. The project has been refactored from 8 microservices to a **modular monolith** architecture for simplified development and deployment while maintaining clear domain boundaries.

**Tech Stack:**
- **Backend**: Go 1.20 (single binary)
- **Database**: PostgreSQL (persistent data)
- **Cache**: Redis (ephemeral state, pub/sub)
- **Storage**: S3-compatible (MinIO local, AWS S3/R2 prod)
- **Frontend**: React 18 + TypeScript

## Development Commands

### Local Development

```bash
# Start all services (postgres, redis, minio, app)
docker-compose up

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop all services
docker-compose down

# Rebuild after code changes
docker-compose up --build app
```

### Backend Development (packages/server)

```bash
# Install dependencies
go mod download

# Run locally (requires DATABASE_URL, REDIS_URL, S3_* env vars)
go run cmd/server/main.go

# Build binary
go build -o bin/server cmd/server/main.go

# Run tests
go test ./...

# Format code
go fmt ./...
```

**Environment Variables:**
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis host:port
- `S3_ENDPOINT`: S3-compatible endpoint (e.g., `localhost:9000` for MinIO)
- `S3_ACCESS_KEY`, `S3_SECRET_KEY`: S3 credentials
- `S3_BUCKET`: Bucket name (default: `nochat-files`)
- `S3_USE_SSL`: Use SSL for S3 (default: `false` for local)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`: For ICE servers

### Frontend Development (packages/web)

```bash
cd packages/web

# Development server (HTTPS enabled on port 3000)
npm start

# Build for production
npm run build

# Run tests
npm test
```

### Production Deployment

**Fly.io:**

```bash
cd packages/server

# Login to Fly.io
fly auth login

# Create app (first time)
fly launch

# Set secrets
fly secrets set DATABASE_URL=postgres://...
fly secrets set REDIS_URL=redis://...
fly secrets set S3_ENDPOINT=...
fly secrets set S3_ACCESS_KEY=...
fly secrets set S3_SECRET_KEY=...
fly secrets set S3_BUCKET=...
fly secrets set TWILIO_ACCOUNT_SID=...
fly secrets set TWILIO_AUTH_TOKEN=...

# Deploy
fly deploy

# View logs
fly logs

# SSH into instance
fly ssh console
```

## Architecture

### Modular Monolith Structure

The backend is organized into domain modules within a single Go binary:

```
packages/server/
├── cmd/server/
│   └── main.go                 # Entry point, HTTP/WS server, routing
├── internal/
│   ├── db/                     # Database connections & migrations
│   │   └── db.go
│   ├── models/                 # Shared data models
│   │   └── models.go
│   ├── auth/                   # User authentication domain
│   │   └── auth.go
│   ├── signaling/              # WebRTC signaling domain
│   │   └── signaling.go
│   ├── messaging/              # Persistent chat domain
│   │   └── messaging.go
│   └── storage/                # S3 file storage domain
│       └── storage.go
└── migrations/
    └── 001_initial_schema.sql
```

### Domain Boundaries

**Auth Domain** (`internal/auth`):
- User creation (password, anonymous, wallet)
- Authentication (password, wallet signature)
- Session token generation/validation
- User queries

**Signaling Domain** (`internal/signaling`):
- WebRTC offer/answer/ICE candidate exchange
- Ephemeral room management
- WebSocket connection handling
- Real-time peer coordination

**Messaging Domain** (`internal/messaging`):
- Persistent conversations (direct, group, channel)
- Message storage (encrypted payloads)
- Participant management
- Presence indicators (via Redis)
- Typing indicators (via Redis with TTL)

**Storage Domain** (`internal/storage`):
- Pre-signed upload URLs (client-side encryption)
- Pre-signed download URLs
- Attachment metadata in PostgreSQL
- S3-compatible storage (MinIO/S3/R2)

### Database Schema

**PostgreSQL Tables:**
- `users` - User accounts (password, wallet, anonymous)
- `conversations` - Chat rooms (direct, group, channel)
- `participants` - Conversation membership
- `messages` - Encrypted message payloads
- `attachments` - File references (S3 keys)
- `contacts` - Friend relationships
- `calls` - Call history
- `call_participants` - Call participants

**Redis Keys:**
- `presence:<user_id>` - User online status (hash)
- `typing:<conversation_id>:<user_id>` - Typing indicator (5s TTL)
- `messages:<conversation_id>` - Pub/sub channel for real-time messages

### API Endpoints

**Auth:**
- `POST /api/auth/signup` - Create user with password
- `POST /api/auth/signin` - Login with password
- `POST /api/auth/anonymous` - Create anonymous user
- `POST /api/auth/wallet` - Login/register with wallet

**Users:**
- `GET /api/users/me` - Get current user
- `GET /api/users/{id}` - Get user by ID

**Signaling:**
- `GET /api/signaling?user_id={id}&room_id={id}` - WebSocket connection
- `GET /api/ice-servers` - Get Twilio ICE servers

**Messaging:**
- `GET /api/conversations` - List user's conversations
- `POST /api/conversations` - Create conversation
- `GET /api/conversations/{id}/messages` - Get messages (paginated)
- `POST /api/conversations/{id}/messages` - Send message

**Storage:**
- `POST /api/storage/upload` - Request pre-signed upload URL
- `POST /api/storage/download` - Request pre-signed download URL
- `GET /api/storage/attachments/{id}` - Get attachment metadata

All endpoints except `/health`, `/api/auth/*`, and `/api/ice-servers` require `Authorization: Bearer <token>` header.

### Secure File Upload Flow

1. Client requests upload URL: `POST /api/storage/upload`
2. Server generates pre-signed S3 PUT URL (15min expiry)
3. Client encrypts file locally
4. Client uploads encrypted blob directly to S3 using pre-signed URL
5. Client notifies server with storage key
6. Server records attachment reference in PostgreSQL

Downloads follow similar flow with pre-signed GET URLs.

### WebRTC Signaling Flow

1. Client connects to WebSocket: `GET /api/signaling?user_id=X&room_id=Y`
2. Server sends initial state: `userID`, `initiatorStatus`, `userCount`
3. When meeting starts, clients create offers based on sorted peer IDs
4. Offer/Answer/ICE candidates forwarded through signaling server
5. Media streams established peer-to-peer
6. Chat messages broadcast to all room participants

### Real-time Messaging Flow

1. Client sends message: `POST /api/conversations/{id}/messages`
2. Server stores encrypted payload in PostgreSQL
3. Server publishes notification to Redis pub/sub channel
4. Subscribed clients receive notification and fetch message

## Common Development Tasks

### Adding a New API Endpoint

1. Add handler function in `cmd/server/main.go`
2. Register route in `setupRouter()` function
3. Add middleware if authentication required
4. Implement domain logic in appropriate `internal/` package

### Adding a New Database Table

1. Create migration file in `migrations/` (e.g., `002_add_table.sql`)
2. Add model struct to `internal/models/models.go`
3. Add service methods in relevant domain package
4. Migrations run automatically on server startup

### Adding a New WebSocket Message Type

1. Update `internal/signaling/signaling.go` `HandleMessage` switch statement
2. Add handler function (e.g., `handleXXX`)
3. Update frontend `src/utils/messageHandler.ts` to handle response

### Adding a New Domain

1. Create package in `internal/newdomain/`
2. Define service struct with database dependencies
3. Create `NewService()` constructor
4. Add public methods for domain operations
5. Initialize in `cmd/server/main.go` and add to `Server` struct

## Testing

### Manual Testing with Docker Compose

```bash
# Start all services
docker-compose up

# Test health endpoint
curl http://localhost:8080/health

# Create anonymous user
curl -X POST http://localhost:8080/api/auth/anonymous

# Create user with password
curl -X POST http://localhost:8080/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@test.com","password":"password123"}'

# Access MinIO console
open http://localhost:9001
# Login: minioadmin / minioadmin
```

### Database Migrations

Migrations in `packages/server/migrations/` run automatically on startup. The `schema_migrations` table tracks applied migrations.

To create a new migration:
1. Create file: `migrations/00N_description.sql`
2. Add SQL statements
3. Restart server - migration applies automatically

## Project-Specific Patterns

### Error Handling

- Use `fmt.Errorf("context: %w", err)` for error wrapping
- Return errors to handlers, log in handlers
- Use domain-specific error types (e.g., `auth.ErrUserNotFound`)

### Database Queries

- Use `QueryContext` and `ExecContext` with request context
- Use prepared statements for repeated queries
- Always use `$1, $2` placeholders (PostgreSQL)
- Handle `sql.ErrNoRows` explicitly

### Authentication Flow

1. Extract `Authorization` header in middleware
2. Validate token with `authService.ValidateSessionToken()`
3. Add `userID` to request context
4. Access in handlers: `r.Context().Value("userID").(uuid.UUID)`

### WebSocket Lifecycle

- Upgrade in handler with `upgrader.Upgrade()`
- Add client to signaling service
- Start separate `ReadPump` and `WritePump` goroutines
- Remove client in deferred cleanup

### Redis Pub/Sub

- Subscribe: `messagingService.SubscribeToConversation(ctx, convID)`
- Publish: Automatic in `CreateMessage()`
- Receive: `pubsub.Receive(ctx)` in goroutine

## Deployment Architecture

**Local:** docker-compose with 4 containers (app, postgres, redis, minio)

**Production (Fly.io):**
- App: Single Go binary on Fly.io
- Database: Fly Postgres
- Cache: Fly Redis (or Upstash)
- Storage: AWS S3, Cloudflare R2, or Fly volumes with MinIO

## Migration from Microservices

The previous 8-microservice architecture has been consolidated:

| Old Service | New Location |
|-------------|--------------|
| ice-service | `cmd/server/main.go` - `/api/ice-servers` endpoint |
| signaling-service | `internal/signaling/` domain |
| messaging-service | `internal/messaging/` domain |
| room-service | `internal/signaling/` (ephemeral) + `internal/messaging/` (persistent) |
| users-service | `internal/auth/` domain |
| contacts-service | `internal/auth/` domain (TODO: expand) |
| video-service | `internal/signaling/` domain |
| notification-service | `internal/messaging/` (Redis pub/sub) |

Benefits:
- Single deployment unit (simpler operations)
- Shared database transactions
- Lower latency (no network hops)
- Easier local development
- Clear domain boundaries still maintained

## Zero-Trust Security Layer (E2EE)

nochat.io implements a **zero-trust architecture** where the server never sees user content. All messages and files are end-to-end encrypted client-side before transmission.

> **Note:** For detailed cryptographic implementation audit, see [docs/crypto-inventory.md](./docs/crypto-inventory.md)

### Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| E2EE Messaging | **Deployed** | P-256 ECDH + AES-256-GCM |
| Post-Quantum Crypto | **Planned** | Backend ready, frontend uses classical |
| Sealed Sender | **Planned** | Code prepared, not integrated |
| Double Ratchet | **Planned** | Types defined, not active |

### Cryptographic Primitives (Currently Deployed)

**Asymmetric Algorithms (via Web Crypto API):**
- **P-256 ECDSA**: Digital signatures for identity verification
- **P-256 ECDH**: Key exchange for session key derivation

**Symmetric Encryption:**
- **AES-256-GCM**: Message and file encryption
- **HKDF-SHA256**: Key derivation from shared secrets

**Planned Post-Quantum Algorithms:**
- **ML-KEM (Kyber-1024)**: Key encapsulation (backend supports, frontend prepared)
- **ML-DSA (Dilithium3)**: Digital signatures (backend implemented, frontend uses Ed25519 placeholder)

### Key Types (Current)

| Key Type | Algorithm | Purpose | Lifespan |
|----------|-----------|---------|----------|
| Identity Key | P-256 ECDSA | Long-term identity, signs prekeys | Permanent (rotatable) |
| Exchange Key | P-256 ECDH | Key exchange for session derivation | Permanent (rotatable) |
| Session Key | AES-256 | Per-peer message encryption | Per session |

### Key Types (Planned - PQC)

| Key Type | Algorithm | Purpose | Lifespan |
|----------|-----------|---------|----------|
| Identity Key | Dilithium3 | Long-term identity, signs prekeys | Permanent (rotatable) |
| Signed PreKey | Hybrid X25519+Kyber | Medium-term key exchange | ~7 days |
| One-Time PreKey | Hybrid X25519+Kyber | Single-use forward secrecy | One message |
| Session Key | AES-256 | Per-message encryption | Per ratchet step |

### Backend Crypto Domain (`internal/crypto/`)

```
internal/crypto/
├── pqc.go        # Kyber/Dilithium wrappers (cloudflare/circl)
├── keys.go       # Key storage and management service
└── symmetric.go  # AES-GCM and XChaCha20-Poly1305
```

### Crypto API Endpoints

**Key Management:**
- `POST /api/crypto/keys/identity` - Upload identity public key
- `GET /api/crypto/keys/identity` - Get own identity key
- `POST /api/crypto/keys/prekey` - Upload signed prekey
- `POST /api/crypto/keys/prekeys` - Upload batch of one-time prekeys
- `GET /api/crypto/keys/prekeys/count` - Get remaining OTK count
- `GET /api/crypto/bundles/{user_id}` - Fetch user's prekey bundle
- `GET /api/crypto/keys/status` - Get E2EE readiness status

### Frontend Crypto Module (`packages/web/src/crypto/`)

```
src/crypto/
├── index.ts          # Public exports
├── types.ts          # Type definitions
├── utils.ts          # Base64, hashing, HKDF utilities
├── pqc.ts            # PQC operations (WASM-backed in production)
├── symmetric.ts      # AES-GCM encryption
├── x3dh.ts           # X3DH-style key exchange
├── ratchet.ts        # Double Ratchet implementation
└── CryptoService.ts  # Main service (key management, sessions)
```

### E2EE Protocol Flow (Current)

**Session Establishment (P-256 ECDH):**
1. Alice fetches Bob's prekey bundle from server (P-256 public key)
2. Alice performs ECDH: `sharedSecret = ECDH(Alice.privateKey, Bob.publicKey)`
3. Both parties derive session key: `sessionKey = HKDF(sharedSecret, salt, info, 32)`
4. Salt includes sorted user IDs for deterministic derivation
5. Session key cached in IndexedDB for future messages

**Message Encryption (Current):**
1. Retrieve cached session key for peer
2. Generate random 12-byte nonce
3. Encrypt: `ciphertext = AES-256-GCM(sessionKey, nonce, plaintext)`
4. Pack: `message = Base64(nonce || ciphertext || authTag)`
5. Send via WebSocket or REST API

**Planned: Double Ratchet Protocol (Not Yet Active):**
1. Derive message key from sending chain key
2. Encrypt message with AES-256-GCM
3. Sign ciphertext with identity key
4. Update chain key (ratchet step)
5. On new ephemeral key received, perform DH/KEM ratchet

### WebSocket E2EE Messages

```javascript
// Current: Simple encrypted message (no ratcheting)
{ type: "encryptedMessage", content: {
    target_peer_id: "uuid" | null, // null = broadcast
    ciphertext: "base64",          // AES-256-GCM encrypted
    // Note: nonce is prepended to ciphertext in Base64
}}

// Planned: Key Exchange (for Double Ratchet)
{ type: "keyExchange", content: {
    exchange_type: "initiate" | "response" | "ratchet",
    target_peer_id: "uuid",
    ephemeral_public_key: "base64",
    ciphertext: "base64", // KEM result (Kyber)
    signature: "base64"   // Identity signature
}}

// Planned: Ratcheted message format
{ type: "encryptedMessage", content: {
    target_peer_id: "uuid" | null,
    ciphertext: "base64",
    nonce: "base64",
    ephemeral_key: "base64",
    signature: "base64",
    algorithm: "aes-256-gcm",
    chain_index: 123
}}
```

### Secure File Upload Flow (E2EE)

1. Client generates random file key (32 bytes)
2. Client encrypts file with file key (AES-256-GCM)
3. Client requests pre-signed upload URL
4. Client uploads encrypted blob to S3
5. Client encrypts file key with message session key
6. Client sends encrypted file key + storage reference in message
7. Recipient decrypts file key, then decrypts file

### Database Tables for E2EE

```sql
-- User identity keys (Dilithium public)
identity_keys (user_id, dilithium_public_key, key_fingerprint, key_version)

-- Signed prekeys (Kyber public + Dilithium signature)
signed_prekeys (user_id, key_id, kyber_public_key, signature)

-- One-time prekeys (Kyber public, single-use)
one_time_prekeys (user_id, key_id, kyber_public_key, used_by, used_at)

-- Encrypted session state (server stores opaque blobs)
e2ee_sessions (owner_user_id, peer_user_id, encrypted_session_state)
```

### Zero-Trust Guarantees

**Current Implementation:**
1. **Server sees only opaque blobs**: Message content and file content are encrypted client-side
2. **Per-session forward secrecy**: Each peer pair has a unique session key
3. **Message integrity**: AES-256-GCM (AEAD) detects tampering
4. **Key derivation isolation**: HKDF ensures session keys are unique per peer pair

**Planned Enhancements:**
5. **Per-message forward secrecy**: Double Ratchet with ephemeral keys (not yet active)
6. **Post-quantum resistance**: ML-KEM/ML-DSA (backend ready, frontend prepared)
7. **Identity verification**: Digital signatures on messages (planned)
8. **Metadata protection**: Sealed sender (code exists, not integrated)

### E2EEChatBox Component

Use the `E2EEChatBox` component for encrypted chat:

```tsx
import E2EEChatBox from './components/E2EEChatBox';

<E2EEChatBox
  roomId={roomId}
  userId={userId}
  peers={peerUserIds}
/>
```

Features:
- Automatic key exchange with peers
- Encryption status indicator (lock icon)
- Message signature verification
- Key fingerprint display for verification
