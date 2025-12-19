# nochat.io Server - Modular Monolith

Secure messaging and video conferencing backend built as a modular monolith in Go.

## Quick Start

### Local Development with Docker Compose

```bash
# From project root
cd ../..
docker-compose up

# Server will be available at http://localhost:8080
# MinIO console at http://localhost:9001
```

### Native Development

```bash
# Install dependencies
go mod download

# Set environment variables
export DATABASE_URL="postgres://nochat:nochat_dev_password@localhost:5432/nochat?sslmode=disable"
export REDIS_URL="localhost:6379"
export S3_ENDPOINT="localhost:9000"
export S3_ACCESS_KEY="minioadmin"
export S3_SECRET_KEY="minioadmin"
export S3_BUCKET="nochat-files"
export S3_USE_SSL="false"

# Run server
go run cmd/server/main.go
```

## Architecture

This is a **modular monolith** - a single deployable binary organized into domain modules:

- **Auth Domain** - User authentication (password, wallet, anonymous)
- **Signaling Domain** - WebRTC signaling for calls
- **Messaging Domain** - Persistent chat (groups, channels, DMs)
- **Storage Domain** - Encrypted file storage (S3-compatible)

## Testing the API

```bash
# Health check
curl http://localhost:8080/health

# Create anonymous user
curl -X POST http://localhost:8080/api/auth/anonymous

# Create user with password
curl -X POST http://localhost:8080/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@example.com","password":"password123"}'
```

See CLAUDE.md for complete API documentation and architecture details.

## Deployment

### Fly.io

```bash
fly auth login
fly launch
fly secrets set DATABASE_URL=postgres://...
fly deploy
```

See fly.toml for configuration.
