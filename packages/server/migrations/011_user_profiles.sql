-- Add extended profile fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS company VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS relationship_status VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pronouns VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday DATE;

-- Create index for location-based queries (future feature)
CREATE INDEX IF NOT EXISTS idx_users_location ON users(location) WHERE location IS NOT NULL;

-- Add constraint for relationship_status values
ALTER TABLE users ADD CONSTRAINT users_relationship_status_check
    CHECK (relationship_status IS NULL OR relationship_status IN (
        'single',
        'in_a_relationship',
        'engaged',
        'married',
        'its_complicated',
        'open_relationship',
        'prefer_not_to_say'
    ));
