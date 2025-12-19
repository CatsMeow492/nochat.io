-- E2EE Fields for Attachments

-- Add E2EE fields to attachments table for encrypted file storage
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS encrypted_file_key BYTEA;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS file_key_nonce BYTEA;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS file_key_algorithm VARCHAR(50);
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS checksum_sha256 VARCHAR(64);

-- Comment on the E2EE flow
COMMENT ON COLUMN attachments.encrypted_file_key IS 'File encryption key encrypted with the message key. Client encrypts file with random key K, then encrypts K with message session key.';
COMMENT ON COLUMN attachments.file_key_nonce IS 'Nonce/IV used when encrypting the file key';
COMMENT ON COLUMN attachments.file_key_algorithm IS 'Algorithm used: aes-256-gcm or xchacha20-poly1305';
COMMENT ON COLUMN attachments.checksum_sha256 IS 'SHA-256 hash of the encrypted file blob for integrity verification';
