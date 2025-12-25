-- Migration: Phone Contact Discovery
-- Implements WhatsApp-style contact discovery via phone numbers

-- Add phone number fields to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash VARCHAR(64); -- SHA-256 hash for matching

-- Phone verification codes for SMS OTP
CREATE TABLE IF NOT EXISTS phone_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    attempts INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Uploaded contact hashes (for discovery)
-- Users upload SHA-256 hashes of their phone contacts
-- Server re-hashes with pepper for matching
CREATE TABLE IF NOT EXISTS contact_hashes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone_hash VARCHAR(64) NOT NULL, -- SHA-256 of normalized phone number
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, phone_hash)
);

-- Discovery notification queue
-- When a new user verifies their phone, notify users who have that contact
CREATE TABLE IF NOT EXISTS discovery_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    discovered_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notified_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, discovered_user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_phone_verifications_user ON phone_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_expires ON phone_verifications(expires_at) WHERE verified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_hashes_user ON contact_hashes(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_hashes_hash ON contact_hashes(phone_hash);
CREATE INDEX IF NOT EXISTS idx_users_phone_hash ON users(phone_hash) WHERE phone_verified = true;
CREATE INDEX IF NOT EXISTS idx_users_phone_verified ON users(id) WHERE phone_verified = true;
CREATE INDEX IF NOT EXISTS idx_discovery_queue_pending ON discovery_queue(user_id) WHERE notified = false;
CREATE INDEX IF NOT EXISTS idx_discovery_queue_user ON discovery_queue(user_id, created_at DESC);
