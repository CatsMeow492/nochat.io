ALTER TABLE users ADD COLUMN password_hash VARCHAR(255);

-- Update the check constraint to allow email+password or wallet_address
ALTER TABLE users DROP CONSTRAINT users_email_check;
ALTER TABLE users ADD CONSTRAINT users_auth_check CHECK (
    (email IS NOT NULL AND password_hash IS NOT NULL AND wallet_address IS NULL) OR
    (email IS NULL AND password_hash IS NULL AND wallet_address IS NOT NULL)
); 