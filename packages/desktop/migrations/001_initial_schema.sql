-- NoChat Desktop - Initial Schema
-- This schema provides local caching and offline support
--
-- Note: PRAGMA journal_mode=WAL and PRAGMA synchronous=NORMAL are set
-- at connection time in the Rust code, not in migrations (they can't run
-- inside a transaction).

-- ============================================================================
-- Users Table (Local Cache)
-- ============================================================================
-- Caches user information for offline access and display
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    is_anonymous INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for username lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================================
-- Sessions Table
-- ============================================================================
-- Stores authentication tokens for session persistence
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for finding active sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============================================================================
-- Conversations Table
-- ============================================================================
-- Caches conversation metadata
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('direct', 'group', 'channel')),
    name TEXT,
    last_message_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for sorting by recent activity
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);

-- ============================================================================
-- Participants Table
-- ============================================================================
-- Tracks conversation membership
CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at TEXT DEFAULT (datetime('now')),
    last_read_at TEXT,
    is_muted INTEGER DEFAULT 0,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    UNIQUE(conversation_id, user_id)
);

-- Indices for participant queries
CREATE INDEX IF NOT EXISTS idx_participants_conversation ON participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(user_id);

-- ============================================================================
-- Messages Table
-- ============================================================================
-- Stores encrypted message content locally
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    encrypted_content TEXT NOT NULL,
    message_type TEXT DEFAULT 'text',
    encryption_version INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Index for fetching messages by conversation (paginated, descending)
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

-- ============================================================================
-- Crypto Keys Table
-- ============================================================================
-- Stores cryptographic keys (private keys encrypted with device key)
-- IMPORTANT: These keys never leave the device
CREATE TABLE IF NOT EXISTS crypto_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key_type TEXT NOT NULL CHECK (key_type IN ('identity', 'signed_prekey', 'one_time_prekey', 'session')),
    public_key BLOB NOT NULL,
    private_key BLOB NOT NULL,  -- Encrypted with device master key
    key_version INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    UNIQUE(user_id, key_type, key_version)
);

-- Index for key lookups
CREATE INDEX IF NOT EXISTS idx_crypto_keys_user ON crypto_keys(user_id, key_type);

-- ============================================================================
-- Peer Sessions Table
-- ============================================================================
-- Stores E2EE session state with each peer
CREATE TABLE IF NOT EXISTS peer_sessions (
    id TEXT PRIMARY KEY,
    peer_user_id TEXT NOT NULL,
    peer_public_key BLOB NOT NULL,
    session_key BLOB NOT NULL,  -- Derived shared secret
    ratchet_state BLOB,         -- Double Ratchet state (Phase 2)
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(peer_user_id)
);

-- Index for peer lookups
CREATE INDEX IF NOT EXISTS idx_peer_sessions_peer ON peer_sessions(peer_user_id);

-- ============================================================================
-- Settings Table
-- ============================================================================
-- Key-value storage for user preferences
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('theme', '"system"'),
    ('notifications_enabled', 'true'),
    ('sound_enabled', 'true'),
    ('auto_start', 'false'),
    ('minimize_to_tray', 'true');

-- ============================================================================
-- Attachments Table
-- ============================================================================
-- References to encrypted file attachments
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT,
    storage_key TEXT NOT NULL,  -- S3/storage reference
    encryption_key BLOB,        -- File-specific encryption key (encrypted)
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Index for message attachments
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
