-- PQC Cryptography Tables for Zero-Trust E2EE

-- Identity Keys (Dilithium3 public keys for digital signatures)
-- Each user has one long-term identity key used for signing prekey bundles
CREATE TABLE IF NOT EXISTS identity_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Dilithium3 public key (1952 bytes)
    dilithium_public_key BYTEA NOT NULL,
    -- Key fingerprint for verification (SHA-256 of public key)
    key_fingerprint VARCHAR(64) NOT NULL,
    -- Version for key rotation tracking
    key_version INTEGER NOT NULL DEFAULT 1,
    -- Status: active, rotated, revoked
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'revoked')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    rotated_at TIMESTAMP WITH TIME ZONE,
    -- Only one active identity key per user
    CONSTRAINT unique_active_identity_key UNIQUE (user_id, status)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_identity_keys_user ON identity_keys(user_id);
CREATE INDEX idx_identity_keys_fingerprint ON identity_keys(key_fingerprint);

-- Signed Pre-Keys (Kyber1024 for PQC key exchange)
-- These are medium-term keys signed by the identity key
-- Rotated periodically (e.g., weekly)
CREATE TABLE IF NOT EXISTS signed_prekeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Key ID for client-side reference
    key_id INTEGER NOT NULL,
    -- Kyber1024 public key (1568 bytes)
    kyber_public_key BYTEA NOT NULL,
    -- Dilithium signature of the Kyber public key
    signature BYTEA NOT NULL,
    -- Key fingerprint
    key_fingerprint VARCHAR(64) NOT NULL,
    -- Status: active, rotated, expired
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'expired')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    rotated_at TIMESTAMP WITH TIME ZONE,
    -- Only one active signed prekey per user (latest)
    UNIQUE(user_id, key_id)
);

CREATE INDEX idx_signed_prekeys_user ON signed_prekeys(user_id, status);

-- One-Time Pre-Keys (Kyber1024)
-- Single-use keys for initial key exchange (X3DH-style protocol)
-- Provides forward secrecy for initial messages
CREATE TABLE IF NOT EXISTS one_time_prekeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Key ID for client-side reference
    key_id INTEGER NOT NULL,
    -- Kyber1024 public key (1568 bytes)
    kyber_public_key BYTEA NOT NULL,
    -- Status: available, used, expired
    status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'used', 'expired')),
    -- Who used this key (for audit)
    used_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, key_id)
);

CREATE INDEX idx_one_time_prekeys_user_available ON one_time_prekeys(user_id, status) WHERE status = 'available';

-- Key Bundles Cache
-- Cached key bundles for offline message delivery
CREATE TABLE IF NOT EXISTS key_bundles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Serialized key bundle (JSON or protocol buffer)
    bundle_data BYTEA NOT NULL,
    -- Bundle version (incremented on any key change)
    bundle_version INTEGER NOT NULL DEFAULT 1,
    -- Timestamp for cache invalidation
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- E2EE Session State
-- Tracks encrypted session state between two users
-- Server never sees plaintext keys, only encrypted ratchet state blobs
CREATE TABLE IF NOT EXISTS e2ee_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Conversation this session belongs to
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    -- The user who owns this session state
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The peer user this session is with
    peer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Encrypted session state (encrypted by owner's device key)
    -- Server cannot read this - only stores opaque blob
    encrypted_session_state BYTEA NOT NULL,
    -- Ratchet chain index (for ordering/deduplication)
    send_chain_index INTEGER NOT NULL DEFAULT 0,
    receive_chain_index INTEGER NOT NULL DEFAULT 0,
    -- Session creation metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- One session per (owner, peer, conversation) tuple
    UNIQUE(conversation_id, owner_user_id, peer_user_id)
);

CREATE INDEX idx_e2ee_sessions_owner ON e2ee_sessions(owner_user_id);
CREATE INDEX idx_e2ee_sessions_conversation ON e2ee_sessions(conversation_id);

-- Message Encryption Metadata
-- Tracks encryption metadata per message (server-visible, non-sensitive)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encryption_version INTEGER DEFAULT 1;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_key_id INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ephemeral_key BYTEA;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS signature BYTEA;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS one_time_prekey_id UUID REFERENCES one_time_prekeys(id) ON DELETE SET NULL;

-- Device Management (for multi-device support)
CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Device identifier (fingerprint or random ID)
    device_id VARCHAR(64) NOT NULL,
    -- Device display name
    device_name VARCHAR(255),
    -- Device-specific Kyber public key for encrypting session states
    device_public_key BYTEA NOT NULL,
    -- Device status
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    -- Last activity
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, device_id)
);

CREATE INDEX idx_user_devices_user ON user_devices(user_id, status);

-- Key Rotation History (for audit trail)
CREATE TABLE IF NOT EXISTS key_rotation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_type VARCHAR(50) NOT NULL CHECK (key_type IN ('identity', 'signed_prekey', 'device')),
    old_key_fingerprint VARCHAR(64),
    new_key_fingerprint VARCHAR(64) NOT NULL,
    reason VARCHAR(50) CHECK (reason IN ('scheduled', 'compromised', 'manual', 'initial')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_key_rotation_log_user ON key_rotation_log(user_id, created_at DESC);

-- Trigger to update key_bundles when keys change
CREATE OR REPLACE FUNCTION invalidate_key_bundle()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE key_bundles
    SET bundle_version = bundle_version + 1,
        updated_at = NOW()
    WHERE user_id = COALESCE(NEW.user_id, OLD.user_id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Triggers on key tables
CREATE TRIGGER invalidate_bundle_on_identity_change
    AFTER INSERT OR UPDATE OR DELETE ON identity_keys
    FOR EACH ROW EXECUTE FUNCTION invalidate_key_bundle();

CREATE TRIGGER invalidate_bundle_on_prekey_change
    AFTER INSERT OR UPDATE OR DELETE ON signed_prekeys
    FOR EACH ROW EXECUTE FUNCTION invalidate_key_bundle();

CREATE TRIGGER invalidate_bundle_on_otk_change
    AFTER INSERT OR UPDATE OR DELETE ON one_time_prekeys
    FOR EACH ROW EXECUTE FUNCTION invalidate_key_bundle();

-- Function to claim a one-time prekey atomically
CREATE OR REPLACE FUNCTION claim_one_time_prekey(
    target_user_id UUID,
    claiming_user_id UUID
) RETURNS TABLE (
    prekey_id UUID,
    key_id INTEGER,
    kyber_public_key BYTEA
) AS $$
DECLARE
    claimed_key RECORD;
BEGIN
    -- Atomically select and mark a prekey as used
    UPDATE one_time_prekeys
    SET status = 'used',
        used_by = claiming_user_id,
        used_at = NOW()
    WHERE id = (
        SELECT id FROM one_time_prekeys
        WHERE user_id = target_user_id
          AND status = 'available'
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING id, one_time_prekeys.key_id, one_time_prekeys.kyber_public_key
    INTO claimed_key;

    IF claimed_key IS NULL THEN
        RETURN;
    END IF;

    prekey_id := claimed_key.id;
    key_id := claimed_key.key_id;
    kyber_public_key := claimed_key.kyber_public_key;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;
