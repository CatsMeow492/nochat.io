-- PQXDH Hybrid Keys Migration
-- Adds X25519 EC key support alongside existing Kyber PQ keys for hybrid PQXDH

-- Add EC public key column to signed_prekeys for X25519 component
ALTER TABLE signed_prekeys
ADD COLUMN IF NOT EXISTS ec_public_key BYTEA;

-- Add hybrid version to track key type
-- 1 = legacy (EC-only or PQ-only)
-- 2 = PQXDH hybrid (X25519 + Kyber-1024)
ALTER TABLE signed_prekeys
ADD COLUMN IF NOT EXISTS hybrid_version INTEGER DEFAULT 1;

-- Add EC public key column to one_time_prekeys for X25519 component
ALTER TABLE one_time_prekeys
ADD COLUMN IF NOT EXISTS ec_public_key BYTEA;

-- Add hybrid version to one_time_prekeys
ALTER TABLE one_time_prekeys
ADD COLUMN IF NOT EXISTS hybrid_version INTEGER DEFAULT 1;

-- Create index for efficient hybrid key lookups
CREATE INDEX IF NOT EXISTS idx_signed_prekeys_hybrid
ON signed_prekeys(user_id, hybrid_version)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_one_time_prekeys_hybrid
ON one_time_prekeys(user_id, hybrid_version)
WHERE status = 'available';

-- Comment on columns to document hybrid PQXDH structure
COMMENT ON COLUMN signed_prekeys.ec_public_key IS 'X25519 public key (32 bytes) for hybrid PQXDH - null for legacy keys';
COMMENT ON COLUMN signed_prekeys.hybrid_version IS 'Key version: 1=legacy (EC or PQ only), 2=PQXDH hybrid (X25519+Kyber)';
COMMENT ON COLUMN one_time_prekeys.ec_public_key IS 'X25519 public key (32 bytes) for hybrid PQXDH - null for legacy keys';
COMMENT ON COLUMN one_time_prekeys.hybrid_version IS 'Key version: 1=legacy (EC or PQ only), 2=PQXDH hybrid (X25519+Kyber)';

-- Update the claim function to also return EC key for hybrid prekeys
CREATE OR REPLACE FUNCTION claim_one_time_prekey(
    target_user_id UUID,
    claiming_user_id UUID
) RETURNS TABLE (
    prekey_id UUID,
    key_id INTEGER,
    kyber_public_key BYTEA,
    ec_public_key BYTEA,
    hybrid_version INTEGER
) AS $$
DECLARE
    claimed_key RECORD;
BEGIN
    -- Atomically select and mark a prekey as used
    UPDATE one_time_prekeys otp
    SET status = 'used',
        used_by = claiming_user_id,
        used_at = NOW()
    WHERE otp.id = (
        SELECT id FROM one_time_prekeys
        WHERE user_id = target_user_id
          AND status = 'available'
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING otp.id, otp.key_id, otp.kyber_public_key, otp.ec_public_key, COALESCE(otp.hybrid_version, 1)
    INTO claimed_key;

    IF claimed_key IS NULL THEN
        RETURN;
    END IF;

    prekey_id := claimed_key.id;
    key_id := claimed_key.key_id;
    kyber_public_key := claimed_key.kyber_public_key;
    ec_public_key := claimed_key.ec_public_key;
    hybrid_version := claimed_key.hybrid_version;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;
