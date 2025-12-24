-- NoChat Desktop - Signal Protocol Migration
-- Adds tables for vodozemac-based end-to-end encryption

-- ============================================================================
-- Crypto Account Table
-- ============================================================================
-- Stores the serialized Olm account (identity keys + one-time key state)
-- Only one account per device
CREATE TABLE IF NOT EXISTS crypto_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- Ensure only one account
    identity_key TEXT NOT NULL,             -- Hex-encoded Curve25519 public key
    account_data TEXT NOT NULL,             -- Pickled (encrypted) account state
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- Update Crypto Keys Table
-- ============================================================================
-- Add columns needed for Signal Protocol keys
ALTER TABLE crypto_keys ADD COLUMN signature TEXT;  -- For signed prekeys
ALTER TABLE crypto_keys ADD COLUMN key_id INTEGER;  -- Numeric key identifier

-- Remove the user_id constraint and update key_type check
-- Note: SQLite doesn't support DROP CONSTRAINT, so we handle this in code
-- The old columns will be ignored, new ones will be used

-- ============================================================================
-- Update Peer Sessions Table
-- ============================================================================
-- Modify to store vodozemac session state
ALTER TABLE peer_sessions ADD COLUMN session_data TEXT;  -- Pickled session
ALTER TABLE peer_sessions ADD COLUMN peer_id TEXT;       -- Hex identity key

-- Create index on peer_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_peer_sessions_peer_id ON peer_sessions(peer_id);

-- ============================================================================
-- Prekey Upload Tracking Table
-- ============================================================================
-- Tracks which prekeys have been uploaded to the server
CREATE TABLE IF NOT EXISTS prekey_uploads (
    key_id INTEGER PRIMARY KEY,
    key_type TEXT NOT NULL CHECK (key_type IN ('signed', 'one_time')),
    uploaded_at TEXT DEFAULT (datetime('now')),
    consumed_at TEXT,
    consumed_by TEXT  -- User ID of who consumed it
);

-- Index for finding unconsumed prekeys
CREATE INDEX IF NOT EXISTS idx_prekey_uploads_unconsumed ON prekey_uploads(key_type, consumed_at);
