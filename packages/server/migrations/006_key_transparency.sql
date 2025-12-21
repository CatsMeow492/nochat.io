-- Key Transparency: Auditable Key Directory (AKD) with Merkle Trees
-- This enables cryptographic verification that the server serves consistent keys to all users.
-- Eliminates the need for manual Safety Number verification.

-- ============================================================================
-- Merkle Tree Nodes (Sparse Merkle Tree)
-- ============================================================================

-- Sparse Merkle Tree nodes
-- Each node is identified by (epoch, depth, path_prefix)
-- Path is the SHA-256 hash of user_id, giving 256 bits of path
CREATE TABLE IF NOT EXISTS merkle_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Epoch this node belongs to (incrementing tree version)
    epoch BIGINT NOT NULL,
    -- Depth in tree (0=root, 256=leaf for SHA-256 SMT)
    depth INTEGER NOT NULL CHECK (depth >= 0 AND depth <= 256),
    -- Path from root as hex string (prefix for internal nodes, full for leaves)
    -- For depth N, this is the first N bits of the path encoded as hex
    path_prefix VARCHAR(64) NOT NULL, -- Hex-encoded (up to 256 bits = 64 hex chars)
    -- SHA-256 hash of this node
    node_hash BYTEA NOT NULL CHECK (length(node_hash) = 32),
    -- For leaf nodes: the actual leaf data (JSON)
    leaf_data JSONB,
    -- Is this a leaf node?
    is_leaf BOOLEAN NOT NULL DEFAULT false,
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Composite key for efficient lookups
    UNIQUE(epoch, depth, path_prefix)
);

-- Index for efficient tree traversal
CREATE INDEX IF NOT EXISTS idx_merkle_nodes_epoch_depth ON merkle_nodes(epoch, depth);
CREATE INDEX IF NOT EXISTS idx_merkle_nodes_epoch_path ON merkle_nodes(epoch, path_prefix);
CREATE INDEX IF NOT EXISTS idx_merkle_nodes_epoch_leaf ON merkle_nodes(epoch) WHERE is_leaf = true;

-- ============================================================================
-- Transparency Log Epochs (Signed Tree Heads)
-- ============================================================================

-- Each epoch represents a signed tree head (STH)
-- The signature proves the root hash was endorsed by the server at a specific time
CREATE TABLE IF NOT EXISTS transparency_epochs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Monotonically increasing epoch number
    epoch_number BIGINT NOT NULL UNIQUE,
    -- Root hash of the Merkle tree at this epoch
    root_hash BYTEA NOT NULL CHECK (length(root_hash) = 32),
    -- Number of entries (users with keys) in this epoch
    tree_size BIGINT NOT NULL,
    -- Signature over (epoch_number || root_hash || tree_size || timestamp)
    -- Ed25519 signature (64 bytes) or P-256 ECDSA (up to 72 bytes)
    signature BYTEA NOT NULL,
    -- Signing key fingerprint (for key rotation support)
    signing_key_fingerprint VARCHAR(64) NOT NULL,
    -- Timestamp when this epoch was created
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epochs_created ON transparency_epochs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_epochs_number ON transparency_epochs(epoch_number DESC);

-- ============================================================================
-- Key Directory Entries (Leaf Data)
-- ============================================================================

-- Current key directory state for each user
-- This is the authoritative source; Merkle tree reflects this
CREATE TABLE IF NOT EXISTS key_directory_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- User this entry belongs to
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- SHA-256 of user_id for SMT path computation (precomputed for efficiency)
    user_id_hash BYTEA NOT NULL CHECK (length(user_id_hash) = 32),
    -- Identity key fingerprint (from identity_keys table)
    identity_key_fingerprint VARCHAR(64) NOT NULL,
    -- Signed prekey fingerprint (optional, from signed_prekeys table)
    signed_prekey_fingerprint VARCHAR(64),
    -- Key bundle version (increments on any key change)
    key_version INTEGER NOT NULL DEFAULT 1,
    -- Last update epoch
    last_epoch BIGINT NOT NULL,
    -- Leaf value = H(user_id || identity_fingerprint || prekey_fingerprint || version || timestamp)
    leaf_hash BYTEA NOT NULL CHECK (length(leaf_hash) = 32),
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- One entry per user
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_key_directory_user ON key_directory_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_key_directory_hash ON key_directory_entries(user_id_hash);
CREATE INDEX IF NOT EXISTS idx_key_directory_epoch ON key_directory_entries(last_epoch);

-- ============================================================================
-- Audit Log for External Auditors
-- ============================================================================

-- Public audit log entries (append-only)
-- Uses pseudonymous commitments to protect user privacy while enabling auditing
CREATE TABLE IF NOT EXISTS transparency_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Epoch this log entry is for
    epoch_number BIGINT NOT NULL,
    -- Type of change: 'key_added', 'key_updated', 'key_revoked'
    change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('key_added', 'key_updated', 'key_revoked')),
    -- Pseudonymous user identifier (H(user_id || epoch_salt)) - hides actual user ID
    user_id_commitment BYTEA NOT NULL CHECK (length(user_id_commitment) = 32),
    -- Old leaf hash (null for additions)
    old_leaf_hash BYTEA CHECK (old_leaf_hash IS NULL OR length(old_leaf_hash) = 32),
    -- New leaf hash (null for revocations)
    new_leaf_hash BYTEA CHECK (new_leaf_hash IS NULL OR length(new_leaf_hash) = 32),
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_epoch ON transparency_audit_log(epoch_number);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON transparency_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_type ON transparency_audit_log(change_type);

-- Add foreign key after epochs table exists
ALTER TABLE transparency_audit_log
    ADD CONSTRAINT fk_audit_log_epoch
    FOREIGN KEY (epoch_number) REFERENCES transparency_epochs(epoch_number)
    ON DELETE CASCADE;

-- ============================================================================
-- Client Monitoring State
-- ============================================================================

-- Track what epochs clients have verified (for consistency proofs)
-- Allows server to know which proofs the client needs
CREATE TABLE IF NOT EXISTS client_transparency_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Client's user ID
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Device ID for multi-device support
    device_id VARCHAR(64) NOT NULL,
    -- Last verified epoch
    last_verified_epoch BIGINT NOT NULL,
    -- Last verified root hash (to detect tampering)
    last_verified_root_hash BYTEA NOT NULL CHECK (length(last_verified_root_hash) = 32),
    -- Last verification timestamp
    verified_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- One entry per (user, device) pair
    UNIQUE(user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_client_state_user ON client_transparency_state(user_id);
CREATE INDEX IF NOT EXISTS idx_client_state_device ON client_transparency_state(user_id, device_id);

-- ============================================================================
-- Signing Key Management
-- ============================================================================

-- Transparency signing keys (public keys only - private stored securely elsewhere)
-- Clients use these to verify signed tree heads
CREATE TABLE IF NOT EXISTS transparency_signing_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Key fingerprint (SHA-256 of public key, first 32 hex chars)
    key_fingerprint VARCHAR(64) NOT NULL UNIQUE,
    -- Public key bytes (Ed25519: 32 bytes, P-256: 65 bytes compressed)
    public_key BYTEA NOT NULL,
    -- Key algorithm
    algorithm VARCHAR(20) NOT NULL CHECK (algorithm IN ('ed25519', 'p256')),
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'revoked')),
    -- Valid time range
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE,
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signing_keys_status ON transparency_signing_keys(status);
CREATE INDEX IF NOT EXISTS idx_signing_keys_fingerprint ON transparency_signing_keys(key_fingerprint);

-- ============================================================================
-- Pending Updates Queue
-- ============================================================================

-- Queue for key updates waiting to be batched into next epoch
-- Processed by background batch processor every 60 seconds
CREATE TABLE IF NOT EXISTS transparency_pending_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- User whose key changed
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Type of update
    update_type VARCHAR(20) NOT NULL CHECK (update_type IN ('key_added', 'key_updated', 'key_revoked')),
    -- Identity key fingerprint
    identity_key_fingerprint VARCHAR(64) NOT NULL,
    -- Signed prekey fingerprint (optional)
    signed_prekey_fingerprint VARCHAR(64),
    -- Key version
    key_version INTEGER NOT NULL,
    -- When the update was queued
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Processing status
    processed BOOLEAN NOT NULL DEFAULT false,
    processed_at TIMESTAMP WITH TIME ZONE,
    processed_epoch BIGINT
);

CREATE INDEX IF NOT EXISTS idx_pending_updates_unprocessed ON transparency_pending_updates(created_at) WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_pending_updates_user ON transparency_pending_updates(user_id);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to compute user ID hash for SMT path
CREATE OR REPLACE FUNCTION compute_user_id_hash(p_user_id UUID) RETURNS BYTEA AS $$
BEGIN
    RETURN digest(p_user_id::TEXT, 'sha256');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to compute leaf hash from key data
CREATE OR REPLACE FUNCTION compute_transparency_leaf_hash(
    p_user_id UUID,
    p_identity_fingerprint VARCHAR(64),
    p_prekey_fingerprint VARCHAR(64),
    p_version INTEGER,
    p_timestamp TIMESTAMP WITH TIME ZONE
) RETURNS BYTEA AS $$
DECLARE
    v_data TEXT;
BEGIN
    v_data := p_user_id::TEXT || '|' ||
              p_identity_fingerprint || '|' ||
              COALESCE(p_prekey_fingerprint, '') || '|' ||
              p_version::TEXT || '|' ||
              EXTRACT(EPOCH FROM p_timestamp)::BIGINT::TEXT;
    RETURN digest(v_data, 'sha256');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get the current epoch number
CREATE OR REPLACE FUNCTION get_current_transparency_epoch() RETURNS BIGINT AS $$
DECLARE
    v_epoch BIGINT;
BEGIN
    SELECT COALESCE(MAX(epoch_number), 0) INTO v_epoch FROM transparency_epochs;
    RETURN v_epoch;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Trigger to update timestamps
-- ============================================================================

CREATE OR REPLACE FUNCTION update_key_directory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_key_directory_updated_at ON key_directory_entries;
CREATE TRIGGER trigger_key_directory_updated_at
    BEFORE UPDATE ON key_directory_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_key_directory_updated_at();

-- ============================================================================
-- Initial epoch (epoch 0 with empty tree)
-- ============================================================================

-- Create the genesis epoch with empty tree root
-- The empty tree root is H(H(empty) || H(empty)) computed recursively
-- For a 256-bit SMT, this is a well-known constant
DO $$
BEGIN
    -- Check if genesis epoch exists
    IF NOT EXISTS (SELECT 1 FROM transparency_epochs WHERE epoch_number = 0) THEN
        -- Insert genesis epoch with placeholder values
        -- The actual root hash will be computed when the first key is added
        -- For now, use all zeros to indicate empty tree
        INSERT INTO transparency_epochs (
            epoch_number,
            root_hash,
            tree_size,
            signature,
            signing_key_fingerprint
        ) VALUES (
            0,
            decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
            0,
            decode('', 'hex'), -- Empty signature for genesis
            'genesis'
        );
    END IF;
END;
$$;
