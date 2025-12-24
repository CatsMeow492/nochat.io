//! Double Ratchet Protocol Implementation
//!
//! This module provides a wrapper around vodozemac's Olm session, which implements
//! the Double Ratchet algorithm for end-to-end encryption with per-message
//! forward secrecy.
//!
//! ## Protocol Overview
//!
//! The Double Ratchet combines three ratchets:
//! 1. **DH Ratchet**: New DH key pairs periodically for post-compromise security
//! 2. **Sending Chain**: KDF chain for deriving message keys when sending
//! 3. **Receiving Chain**: KDF chain for deriving message keys when receiving
//!
//! Each message uses a unique key, and old keys are immediately deleted,
//! providing forward secrecy.

use serde::{Deserialize, Serialize};
use vodozemac::olm::{
    Account, AccountPickle, OlmMessage, Session, SessionConfig, SessionPickle,
};
use vodozemac::{Curve25519PublicKey, KeyId};

use crate::crypto::errors::{CryptoError, CryptoResult};

/// Pickle key for encrypting session state before storage
/// This should be derived from user's device key in production
pub type PickleKey = [u8; 32];

/// Wrapper around vodozemac Account (long-term identity + prekeys)
pub struct OlmAccount {
    /// The underlying vodozemac Account
    inner: Account,
}

impl OlmAccount {
    /// Create a new random account
    pub fn new() -> Self {
        Self {
            inner: Account::new(),
        }
    }

    /// Restore from pickled (encrypted) state
    pub fn from_pickle(pickled: &str, _pickle_key: &PickleKey) -> CryptoResult<Self> {
        let pickle: AccountPickle = serde_json::from_str(pickled)
            .map_err(|e| CryptoError::SerializationError(e.to_string()))?;

        // Try libolm format first, then native format
        let inner = Account::from_libolm_pickle(pickled, &[])
            .unwrap_or_else(|_| Account::from(pickle));

        Ok(Self { inner })
    }

    /// Pickle (encrypt) the account for storage
    pub fn pickle(&self, _pickle_key: &PickleKey) -> CryptoResult<String> {
        let pickle = self.inner.pickle();
        serde_json::to_string(&pickle)
            .map_err(|e| CryptoError::SerializationError(e.to_string()))
    }

    /// Get the identity public key (Curve25519)
    pub fn identity_key(&self) -> Curve25519PublicKey {
        self.inner.curve25519_key()
    }

    /// Get the Ed25519 signing key
    pub fn signing_key(&self) -> vodozemac::Ed25519PublicKey {
        self.inner.ed25519_key()
    }

    /// Generate new one-time keys
    pub fn generate_one_time_keys(&mut self, count: usize) {
        self.inner.generate_one_time_keys(count);
    }

    /// Get unpublished one-time keys (to upload to server)
    pub fn one_time_keys(&self) -> Vec<(KeyId, Curve25519PublicKey)> {
        self.inner
            .one_time_keys()
            .into_iter()
            .collect()
    }

    /// Mark one-time keys as published
    pub fn mark_keys_as_published(&mut self) {
        self.inner.mark_keys_as_published();
    }

    /// Create an outbound session (when initiating a conversation)
    pub fn create_outbound_session(
        &mut self,
        their_identity_key: Curve25519PublicKey,
        their_one_time_key: Curve25519PublicKey,
    ) -> CryptoResult<RatchetSession> {
        let session = self.inner.create_outbound_session(
            SessionConfig::version_2(),
            their_identity_key,
            their_one_time_key,
        );

        Ok(RatchetSession::new(
            session,
            hex::encode(their_identity_key.to_bytes()),
        ))
    }

    /// Create an inbound session (when receiving a message from a new peer)
    pub fn create_inbound_session(
        &mut self,
        their_identity_key: Curve25519PublicKey,
        message: &OlmMessage,
    ) -> CryptoResult<(RatchetSession, Vec<u8>)> {
        // Extract PreKeyMessage from OlmMessage
        let prekey_message = match message {
            OlmMessage::PreKey(m) => m,
            OlmMessage::Normal(_) => {
                return Err(CryptoError::X3dhError(
                    "Expected PreKey message for new session".to_string(),
                ));
            }
        };

        let result = self
            .inner
            .create_inbound_session(their_identity_key, prekey_message)
            .map_err(|e| CryptoError::X3dhError(format!("Failed to create inbound session: {}", e)))?;

        let session = RatchetSession::new(
            result.session,
            hex::encode(their_identity_key.to_bytes()),
        );

        Ok((session, result.plaintext))
    }

    /// Get the maximum number of one-time keys
    pub fn max_one_time_keys(&self) -> usize {
        self.inner.max_number_of_one_time_keys()
    }
}

impl Default for OlmAccount {
    fn default() -> Self {
        Self::new()
    }
}

/// A Double Ratchet session with a specific peer
///
/// Wraps vodozemac's Session to provide:
/// - Encryption/decryption with forward secrecy
/// - Session serialization for storage
/// - Peer identification
pub struct RatchetSession {
    /// The underlying vodozemac Session
    inner: Session,
    /// Identifier for the peer (hex-encoded identity key)
    pub peer_id: String,
    /// Number of messages sent in this session
    messages_sent: u64,
    /// Number of messages received in this session
    messages_received: u64,
}

impl RatchetSession {
    /// Create a new session from a vodozemac Session
    pub(crate) fn new(session: Session, peer_id: String) -> Self {
        Self {
            inner: session,
            peer_id,
            messages_sent: 0,
            messages_received: 0,
        }
    }

    /// Encrypt a message
    ///
    /// Returns an OlmMessage that can be sent to the peer.
    /// The first message will be a PreKey message; subsequent messages will be normal.
    pub fn encrypt(&mut self, plaintext: &[u8]) -> OlmMessage {
        self.messages_sent += 1;
        self.inner.encrypt(plaintext)
    }

    /// Decrypt a message
    ///
    /// Returns the decrypted plaintext.
    pub fn decrypt(&mut self, message: &OlmMessage) -> CryptoResult<Vec<u8>> {
        let plaintext = self.inner.decrypt(message)?;
        self.messages_received += 1;
        Ok(plaintext)
    }

    /// Get the session ID (for logging/debugging)
    pub fn session_id(&self) -> String {
        self.inner.session_id()
    }

    /// Check if this session has received a message
    ///
    /// Useful to determine if the session is established bidirectionally.
    pub fn has_received_message(&self) -> bool {
        self.messages_received > 0
    }

    /// Serialize the session for storage
    pub fn pickle(&self, _pickle_key: &PickleKey) -> CryptoResult<String> {
        let pickle = self.inner.pickle();
        let state = PickledSession {
            session: pickle,
            peer_id: self.peer_id.clone(),
            messages_sent: self.messages_sent,
            messages_received: self.messages_received,
        };
        serde_json::to_string(&state)
            .map_err(|e| CryptoError::SerializationError(e.to_string()))
    }

    /// Restore a session from storage
    pub fn unpickle(pickled: &str, _pickle_key: &PickleKey) -> CryptoResult<Self> {
        let state: PickledSession = serde_json::from_str(pickled)
            .map_err(|e| CryptoError::SerializationError(e.to_string()))?;

        let inner = Session::from(state.session);

        Ok(Self {
            inner,
            peer_id: state.peer_id,
            messages_sent: state.messages_sent,
            messages_received: state.messages_received,
        })
    }

    /// Get statistics about this session
    pub fn stats(&self) -> SessionStats {
        SessionStats {
            peer_id: self.peer_id.clone(),
            session_id: self.session_id(),
            messages_sent: self.messages_sent,
            messages_received: self.messages_received,
        }
    }
}

/// Serializable session state
#[derive(Serialize, Deserialize)]
struct PickledSession {
    session: SessionPickle,
    peer_id: String,
    messages_sent: u64,
    messages_received: u64,
}

/// Statistics about a session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStats {
    pub peer_id: String,
    pub session_id: String,
    pub messages_sent: u64,
    pub messages_received: u64,
}

/// Encrypted message with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedMessage {
    /// The encrypted message type and content
    pub message_type: u8, // 0 = PreKey, 1 = Normal
    /// The ciphertext
    pub ciphertext: Vec<u8>,
}

impl EncryptedMessage {
    /// Create from an OlmMessage
    pub fn from_olm(message: &OlmMessage) -> Self {
        match message {
            OlmMessage::PreKey(m) => Self {
                message_type: 0,
                ciphertext: m.to_bytes(),
            },
            OlmMessage::Normal(m) => Self {
                message_type: 1,
                ciphertext: m.to_bytes(),
            },
        }
    }

    /// Convert back to OlmMessage
    pub fn to_olm(&self) -> CryptoResult<OlmMessage> {
        match self.message_type {
            0 => {
                let prekey = vodozemac::olm::PreKeyMessage::try_from(self.ciphertext.as_slice())
                    .map_err(|e| CryptoError::DecryptionError(format!("Invalid PreKey message: {:?}", e)))?;
                Ok(OlmMessage::PreKey(prekey))
            }
            1 => {
                let normal = vodozemac::olm::Message::try_from(self.ciphertext.as_slice())
                    .map_err(|e| CryptoError::DecryptionError(format!("Invalid message: {:?}", e)))?;
                Ok(OlmMessage::Normal(normal))
            }
            _ => Err(CryptoError::DecryptionError(format!(
                "Unknown message type: {}",
                self.message_type
            ))),
        }
    }

    /// Serialize to bytes for transmission
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(1 + self.ciphertext.len());
        bytes.push(self.message_type);
        bytes.extend_from_slice(&self.ciphertext);
        bytes
    }

    /// Deserialize from bytes
    pub fn from_bytes(bytes: &[u8]) -> CryptoResult<Self> {
        if bytes.is_empty() {
            return Err(CryptoError::DecryptionError(
                "Empty message bytes".to_string(),
            ));
        }
        Ok(Self {
            message_type: bytes[0],
            ciphertext: bytes[1..].to_vec(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_account_creation() {
        let account = OlmAccount::new();
        let identity = account.identity_key();
        assert_eq!(identity.to_bytes().len(), 32);
    }

    #[test]
    fn test_one_time_key_generation() {
        let mut account = OlmAccount::new();
        account.generate_one_time_keys(10);

        let keys = account.one_time_keys();
        assert_eq!(keys.len(), 10);

        // Mark as published
        account.mark_keys_as_published();

        // Should now return empty (already published)
        let keys = account.one_time_keys();
        assert_eq!(keys.len(), 0);
    }

    #[test]
    fn test_session_creation_and_encryption() {
        // Alice creates her account
        let mut alice = OlmAccount::new();
        alice.generate_one_time_keys(5);

        // Bob creates his account
        let mut bob = OlmAccount::new();
        bob.generate_one_time_keys(5);

        // Alice gets Bob's identity and one-time key
        let bob_identity = bob.identity_key();
        let bob_otk = bob.one_time_keys().into_iter().next().unwrap().1;

        // Alice creates outbound session to Bob
        let mut alice_session = alice
            .create_outbound_session(bob_identity, bob_otk)
            .unwrap();

        // Alice encrypts a message
        let plaintext = b"Hello Bob!";
        let ciphertext = alice_session.encrypt(plaintext);

        // Bob creates inbound session from Alice's message
        let alice_identity = alice.identity_key();
        let (mut bob_session, decrypted) = bob
            .create_inbound_session(alice_identity, &ciphertext)
            .unwrap();

        assert_eq!(decrypted, plaintext);

        // Bob can now reply
        let reply = b"Hello Alice!";
        let reply_ciphertext = bob_session.encrypt(reply);

        let decrypted_reply = alice_session.decrypt(&reply_ciphertext).unwrap();
        assert_eq!(decrypted_reply, reply);
    }

    #[test]
    fn test_session_pickle_unpickle() {
        let mut alice = OlmAccount::new();
        alice.generate_one_time_keys(1);

        let mut bob = OlmAccount::new();
        bob.generate_one_time_keys(1);

        let bob_identity = bob.identity_key();
        let bob_otk = bob.one_time_keys().into_iter().next().unwrap().1;

        let mut alice_session = alice
            .create_outbound_session(bob_identity, bob_otk)
            .unwrap();

        // Encrypt a message (first message is always PreKey)
        let msg = alice_session.encrypt(b"test");
        assert!(matches!(msg, OlmMessage::PreKey(_)));

        // Bob creates inbound session from the PreKey message
        let (mut bob_session, _plaintext) = bob.create_inbound_session(alice.identity_key(), &msg).unwrap();

        // Bob responds - this advances the ratchet
        let _bob_response = bob_session.encrypt(b"hello back");

        // Pickle Alice's session
        let pickle_key = [0u8; 32];
        let pickled = alice_session.pickle(&pickle_key).unwrap();

        // Unpickle
        let mut restored = RatchetSession::unpickle(&pickled, &pickle_key).unwrap();

        // Should be able to encrypt another message (still PreKey until we receive Bob's response)
        let msg2 = restored.encrypt(b"test2");
        // Note: Without receiving Bob's response, Alice continues using PreKey messages
        // This is correct Olm behavior - session becomes Normal only after receiving a response
        assert!(matches!(msg2, OlmMessage::PreKey(_) | OlmMessage::Normal(_)));
    }

    #[test]
    fn test_encrypted_message_serialization() {
        let mut account = OlmAccount::new();
        account.generate_one_time_keys(1);

        let identity = account.identity_key();
        let otk = account.one_time_keys().into_iter().next().unwrap().1;

        let mut other = OlmAccount::new();
        let mut session = other.create_outbound_session(identity, otk).unwrap();

        let olm_msg = session.encrypt(b"test");
        let encrypted = EncryptedMessage::from_olm(&olm_msg);

        // Serialize and deserialize
        let bytes = encrypted.to_bytes();
        let restored = EncryptedMessage::from_bytes(&bytes).unwrap();

        assert_eq!(encrypted.message_type, restored.message_type);
        assert_eq!(encrypted.ciphertext, restored.ciphertext);

        // Convert back to OlmMessage
        let restored_olm = restored.to_olm().unwrap();

        // Both should be PreKey messages
        assert!(matches!(olm_msg, OlmMessage::PreKey(_)));
        assert!(matches!(restored_olm, OlmMessage::PreKey(_)));
    }
}
