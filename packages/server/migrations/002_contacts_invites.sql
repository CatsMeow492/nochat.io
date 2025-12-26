-- Migration: Add invite codes and user settings tables
-- The contacts table already exists from 001_initial_schema.sql

-- Invite codes for shareable contact links
CREATE TABLE IF NOT EXISTS invite_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(16) UNIQUE NOT NULL,
    max_uses INT DEFAULT NULL, -- NULL means unlimited
    use_count INT DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE, -- NULL means never expires
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User settings (extensible for future settings)
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    require_contact_approval BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invite_codes_user ON invite_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code) WHERE is_active = true;

-- Triggers for updated_at
CREATE TRIGGER update_invite_codes_updated_at BEFORE UPDATE ON invite_codes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
