//! CryptoService - High-level encryption API
//!
//! This module provides the main interface for end-to-end encryption in NoChat.
//! It manages key generation, session establishment, and message encryption/decryption.
//!
//! ## Example
//!
//! ```rust,ignore
//! use crate::crypto::CryptoService;
//!
//! // Initialize the crypto service
//! let service = CryptoService::initialize(db_pool).await?;
//!
//! // Establish a session with a peer
//! let bundle = fetch_prekey_bundle(peer_id).await?;
//! service.establish_outbound_session(peer_id, &bundle).await?;
//!
//! // Encrypt a message
//! let ciphertext = service.encrypt(peer_id, b"Hello!").await?;
//!
//! // Decrypt a message
//! let plaintext = service.decrypt(peer_id, &ciphertext).await?;
//! ```

use std::sync::Arc;
use tokio::sync::RwLock;
use sqlx::SqlitePool;
use vodozemac::Curve25519PublicKey;

use crate::crypto::errors::{CryptoError, CryptoResult};
// PreKeyBundle available via crate::crypto::x3dh if needed for session establishment
use crate::crypto::ratchet::{EncryptedMessage, OlmAccount, PickleKey, RatchetSession};
use crate::crypto::sessions::{derive_pickle_key, generate_pickle_key, SessionStore};

/// High-level encryption service
///
/// Thread-safe wrapper around all cryptographic operations.
pub struct CryptoService {
    /// The Olm account (identity + one-time keys)
    account: Arc<RwLock<OlmAccount>>,
    /// Session storage
    store: SessionStore,
    /// Active sessions cache (peer_id -> session)
    sessions: Arc<RwLock<std::collections::HashMap<String, RatchetSession>>>,
    /// Pickle key for encrypting stored sessions
    pickle_key: PickleKey,
}

impl CryptoService {
    /// Initialize the crypto service
    ///
    /// This will either load an existing account from the database or create a new one.
    pub async fn initialize(db: SqlitePool) -> CryptoResult<Self> {
        // For now, generate a random pickle key
        // In production, this should be derived from user credentials or device secret
        let pickle_key = generate_pickle_key();
        let store = SessionStore::new(db.clone(), pickle_key);

        // Try to load existing account
        let account = match store.load_account().await? {
            Some(account) => {
                tracing::info!("Loaded existing crypto account");
                account
            }
            None => {
                tracing::info!("Creating new crypto account");
                let mut account = OlmAccount::new();
                // Generate initial one-time keys
                account.generate_one_time_keys(100);
                account.mark_keys_as_published();
                // Save the new account
                store.save_account(&account).await?;
                account
            }
        };

        // Load existing sessions into cache
        let mut sessions = std::collections::HashMap::new();
        for peer_id in store.list_peers().await? {
            if let Some(session) = store.load_session(&peer_id).await? {
                sessions.insert(peer_id, session);
            }
        }

        Ok(Self {
            account: Arc::new(RwLock::new(account)),
            store,
            sessions: Arc::new(RwLock::new(sessions)),
            pickle_key,
        })
    }

    /// Initialize with a derived pickle key
    pub async fn initialize_with_key(db: SqlitePool, secret: &[u8], salt: &[u8]) -> CryptoResult<Self> {
        let pickle_key = derive_pickle_key(secret, salt);
        let store = SessionStore::new(db.clone(), pickle_key);

        let account = match store.load_account().await? {
            Some(account) => account,
            None => {
                let mut account = OlmAccount::new();
                account.generate_one_time_keys(100);
                account.mark_keys_as_published();
                store.save_account(&account).await?;
                account
            }
        };

        let mut sessions = std::collections::HashMap::new();
        for peer_id in store.list_peers().await? {
            if let Some(session) = store.load_session(&peer_id).await? {
                sessions.insert(peer_id, session);
            }
        }

        Ok(Self {
            account: Arc::new(RwLock::new(account)),
            store,
            sessions: Arc::new(RwLock::new(sessions)),
            pickle_key,
        })
    }

    /// Get our identity public key (for sharing with peers)
    pub async fn identity_key(&self) -> Vec<u8> {
        let account = self.account.read().await;
        account.identity_key().to_bytes().to_vec()
    }

    /// Get our Ed25519 signing key
    pub async fn signing_key(&self) -> Vec<u8> {
        let account = self.account.read().await;
        account.signing_key().as_bytes().to_vec()
    }

    /// Get one-time keys to upload to the server
    pub async fn get_one_time_keys(&self) -> Vec<(String, Vec<u8>)> {
        let account = self.account.read().await;
        account
            .one_time_keys()
            .into_iter()
            .map(|(id, key)| (id.to_base64(), key.to_bytes().to_vec()))
            .collect()
    }

    /// Generate and get new one-time keys
    pub async fn generate_one_time_keys(&self, count: usize) -> CryptoResult<Vec<(String, Vec<u8>)>> {
        let mut account = self.account.write().await;
        account.generate_one_time_keys(count);

        let keys: Vec<_> = account
            .one_time_keys()
            .into_iter()
            .map(|(id, key)| (id.to_base64(), key.to_bytes().to_vec()))
            .collect();

        // Save account state
        self.store.save_account(&account).await?;

        Ok(keys)
    }

    /// Mark one-time keys as published
    pub async fn mark_keys_as_published(&self) -> CryptoResult<()> {
        let mut account = self.account.write().await;
        account.mark_keys_as_published();
        self.store.save_account(&account).await?;
        Ok(())
    }

    /// Check if we have a session with a peer
    pub async fn has_session(&self, peer_id: &str) -> bool {
        let sessions = self.sessions.read().await;
        sessions.contains_key(peer_id)
    }

    /// Establish an outbound session with a peer
    ///
    /// Use this when initiating a conversation with someone.
    pub async fn establish_outbound_session(
        &self,
        peer_id: &str,
        their_identity_key: &[u8],
        their_one_time_key: &[u8],
    ) -> CryptoResult<()> {
        let identity = Curve25519PublicKey::from_slice(their_identity_key)?;
        let one_time = Curve25519PublicKey::from_slice(their_one_time_key)?;

        let mut account = self.account.write().await;
        let session = account.create_outbound_session(identity, one_time)?;

        // Save account (one-time key may have been used)
        self.store.save_account(&account).await?;

        // Save session
        self.store.save_session(&session).await?;

        // Add to cache
        let mut sessions = self.sessions.write().await;
        sessions.insert(peer_id.to_string(), session);

        tracing::info!("Established outbound session with peer: {}", peer_id);
        Ok(())
    }

    /// Establish an inbound session from a received message
    ///
    /// Use this when receiving the first message from a new peer.
    pub async fn establish_inbound_session(
        &self,
        peer_id: &str,
        their_identity_key: &[u8],
        ciphertext: &[u8],
    ) -> CryptoResult<Vec<u8>> {
        let identity = Curve25519PublicKey::from_slice(their_identity_key)?;
        let encrypted = EncryptedMessage::from_bytes(ciphertext)?;
        let olm_message = encrypted.to_olm()?;

        let mut account = self.account.write().await;
        let (session, plaintext) = account.create_inbound_session(identity, &olm_message)?;

        // Save account (one-time key was consumed)
        self.store.save_account(&account).await?;

        // Save session
        self.store.save_session(&session).await?;

        // Add to cache
        let mut sessions = self.sessions.write().await;
        sessions.insert(peer_id.to_string(), session);

        tracing::info!("Established inbound session with peer: {}", peer_id);
        Ok(plaintext)
    }

    /// Encrypt a message for a peer
    ///
    /// The peer must have an established session.
    pub async fn encrypt(&self, peer_id: &str, plaintext: &[u8]) -> CryptoResult<Vec<u8>> {
        let mut sessions = self.sessions.write().await;

        let session = sessions
            .get_mut(peer_id)
            .ok_or_else(|| CryptoError::SessionNotFound(peer_id.to_string()))?;

        let olm_message = session.encrypt(plaintext);
        let encrypted = EncryptedMessage::from_olm(&olm_message);

        // Save session state (ratchet advanced)
        self.store.save_session(session).await?;

        Ok(encrypted.to_bytes())
    }

    /// Decrypt a message from a peer
    ///
    /// If no session exists, this will attempt to create one from the message.
    pub async fn decrypt(
        &self,
        peer_id: &str,
        their_identity_key: Option<&[u8]>,
        ciphertext: &[u8],
    ) -> CryptoResult<Vec<u8>> {
        let mut sessions = self.sessions.write().await;

        // Check if we have an existing session
        if let Some(session) = sessions.get_mut(peer_id) {
            let encrypted = EncryptedMessage::from_bytes(ciphertext)?;
            let olm_message = encrypted.to_olm()?;

            let plaintext = session.decrypt(&olm_message)?;

            // Save session state
            self.store.save_session(session).await?;

            return Ok(plaintext);
        }

        // No existing session - try to create inbound session
        drop(sessions); // Release lock before calling establish_inbound_session

        let identity_key = their_identity_key.ok_or_else(|| {
            CryptoError::SessionNotFound(format!(
                "No session for {} and no identity key provided",
                peer_id
            ))
        })?;

        self.establish_inbound_session(peer_id, identity_key, ciphertext).await
    }

    /// Delete a session with a peer
    pub async fn delete_session(&self, peer_id: &str) -> CryptoResult<()> {
        let mut sessions = self.sessions.write().await;
        sessions.remove(peer_id);
        self.store.delete_session(peer_id).await?;
        Ok(())
    }

    /// Delete all sessions (for logout)
    pub async fn delete_all_sessions(&self) -> CryptoResult<()> {
        let mut sessions = self.sessions.write().await;
        sessions.clear();
        self.store.delete_all_sessions().await?;
        Ok(())
    }

    /// Get statistics about all sessions
    pub async fn get_session_stats(&self) -> Vec<crate::crypto::ratchet::SessionStats> {
        let sessions = self.sessions.read().await;
        sessions.values().map(|s| s.stats()).collect()
    }

    /// Get remaining one-time key count
    pub async fn one_time_key_count(&self) -> CryptoResult<i64> {
        self.store.count_one_time_prekeys().await
    }

    /// Check if we need to generate more one-time keys
    pub async fn needs_more_keys(&self) -> bool {
        match self.one_time_key_count().await {
            Ok(count) => count < 25,
            Err(_) => true,
        }
    }

    /// Get identity key fingerprint for verification
    pub async fn fingerprint(&self) -> String {
        use sha2::{Digest, Sha256};
        let key = self.identity_key().await;
        let hash = Sha256::digest(&key);
        hex::encode(&hash[..8])
    }

    /// Persist current state to database
    pub async fn persist(&self) -> CryptoResult<()> {
        let account = self.account.read().await;
        self.store.save_account(&account).await?;

        let sessions = self.sessions.read().await;
        for session in sessions.values() {
            self.store.save_session(session).await?;
        }

        Ok(())
    }

    /// Get the pickle key (for session export or backup)
    pub fn pickle_key(&self) -> &PickleKey {
        &self.pickle_key
    }
}

/// Encryption mode for hybrid protocol support
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncryptionMode {
    /// Legacy P-256 ECDH (for web clients)
    Legacy,
    /// Signal Protocol (vodozemac)
    Signal,
}

/// Wrapper for encrypted message with mode indicator
#[derive(Debug, Clone)]
pub struct HybridEncryptedMessage {
    /// Encryption mode used
    pub mode: EncryptionMode,
    /// The encrypted data
    pub ciphertext: Vec<u8>,
    /// Sender's identity key (for session establishment)
    pub sender_identity: Option<Vec<u8>>,
}

impl HybridEncryptedMessage {
    /// Create a Signal protocol message
    pub fn signal(ciphertext: Vec<u8>, sender_identity: Option<Vec<u8>>) -> Self {
        Self {
            mode: EncryptionMode::Signal,
            ciphertext,
            sender_identity,
        }
    }

    /// Create a legacy protocol message
    pub fn legacy(ciphertext: Vec<u8>) -> Self {
        Self {
            mode: EncryptionMode::Legacy,
            ciphertext,
            sender_identity: None,
        }
    }

    /// Serialize for transmission
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();

        // Version/mode byte
        bytes.push(match self.mode {
            EncryptionMode::Legacy => 0,
            EncryptionMode::Signal => 1,
        });

        // Sender identity (if present)
        if let Some(ref identity) = self.sender_identity {
            bytes.push(identity.len() as u8);
            bytes.extend_from_slice(identity);
        } else {
            bytes.push(0);
        }

        // Ciphertext
        bytes.extend_from_slice(&self.ciphertext);
        bytes
    }

    /// Deserialize from transmission
    pub fn from_bytes(bytes: &[u8]) -> CryptoResult<Self> {
        if bytes.len() < 2 {
            return Err(CryptoError::DecryptionError("Message too short".to_string()));
        }

        let mode = match bytes[0] {
            0 => EncryptionMode::Legacy,
            1 => EncryptionMode::Signal,
            v => return Err(CryptoError::DecryptionError(format!("Unknown version: {}", v))),
        };

        let identity_len = bytes[1] as usize;
        if bytes.len() < 2 + identity_len {
            return Err(CryptoError::DecryptionError("Message truncated".to_string()));
        }

        let sender_identity = if identity_len > 0 {
            Some(bytes[2..2 + identity_len].to_vec())
        } else {
            None
        };

        let ciphertext = bytes[2 + identity_len..].to_vec();

        Ok(Self {
            mode,
            ciphertext,
            sender_identity,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hybrid_message_serialization() {
        let msg = HybridEncryptedMessage::signal(
            vec![1, 2, 3, 4],
            Some(vec![0xAA; 32]),
        );

        let bytes = msg.to_bytes();
        let restored = HybridEncryptedMessage::from_bytes(&bytes).unwrap();

        assert_eq!(restored.mode, EncryptionMode::Signal);
        assert_eq!(restored.ciphertext, vec![1, 2, 3, 4]);
        assert_eq!(restored.sender_identity, Some(vec![0xAA; 32]));
    }

    #[test]
    fn test_legacy_message_serialization() {
        let msg = HybridEncryptedMessage::legacy(vec![5, 6, 7, 8]);

        let bytes = msg.to_bytes();
        let restored = HybridEncryptedMessage::from_bytes(&bytes).unwrap();

        assert_eq!(restored.mode, EncryptionMode::Legacy);
        assert_eq!(restored.ciphertext, vec![5, 6, 7, 8]);
        assert_eq!(restored.sender_identity, None);
    }
}
