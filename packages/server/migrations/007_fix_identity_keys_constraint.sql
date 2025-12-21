-- Fix identity_keys unique constraint
--
-- The original constraint UNIQUE(user_id, status) was incorrect:
-- It limited users to having only ONE key per status, preventing
-- multiple rotated keys (which is a valid scenario after key rotations).
--
-- The intent was to enforce only ONE active key per user.
-- We fix this by replacing the constraint with a partial unique index.

-- Drop the broken constraint (name from migration 002)
ALTER TABLE identity_keys DROP CONSTRAINT IF EXISTS unique_active_identity_key;

-- Create a partial unique index that only enforces uniqueness on active keys
-- This allows multiple rotated/revoked keys but only one active key per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_keys_unique_active
ON identity_keys(user_id)
WHERE status = 'active';

-- Comment for clarity
COMMENT ON INDEX idx_identity_keys_unique_active IS 'Ensures only one active identity key per user while allowing multiple rotated/revoked keys';
