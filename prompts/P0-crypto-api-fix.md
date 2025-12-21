# P0-001: Backend Crypto API Fix + Rate Limiting

| Field | Value |
|-------|-------|
| **Agent Type** | Feature Engineer |
| **Complexity** | Medium |
| **Branch Name** | `fix/crypto-key-upload-400` |
| **Blocked By** | None |
| **Created** | 2024-12 |
| **Updated** | 2024-12 (added rate limiting per research) |
| **Research Basis** | [E2EE Competitive Analysis](./research/e2ee-competitive-analysis.md) |

---

## Objective

1. **Fix the 400 errors** occurring when the frontend attempts to upload E2EE keys to the server
2. **Implement rate limiting** on prekey bundle fetches to prevent exhaustion attacks

Both are required—the 400 fix enables E2EE, and rate limiting prevents a critical vulnerability.

---

## Context

QA testing confirmed that the client successfully generates cryptographic keys (P-256 ECDSA/ECDH keypairs) and stores them in IndexedDB. However, when the client attempts to upload these keys to the server, all requests fail with HTTP 400:

```
[WARNING] [useCrypto] Failed to upload identity key: Error: Request failed: 400
[WARNING] [useCrypto] Failed to upload signed prekey: Error: Request failed: 400
```

Without keys on the server, peers cannot fetch prekey bundles, and ECDH handshakes never occur. This causes the app to fall back to `secureMode: legacy` instead of achieving true zero-trust `p2p` encryption.

### Impact

- All 1:1 DM conversations use legacy encryption
- Zero-trust marketing claims are not met
- `peerSessions` IndexedDB store remains empty

### Critical Security Finding: Prekey Exhaustion Attack

From our [competitive research](./research/e2ee-competitive-analysis.md):

> "An attacker can programmatically query the server, requesting prekey bundles for a specific target user without ever sending a message. Each request prompts the server to serve—and subsequently delete—a one-time prekey from the target's available pool."

**Attack sequence:**
1. Attacker rapidly calls `GET /api/crypto/bundles/{victim_id}`
2. Server serves and deletes one-time prekeys
3. Pool exhausted → server falls back to signed prekey
4. Forward secrecy degraded for all new sessions during fallback period

**WhatsApp is vulnerable to this. We must not be.**

---

## Part 2: Rate Limiting Requirements

### Server-Side Rate Limits

Implement on `GET /api/crypto/bundles/{user_id}`:

| Limit Type | Threshold | Window | Action |
|------------|-----------|--------|--------|
| Per-requester | 10 requests | 1 minute | 429 Too Many Requests |
| Per-target | 50 requests | 1 minute | 429 + alert |
| Per-IP | 100 requests | 1 minute | 429 + temporary block |

### Implementation Approach

```go
// Redis-based rate limiter
func rateLimitBundleFetch(requesterID, targetID, ip string) error {
    // Check per-requester limit
    key := fmt.Sprintf("ratelimit:bundle:requester:%s", requesterID)
    if count := redis.Incr(key); count > 10 {
        return ErrRateLimited
    }
    redis.Expire(key, 60*time.Second)

    // Check per-target limit (detect targeted attacks)
    key = fmt.Sprintf("ratelimit:bundle:target:%s", targetID)
    if count := redis.Incr(key); count > 50 {
        alertSecurityTeam(targetID) // Someone is draining this user's prekeys
        return ErrRateLimited
    }
    redis.Expire(key, 60*time.Second)

    return nil
}
```

### Client-Side Prekey Replenishment

Frontend must aggressively maintain prekey pool:

```typescript
// On app startup and periodically (every 5 min when active)
async function checkAndReplenishPrekeys() {
    const count = await api.get('/api/crypto/keys/prekeys/count');
    if (count < 50) {
        const newKeys = await generateOneTimePrekeys(100);
        await api.post('/api/crypto/keys/prekeys', { keys: newKeys });
    }
}
```

---

## Relevant Files

### Backend
- `packages/server/cmd/server/main.go` - Route registration
- `packages/server/internal/crypto/` - Crypto domain
  - `keys.go` - Key storage service
  - `pqc.go` - PQC wrappers (if applicable)
- `packages/server/migrations/` - Database schema

### Frontend
- `packages/web/src/hooks/use-crypto.ts` - Frontend upload logic
- `packages/web/src/crypto/CryptoService.ts` - Key generation and API calls
- `packages/web/src/lib/api.ts` - HTTP client

---

## Investigation Checklist

1. [ ] Confirm `/api/crypto/keys/identity` route exists in `main.go`
2. [ ] Confirm `/api/crypto/keys/prekey` route exists in `main.go`
3. [ ] Verify crypto service is initialized in `main()` and passed to handlers
4. [ ] Compare frontend request payload structure against backend handler expectations
5. [ ] Check if database tables exist:
   - `identity_keys`
   - `signed_prekeys`
   - `one_time_prekeys`
6. [ ] Test endpoints manually with curl to isolate frontend vs backend issue:

```bash
# Get a valid auth token first
TOKEN="<your_token>"

# Test identity key upload
curl -X POST http://localhost:8080/api/crypto/keys/identity \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"public_key": "base64...", "key_fingerprint": "abc123"}' \
  -v

# Check response code and body
```

7. [ ] Review server logs for detailed error messages
8. [ ] Check if auth middleware is correctly extracting user ID

---

## Acceptance Criteria

### Part 1: Fix 400 Errors
- [ ] `POST /api/crypto/keys/identity` returns 200/201 with valid payload
- [ ] `POST /api/crypto/keys/prekey` returns 200/201 with valid payload
- [ ] `POST /api/crypto/keys/prekeys` (batch OTK upload) returns 200/201
- [ ] No 400 errors in browser console during key initialization
- [ ] `GET /api/crypto/bundles/{user_id}` returns the uploaded keys
- [ ] Keys persist across page refresh (verify in IndexedDB and database)

### Part 2: Rate Limiting
- [ ] Bundle fetch rate limited per requester (10/min)
- [ ] Bundle fetch rate limited per target (50/min)
- [ ] 429 response returned when rate limit exceeded
- [ ] Rate limit uses Redis for distributed counting
- [ ] Client replenishes prekeys when count < 50
- [ ] `GET /api/crypto/keys/prekeys/count` endpoint returns user's OTK count

---

## Constraints

**Do NOT:**
- Modify the key generation logic (that's working correctly)
- Change the cryptographic algorithms (P-256 ECDSA/ECDH)
- Skip authentication middleware on these endpoints
- Store private keys on the server (only public keys)
- Log key material in production logs

---

## Testing

After fix, verify:

1. Fresh anonymous user signup
2. Console shows successful key uploads (no errors)
3. Check PostgreSQL for key records:
   ```sql
   SELECT * FROM identity_keys WHERE user_id = '<uuid>';
   SELECT * FROM signed_prekeys WHERE user_id = '<uuid>';
   ```
4. Another user can fetch the prekey bundle:
   ```bash
   curl http://localhost:8080/api/crypto/bundles/<user_id> \
     -H "Authorization: Bearer $TOKEN"
   ```

---

## Related

- Blocks: [P0-002: ECDH Session Establishment](./P0-ecdh-session-establishment.md)
- QA Report: `.playwright-mcp/` directory
