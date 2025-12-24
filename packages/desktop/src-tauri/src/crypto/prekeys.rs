//! Prekey Bundle Management
//!
//! This module manages the generation, storage, and replenishment of prekeys
//! for the Signal Protocol. It handles:
//!
//! - **Signed Prekeys**: Rotated periodically (~7 days), signed by identity key
//! - **One-Time Prekeys**: Single-use keys for forward secrecy, replenished as needed

use serde::{Deserialize, Serialize};

use crate::crypto::errors::CryptoResult;
use crate::crypto::keys::{Curve25519KeyPair, IdentityKeyPair, OneTimePreKey, SignedPreKey, StoredPreKey};
use crate::crypto::x3dh::PreKeyBundle;

/// Configuration for prekey management
pub struct PreKeyConfig {
    /// Number of one-time prekeys to generate initially
    pub initial_batch_size: usize,
    /// Number of one-time prekeys to generate when replenishing
    pub replenishment_batch_size: usize,
    /// Minimum number of prekeys before triggering replenishment
    pub min_prekey_count: usize,
    /// Maximum age of signed prekey in days before rotation
    pub signed_prekey_max_age_days: i64,
}

impl Default for PreKeyConfig {
    fn default() -> Self {
        Self {
            initial_batch_size: 100,
            replenishment_batch_size: 100,
            min_prekey_count: 25,
            signed_prekey_max_age_days: 7,
        }
    }
}

/// Manages prekey generation and lifecycle
pub struct PreKeyManager {
    /// Our identity key pair (for signing prekeys)
    identity: IdentityKeyPair,
    /// Current signed prekey (key pair stored locally)
    signed_prekey: Curve25519KeyPair,
    /// ID of the current signed prekey
    signed_prekey_id: u32,
    /// When the signed prekey was created
    signed_prekey_created: i64,
    /// Pool of unused one-time prekeys (stored locally)
    one_time_prekeys: Vec<(u32, Curve25519KeyPair)>,
    /// Next ID to use for new prekeys
    next_prekey_id: u32,
    /// Configuration
    config: PreKeyConfig,
}

impl PreKeyManager {
    /// Create a new prekey manager with fresh keys
    pub fn new(identity: IdentityKeyPair) -> Self {
        Self::with_config(identity, PreKeyConfig::default())
    }

    /// Create a new prekey manager with custom configuration
    pub fn with_config(identity: IdentityKeyPair, config: PreKeyConfig) -> Self {
        let signed_prekey = Curve25519KeyPair::generate();
        let one_time_prekeys = Self::generate_prekey_batch(0, config.initial_batch_size);
        let next_prekey_id = config.initial_batch_size as u32;

        Self {
            identity,
            signed_prekey,
            signed_prekey_id: 0,
            signed_prekey_created: chrono::Utc::now().timestamp(),
            one_time_prekeys,
            next_prekey_id,
            config,
        }
    }

    /// Restore from persisted state
    pub fn restore(
        identity: IdentityKeyPair,
        signed_prekey: StoredPreKey,
        signed_prekey_created: i64,
        one_time_prekeys: Vec<StoredPreKey>,
        next_prekey_id: u32,
        config: PreKeyConfig,
    ) -> CryptoResult<Self> {
        let signed_kp = signed_prekey.to_keypair()?;
        let otks: CryptoResult<Vec<_>> = one_time_prekeys
            .into_iter()
            .map(|sp| Ok((sp.key_id, sp.to_keypair()?)))
            .collect();

        Ok(Self {
            identity,
            signed_prekey: signed_kp,
            signed_prekey_id: signed_prekey.key_id,
            signed_prekey_created,
            one_time_prekeys: otks?,
            next_prekey_id,
            config,
        })
    }

    /// Generate a batch of one-time prekeys
    fn generate_prekey_batch(start_id: u32, count: usize) -> Vec<(u32, Curve25519KeyPair)> {
        (0..count)
            .map(|i| (start_id + i as u32, Curve25519KeyPair::generate()))
            .collect()
    }

    /// Get the signed prekey for uploading to the server
    pub fn get_signed_prekey(&self) -> SignedPreKey {
        SignedPreKey::new(self.signed_prekey_id, &self.signed_prekey, &self.identity)
    }

    /// Get all one-time prekeys for uploading to the server
    pub fn get_one_time_prekeys(&self) -> Vec<OneTimePreKey> {
        self.one_time_prekeys
            .iter()
            .map(|(id, kp)| OneTimePreKey::new(*id, kp))
            .collect()
    }

    /// Get our prekey bundle (for responding to bundle requests)
    pub fn get_bundle(&self) -> PreKeyBundle {
        let otk = self.one_time_prekeys.first().map(|(id, kp)| OneTimePreKey::new(*id, kp));

        PreKeyBundle {
            identity_key: self.identity.public_key_bytes(),
            signed_prekey: self.get_signed_prekey(),
            one_time_prekey: otk,
        }
    }

    /// Consume a one-time prekey (when a session is established)
    ///
    /// Returns the consumed key pair for use in session establishment.
    pub fn consume_prekey(&mut self, key_id: u32) -> Option<Curve25519KeyPair> {
        let idx = self.one_time_prekeys.iter().position(|(id, _)| *id == key_id)?;
        Some(self.one_time_prekeys.remove(idx).1)
    }

    /// Check if we need to replenish one-time prekeys
    pub fn needs_replenishment(&self) -> bool {
        self.one_time_prekeys.len() < self.config.min_prekey_count
    }

    /// Generate more one-time prekeys
    ///
    /// Returns the new prekeys for uploading to the server.
    pub fn replenish(&mut self) -> Vec<OneTimePreKey> {
        let new_keys = Self::generate_prekey_batch(
            self.next_prekey_id,
            self.config.replenishment_batch_size,
        );

        let result: Vec<OneTimePreKey> = new_keys
            .iter()
            .map(|(id, kp)| OneTimePreKey::new(*id, kp))
            .collect();

        self.next_prekey_id += self.config.replenishment_batch_size as u32;
        self.one_time_prekeys.extend(new_keys);

        result
    }

    /// Check if the signed prekey needs rotation
    pub fn needs_signed_prekey_rotation(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        let age_seconds = now - self.signed_prekey_created;
        let max_age_seconds = self.config.signed_prekey_max_age_days * 24 * 60 * 60;
        age_seconds > max_age_seconds
    }

    /// Rotate the signed prekey
    ///
    /// Returns the new signed prekey for uploading to the server.
    pub fn rotate_signed_prekey(&mut self) -> SignedPreKey {
        self.signed_prekey = Curve25519KeyPair::generate();
        self.signed_prekey_id += 1;
        self.signed_prekey_created = chrono::Utc::now().timestamp();
        self.get_signed_prekey()
    }

    /// Get the count of available one-time prekeys
    pub fn prekey_count(&self) -> usize {
        self.one_time_prekeys.len()
    }

    /// Get the identity key fingerprint for verification
    pub fn fingerprint(&self) -> String {
        self.identity.fingerprint()
    }

    /// Get stored prekeys for persistence
    pub fn get_stored_prekeys(&self) -> (StoredPreKey, Vec<StoredPreKey>) {
        let signed = StoredPreKey::from_keypair(self.signed_prekey_id, &self.signed_prekey, true);

        let otks: Vec<StoredPreKey> = self
            .one_time_prekeys
            .iter()
            .map(|(id, kp)| StoredPreKey::from_keypair(*id, kp, false))
            .collect();

        (signed, otks)
    }

    /// Get the signed prekey creation timestamp
    pub fn signed_prekey_created(&self) -> i64 {
        self.signed_prekey_created
    }

    /// Get the next prekey ID
    pub fn next_prekey_id(&self) -> u32 {
        self.next_prekey_id
    }

    /// Get the signed prekey for session establishment (as responder)
    pub fn get_signed_prekey_pair(&self) -> &Curve25519KeyPair {
        &self.signed_prekey
    }

    /// Get the identity key pair
    pub fn identity(&self) -> &IdentityKeyPair {
        &self.identity
    }
}

/// Status of prekey availability
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreKeyStatus {
    /// Number of one-time prekeys available
    pub one_time_prekey_count: usize,
    /// Whether replenishment is needed
    pub needs_replenishment: bool,
    /// Whether signed prekey rotation is needed
    pub needs_rotation: bool,
    /// Age of signed prekey in seconds
    pub signed_prekey_age_seconds: i64,
    /// Identity key fingerprint
    pub fingerprint: String,
}

impl PreKeyManager {
    /// Get the current status of prekeys
    pub fn status(&self) -> PreKeyStatus {
        let now = chrono::Utc::now().timestamp();

        PreKeyStatus {
            one_time_prekey_count: self.one_time_prekeys.len(),
            needs_replenishment: self.needs_replenishment(),
            needs_rotation: self.needs_signed_prekey_rotation(),
            signed_prekey_age_seconds: now - self.signed_prekey_created,
            fingerprint: self.fingerprint(),
        }
    }
}

// PreKeyBundle is re-exported from x3dh in mod.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prekey_manager_creation() {
        let identity = IdentityKeyPair::generate();
        let manager = PreKeyManager::new(identity);

        // Should have initial batch of prekeys
        assert_eq!(manager.prekey_count(), 100);
        assert!(!manager.needs_replenishment());
    }

    #[test]
    fn test_prekey_consumption() {
        let identity = IdentityKeyPair::generate();
        let mut manager = PreKeyManager::new(identity);

        let prekeys = manager.get_one_time_prekeys();
        let first_id = prekeys[0].key_id;

        // Consume the first prekey
        let consumed = manager.consume_prekey(first_id);
        assert!(consumed.is_some());
        assert_eq!(manager.prekey_count(), 99);

        // Can't consume the same prekey twice
        let consumed_again = manager.consume_prekey(first_id);
        assert!(consumed_again.is_none());
    }

    #[test]
    fn test_prekey_replenishment() {
        let identity = IdentityKeyPair::generate();
        let config = PreKeyConfig {
            initial_batch_size: 30,
            replenishment_batch_size: 50,
            min_prekey_count: 25,
            signed_prekey_max_age_days: 7,
        };
        let mut manager = PreKeyManager::with_config(identity, config);

        // Consume prekeys until we need replenishment
        while !manager.needs_replenishment() {
            let prekeys = manager.get_one_time_prekeys();
            manager.consume_prekey(prekeys[0].key_id);
        }

        // Should need replenishment now
        assert!(manager.needs_replenishment());

        // Replenish
        let new_prekeys = manager.replenish();
        assert_eq!(new_prekeys.len(), 50);
        assert!(!manager.needs_replenishment());
    }

    #[test]
    fn test_signed_prekey_rotation() {
        let identity = IdentityKeyPair::generate();
        let mut manager = PreKeyManager::new(identity);

        let original = manager.get_signed_prekey();
        let original_id = original.key_id;

        // Rotate
        let new_prekey = manager.rotate_signed_prekey();
        assert_eq!(new_prekey.key_id, original_id + 1);

        // Public key should be different
        assert_ne!(original.public_key, new_prekey.public_key);
    }

    #[test]
    fn test_bundle_generation() {
        let identity = IdentityKeyPair::generate();
        let manager = PreKeyManager::new(identity);

        let bundle = manager.get_bundle();

        // Bundle should have all required fields
        assert!(!bundle.identity_key.is_empty());
        assert!(!bundle.signed_prekey.public_key.is_empty());
        assert!(!bundle.signed_prekey.signature.is_empty());
        assert!(bundle.one_time_prekey.is_some());

        // Bundle should be valid
        assert!(bundle.verify().is_ok());
    }

    #[test]
    fn test_status() {
        let identity = IdentityKeyPair::generate();
        let manager = PreKeyManager::new(identity);

        let status = manager.status();
        assert_eq!(status.one_time_prekey_count, 100);
        assert!(!status.needs_replenishment);
        assert!(!status.needs_rotation);
        assert!(!status.fingerprint.is_empty());
    }
}
