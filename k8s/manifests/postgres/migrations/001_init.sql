CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    name VARCHAR(255) NOT NULL,
    wallet_address VARCHAR(42) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (email IS NOT NULL AND wallet_address IS NULL) OR
        (email IS NULL AND wallet_address IS NOT NULL)
    )
);

CREATE TABLE contacts (
    user_id UUID REFERENCES users(id),
    contact_id UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, contact_id)
); 