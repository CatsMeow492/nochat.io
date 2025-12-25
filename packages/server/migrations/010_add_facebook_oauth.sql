-- Add Facebook as an allowed OAuth provider
ALTER TABLE oauth_accounts DROP CONSTRAINT IF EXISTS oauth_accounts_provider_check;
ALTER TABLE oauth_accounts ADD CONSTRAINT oauth_accounts_provider_check
    CHECK (provider IN ('google', 'github', 'apple', 'facebook'));
