//! Session Storage
//!
//! This module handles the secure storage and retrieval of cryptographic sessions
//! in the local SQLite database. Sessions are encrypted with a device-specific
//! key before storage.

use sqlx::{Row, SqlitePool};

use crate::crypto::errors::{CryptoError, CryptoResult};
use crate::crypto::ratchet::{OlmAccount, PickleKey, RatchetSession};

/// Manages storage and retrieval of cryptographic sessions
pub struct SessionStore {
    /// Database connection pool
    db: SqlitePool,
    /// Key for encrypting session state before storage
    pickle_key: PickleKey,
}

impl SessionStore {
    /// Create a new session store
    pub fn new(db: SqlitePool, pickle_key: PickleKey) -> Self {
        Self { db, pickle_key }
    }

    /// Save or update the Olm account
    pub async fn save_account(&self, account: &OlmAccount) -> CryptoResult<()> {
        let pickled = account.pickle(&self.pickle_key)?;
        let identity_key = hex::encode(account.identity_key().to_bytes());

        sqlx::query(
            r#"
            INSERT INTO crypto_account (id, identity_key, account_data, updated_at)
            VALUES (1, $1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                account_data = excluded.account_data,
                updated_at = CURRENT_TIMESTAMP
            "#
        )
        .bind(&identity_key)
        .bind(&pickled)
        .execute(&self.db)
        .await?;

        Ok(())
    }

    /// Load the Olm account
    pub async fn load_account(&self) -> CryptoResult<Option<OlmAccount>> {
        let result = sqlx::query(
            r#"SELECT account_data FROM crypto_account WHERE id = 1"#
        )
        .fetch_optional(&self.db)
        .await?;

        match result {
            Some(row) => {
                let account_data: String = row.get("account_data");
                let account = OlmAccount::from_pickle(&account_data, &self.pickle_key)?;
                Ok(Some(account))
            }
            None => Ok(None),
        }
    }

    /// Save or update a session with a peer
    pub async fn save_session(&self, session: &RatchetSession) -> CryptoResult<()> {
        let pickled = session.pickle(&self.pickle_key)?;
        let session_id = session.session_id();

        sqlx::query(
            r#"
            INSERT INTO peer_sessions (id, peer_id, session_data, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT(peer_id) DO UPDATE SET
                session_data = excluded.session_data,
                updated_at = CURRENT_TIMESTAMP
            "#
        )
        .bind(&session_id)
        .bind(&session.peer_id)
        .bind(&pickled)
        .execute(&self.db)
        .await?;

        Ok(())
    }

    /// Load a session for a specific peer
    pub async fn load_session(&self, peer_id: &str) -> CryptoResult<Option<RatchetSession>> {
        let result = sqlx::query(
            r#"SELECT session_data FROM peer_sessions WHERE peer_id = $1"#
        )
        .bind(peer_id)
        .fetch_optional(&self.db)
        .await?;

        match result {
            Some(row) => {
                let session_data: String = row.get("session_data");
                let session = RatchetSession::unpickle(&session_data, &self.pickle_key)?;
                Ok(Some(session))
            }
            None => Ok(None),
        }
    }

    /// Check if a session exists for a peer
    pub async fn has_session(&self, peer_id: &str) -> CryptoResult<bool> {
        let result = sqlx::query(
            r#"SELECT 1 FROM peer_sessions WHERE peer_id = $1"#
        )
        .bind(peer_id)
        .fetch_optional(&self.db)
        .await?;

        Ok(result.is_some())
    }

    /// Delete a session for a peer
    pub async fn delete_session(&self, peer_id: &str) -> CryptoResult<()> {
        sqlx::query(r#"DELETE FROM peer_sessions WHERE peer_id = $1"#)
            .bind(peer_id)
            .execute(&self.db)
            .await?;

        Ok(())
    }

    /// Delete all sessions (for logout)
    pub async fn delete_all_sessions(&self) -> CryptoResult<()> {
        sqlx::query(r#"DELETE FROM peer_sessions"#)
            .execute(&self.db)
            .await?;

        Ok(())
    }

    /// Get all peer IDs with active sessions
    pub async fn list_peers(&self) -> CryptoResult<Vec<String>> {
        let results = sqlx::query(r#"SELECT peer_id FROM peer_sessions"#)
            .fetch_all(&self.db)
            .await?;

        Ok(results.into_iter().map(|r| r.get("peer_id")).collect())
    }

    /// Save identity key for persistence
    pub async fn save_identity_key(
        &self,
        public_key: &[u8],
        encrypted_secret: &[u8],
    ) -> CryptoResult<()> {
        use base64::Engine;

        let public_hex = hex::encode(public_key);
        let secret_b64 = base64::engine::general_purpose::STANDARD.encode(encrypted_secret);

        sqlx::query(
            r#"
            INSERT INTO crypto_keys (id, key_type, public_key, private_key, created_at)
            VALUES ('identity', 'identity', $1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                public_key = excluded.public_key,
                private_key = excluded.private_key
            "#
        )
        .bind(&public_hex)
        .bind(&secret_b64)
        .execute(&self.db)
        .await?;

        Ok(())
    }

    /// Load identity key
    pub async fn load_identity_key(&self) -> CryptoResult<Option<(Vec<u8>, Vec<u8>)>> {
        use base64::Engine;

        let result = sqlx::query(
            r#"SELECT public_key, private_key FROM crypto_keys WHERE id = 'identity'"#
        )
        .fetch_optional(&self.db)
        .await?;

        match result {
            Some(row) => {
                let public_key: String = row.get("public_key");
                let private_key: String = row.get("private_key");

                let public = hex::decode(&public_key).map_err(|e| {
                    CryptoError::SerializationError(format!("Failed to decode public key: {}", e))
                })?;
                let secret = base64::engine::general_purpose::STANDARD
                    .decode(&private_key)
                    .map_err(|e| {
                        CryptoError::SerializationError(format!("Failed to decode secret key: {}", e))
                    })?;
                Ok(Some((public, secret)))
            }
            None => Ok(None),
        }
    }

    /// Save signed prekey
    pub async fn save_signed_prekey(
        &self,
        key_id: u32,
        public_key: &[u8],
        encrypted_secret: &[u8],
        signature: &[u8],
        created_at: i64,
    ) -> CryptoResult<()> {
        use base64::Engine;

        let id = format!("signed_prekey_{}", key_id);
        let public_hex = hex::encode(public_key);
        let secret_b64 = base64::engine::general_purpose::STANDARD.encode(encrypted_secret);
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature);

        sqlx::query(
            r#"
            INSERT INTO crypto_keys (id, key_type, public_key, private_key, signature, key_id, created_at)
            VALUES ($1, 'signed_prekey', $2, $3, $4, $5, datetime($6, 'unixepoch'))
            ON CONFLICT(id) DO UPDATE SET
                public_key = excluded.public_key,
                private_key = excluded.private_key,
                signature = excluded.signature
            "#
        )
        .bind(&id)
        .bind(&public_hex)
        .bind(&secret_b64)
        .bind(&sig_b64)
        .bind(key_id as i64)
        .bind(created_at)
        .execute(&self.db)
        .await?;

        Ok(())
    }

    /// Save one-time prekeys
    pub async fn save_one_time_prekeys(
        &self,
        prekeys: &[(u32, Vec<u8>, Vec<u8>)], // (key_id, public, encrypted_secret)
    ) -> CryptoResult<()> {
        use base64::Engine;

        for (key_id, public, secret) in prekeys {
            let id = format!("otk_{}", key_id);
            let public_hex = hex::encode(public);
            let secret_b64 = base64::engine::general_purpose::STANDARD.encode(secret);

            sqlx::query(
                r#"
                INSERT INTO crypto_keys (id, key_type, public_key, private_key, key_id, created_at)
                VALUES ($1, 'one_time_prekey', $2, $3, $4, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO NOTHING
                "#
            )
            .bind(&id)
            .bind(&public_hex)
            .bind(&secret_b64)
            .bind(*key_id as i64)
            .execute(&self.db)
            .await?;
        }

        Ok(())
    }

    /// Delete a one-time prekey (after it's been used)
    pub async fn delete_one_time_prekey(&self, key_id: u32) -> CryptoResult<()> {
        let id = format!("otk_{}", key_id);

        sqlx::query(r#"DELETE FROM crypto_keys WHERE id = $1"#)
            .bind(&id)
            .execute(&self.db)
            .await?;

        Ok(())
    }

    /// Get count of remaining one-time prekeys
    pub async fn count_one_time_prekeys(&self) -> CryptoResult<i64> {
        let result = sqlx::query(
            r#"SELECT COUNT(*) as count FROM crypto_keys WHERE key_type = 'one_time_prekey'"#
        )
        .fetch_one(&self.db)
        .await?;

        Ok(result.get::<i64, _>("count"))
    }

    /// Delete all crypto keys (for account deletion)
    pub async fn delete_all_keys(&self) -> CryptoResult<()> {
        sqlx::query(r#"DELETE FROM crypto_keys"#)
            .execute(&self.db)
            .await?;

        sqlx::query(r#"DELETE FROM crypto_account"#)
            .execute(&self.db)
            .await?;

        Ok(())
    }
}

/// Derive a pickle key from the user's password or device secret
pub fn derive_pickle_key(secret: &[u8], salt: &[u8]) -> PickleKey {
    use hkdf::Hkdf;
    use sha2::Sha256;

    let hkdf = Hkdf::<Sha256>::new(Some(salt), secret);
    let mut key = [0u8; 32];
    hkdf.expand(b"NoChat Pickle Key v1", &mut key).unwrap();
    key
}

/// Generate a random pickle key (for new accounts)
pub fn generate_pickle_key() -> PickleKey {
    use rand::RngCore;
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: These tests require a database connection
    // In practice, use a test database or mock

    #[test]
    fn test_derive_pickle_key() {
        let secret = b"user_password";
        let salt = b"random_salt_123";

        let key1 = derive_pickle_key(secret, salt);
        let key2 = derive_pickle_key(secret, salt);

        // Same inputs should produce same key
        assert_eq!(key1, key2);

        // Different salt should produce different key
        let key3 = derive_pickle_key(secret, b"different_salt");
        assert_ne!(key1, key3);
    }

    #[test]
    fn test_generate_pickle_key() {
        let key1 = generate_pickle_key();
        let key2 = generate_pickle_key();

        // Should be different (random)
        assert_ne!(key1, key2);
        assert_eq!(key1.len(), 32);
    }
}
