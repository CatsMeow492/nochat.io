-- Sealed Sender Migration
-- Hides message sender identity from the server for metadata protection

-- Sealed Sender Keys Table
-- Each user has a Kyber public key for receiving sealed sender messages
-- The server stores ONLY the public key; private key stays on client
CREATE TABLE IF NOT EXISTS sealed_sender_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Kyber1024 public key (1568 bytes) for encrypting sealed envelopes
    kyber_public_key BYTEA NOT NULL,
    -- Key fingerprint for verification (SHA-256 of public key, first 16 hex chars)
    key_fingerprint VARCHAR(64) NOT NULL,
    -- Version for key rotation tracking
    key_version INTEGER NOT NULL DEFAULT 1,
    -- Status: active, rotated, expired
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'expired')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Keys expire after 30 days by default
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '30 days',
    rotated_at TIMESTAMP WITH TIME ZONE
);

-- Only one active sealed sender key per user
CREATE UNIQUE INDEX idx_sealed_sender_keys_user_active
ON sealed_sender_keys(user_id)
WHERE status = 'active';

CREATE INDEX idx_sealed_sender_keys_fingerprint ON sealed_sender_keys(key_fingerprint);

-- Sealed Sender Attempt Tracking
-- Used for rate limiting invalid token attempts (spam prevention)
-- Server cannot validate tokens (would reveal sender), but can rate limit failures
CREATE TABLE IF NOT EXISTS sealed_sender_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The recipient receiving sealed messages
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- SHA-256 hash of the delivery token (server cannot reverse to sender)
    token_hash VARCHAR(64) NOT NULL,
    -- Whether the recipient verified the token as valid
    -- (null = pending, true = valid, false = invalid)
    valid BOOLEAN,
    -- Timestamp for rate limiting windows
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- IP address for distributed attack detection
    ip_address INET
);

CREATE INDEX idx_sealed_sender_attempts_recipient_time
ON sealed_sender_attempts(recipient_id, created_at DESC);

CREATE INDEX idx_sealed_sender_attempts_rate_limit
ON sealed_sender_attempts(recipient_id, valid, created_at)
WHERE valid = false;

-- User Sealed Sender Preferences
ALTER TABLE users ADD COLUMN IF NOT EXISTS sealed_sender_enabled BOOLEAN DEFAULT true;

-- Delivery Verifier: public value included in prekey bundles
-- Combined with shared secret to generate delivery tokens
-- Format: 32 random bytes, regenerated on each bundle fetch
ALTER TABLE users ADD COLUMN IF NOT EXISTS delivery_verifier BYTEA;

-- Message Sealed Sender Columns
-- Mark messages that use sealed sender (sender_id will be NULL)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_sealed BOOLEAN DEFAULT false;

-- For group messages with fanout optimization:
-- Store the shared encrypted envelope once, sealed keys stored per-recipient
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted_envelope BYTEA;

-- Timestamp bucket for sealed messages (15-minute windows)
-- True timestamp is inside the encrypted envelope
ALTER TABLE messages ADD COLUMN IF NOT EXISTS timestamp_bucket TIMESTAMP WITH TIME ZONE;

-- Make sender_id nullable for sealed messages
-- The actual sender is encrypted inside the sealed envelope
ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;

-- Add check constraint: sealed messages must not have visible sender_id
-- Non-sealed messages must have sender_id
ALTER TABLE messages ADD CONSTRAINT sealed_sender_check
CHECK (
    (is_sealed = true AND sender_id IS NULL) OR
    (is_sealed = false AND sender_id IS NOT NULL) OR
    (is_sealed IS NULL AND sender_id IS NOT NULL)
);

-- Sealed Keys for Group Fanout
-- When sending sealed group messages, store per-recipient sealed content keys
CREATE TABLE IF NOT EXISTS sealed_message_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The message this key is for
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    -- The recipient who can decrypt this key
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The content key sealed (KEM encrypted) to this recipient
    -- Recipient decapsulates to get content key, then decrypts encrypted_envelope
    sealed_content_key BYTEA NOT NULL,
    -- Ephemeral public key for KEM decapsulation
    ephemeral_public_key BYTEA NOT NULL,
    -- KEM ciphertext
    kem_ciphertext BYTEA NOT NULL,
    -- Delivery token for this recipient
    delivery_token_hash VARCHAR(64) NOT NULL,
    -- Delivery token validation status
    token_valid BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(message_id, recipient_id)
);

CREATE INDEX idx_sealed_message_keys_recipient
ON sealed_message_keys(recipient_id, created_at DESC);

CREATE INDEX idx_sealed_message_keys_message
ON sealed_message_keys(message_id);

-- Rate Limiting Function for Sealed Sender
-- Returns true if the recipient can receive more sealed messages
CREATE OR REPLACE FUNCTION check_sealed_sender_rate_limit(
    p_recipient_id UUID,
    p_max_invalid_per_hour INTEGER DEFAULT 10
) RETURNS BOOLEAN AS $$
DECLARE
    invalid_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_count
    FROM sealed_sender_attempts
    WHERE recipient_id = p_recipient_id
      AND valid = false
      AND created_at > NOW() - INTERVAL '1 hour';

    RETURN invalid_count < p_max_invalid_per_hour;
END;
$$ LANGUAGE plpgsql;

-- Function to record a sealed sender attempt
CREATE OR REPLACE FUNCTION record_sealed_sender_attempt(
    p_recipient_id UUID,
    p_token_hash VARCHAR(64),
    p_valid BOOLEAN,
    p_ip_address INET DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO sealed_sender_attempts (recipient_id, token_hash, valid, ip_address)
    VALUES (p_recipient_id, p_token_hash, p_valid, p_ip_address);

    -- Clean up old attempts (keep last 7 days)
    DELETE FROM sealed_sender_attempts
    WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Trigger to invalidate key bundles when sealed sender keys change
CREATE TRIGGER invalidate_bundle_on_sealed_sender_key_change
    AFTER INSERT OR UPDATE OR DELETE ON sealed_sender_keys
    FOR EACH ROW EXECUTE FUNCTION invalidate_key_bundle();

-- Add sealed sender key to key rotation log types
ALTER TABLE key_rotation_log DROP CONSTRAINT IF EXISTS key_rotation_log_key_type_check;
ALTER TABLE key_rotation_log ADD CONSTRAINT key_rotation_log_key_type_check
CHECK (key_type IN ('identity', 'signed_prekey', 'device', 'sealed_sender'));

-- Comments for documentation
COMMENT ON TABLE sealed_sender_keys IS 'Kyber public keys for receiving sealed sender messages. Private key stored only on client.';
COMMENT ON TABLE sealed_sender_attempts IS 'Rate limiting for sealed sender delivery tokens. Server cannot validate tokens, only rate limit failures.';
COMMENT ON TABLE sealed_message_keys IS 'Per-recipient sealed content keys for group message fanout optimization.';
COMMENT ON COLUMN messages.is_sealed IS 'True if message uses sealed sender (sender_id hidden from server)';
COMMENT ON COLUMN messages.encrypted_envelope IS 'Shared encrypted inner envelope for group sealed messages';
COMMENT ON COLUMN messages.timestamp_bucket IS '15-minute bucket for sealed messages (true timestamp inside envelope)';
COMMENT ON COLUMN users.sealed_sender_enabled IS 'Whether user accepts sealed sender messages (default true)';
COMMENT ON COLUMN users.delivery_verifier IS 'Public verifier for delivery token generation (included in prekey bundle)';
