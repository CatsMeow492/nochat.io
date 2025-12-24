//! Key types and generation for the Signal Protocol
//!
//! This module defines key types used throughout the Signal Protocol implementation:
//! - Identity keys (Ed25519) for long-term identity and signing
//! - Curve25519 keys for Diffie-Hellman key exchange
//! - Signed prekeys for medium-term key exchange
//! - One-time prekeys for forward secrecy

use serde::{Deserialize, Serialize};
use vodozemac::{Curve25519PublicKey, Curve25519SecretKey, Ed25519PublicKey, Ed25519SecretKey};

use crate::crypto::errors::{CryptoError, CryptoResult};

/// Long-term identity key pair (Ed25519)
///
/// Used for:
/// - Signing prekeys to prove ownership
/// - Long-term identity verification
/// - Key fingerprint generation for verification
pub struct IdentityKeyPair {
    /// Public key (safe to share)
    pub public: Ed25519PublicKey,
    /// Secret key (never leaves device)
    secret: Ed25519SecretKey,
}

impl IdentityKeyPair {
    /// Generate a new random identity key pair
    pub fn generate() -> Self {
        let secret = Ed25519SecretKey::new();
        let public = secret.public_key();
        Self { public, secret }
    }

    /// Restore from existing key bytes
    pub fn from_bytes(public_bytes: &[u8], secret_bytes: &[u8]) -> CryptoResult<Self> {
        let public_arr: [u8; 32] = public_bytes.try_into()
            .map_err(|_| CryptoError::InvalidKey("Public key must be 32 bytes".to_string()))?;
        let secret_arr: [u8; 32] = secret_bytes.try_into()
            .map_err(|_| CryptoError::InvalidKey("Secret key must be 32 bytes".to_string()))?;

        let public = Ed25519PublicKey::from_slice(&public_arr)?;
        let secret = Ed25519SecretKey::from_slice(&secret_arr);
        Ok(Self { public, secret })
    }

    /// Sign a message with this identity key
    pub fn sign(&self, message: &[u8]) -> Vec<u8> {
        self.secret.sign(message).to_bytes().to_vec()
    }

    /// Get the public key bytes
    pub fn public_key_bytes(&self) -> Vec<u8> {
        self.public.as_bytes().to_vec()
    }

    /// Get the secret key bytes (for secure storage)
    pub fn secret_key_bytes(&self) -> Vec<u8> {
        self.secret.to_bytes().to_vec()
    }

    /// Compute a fingerprint for key verification
    pub fn fingerprint(&self) -> String {
        use sha2::{Digest, Sha256};
        let hash = Sha256::digest(self.public.as_bytes());
        hex::encode(&hash[..8])
    }
}

/// Curve25519 key pair for Diffie-Hellman key exchange
///
/// Used for:
/// - Ephemeral keys in X3DH
/// - Ratchet keys in Double Ratchet
/// - Signed prekeys
/// - One-time prekeys
pub struct Curve25519KeyPair {
    /// Public key (safe to share)
    pub public: Curve25519PublicKey,
    /// Secret key (never leaves device)
    secret: Curve25519SecretKey,
}

impl Curve25519KeyPair {
    /// Generate a new random Curve25519 key pair
    pub fn generate() -> Self {
        let secret = Curve25519SecretKey::new();
        let public = Curve25519PublicKey::from(&secret);
        Self { public, secret }
    }

    /// Restore from existing key bytes
    pub fn from_bytes(public_bytes: &[u8], secret_bytes: &[u8]) -> CryptoResult<Self> {
        let public_arr: [u8; 32] = public_bytes.try_into()
            .map_err(|_| CryptoError::InvalidKey("Public key must be 32 bytes".to_string()))?;
        let secret_arr: [u8; 32] = secret_bytes.try_into()
            .map_err(|_| CryptoError::InvalidKey("Secret key must be 32 bytes".to_string()))?;

        let public = Curve25519PublicKey::from_slice(&public_arr)?;
        let secret = Curve25519SecretKey::from_slice(&secret_arr);
        Ok(Self { public, secret })
    }

    /// Perform Diffie-Hellman key exchange
    pub fn diffie_hellman(&self, their_public: &Curve25519PublicKey) -> [u8; 32] {
        self.secret.diffie_hellman(their_public).to_bytes()
    }

    /// Get the public key bytes
    pub fn public_key_bytes(&self) -> Vec<u8> {
        self.public.to_bytes().to_vec()
    }

    /// Get the secret key bytes (for secure storage)
    pub fn secret_key_bytes(&self) -> Vec<u8> {
        self.secret.to_bytes().to_vec()
    }
}

/// Signed prekey (rotated periodically, typically every ~7 days)
///
/// A Curve25519 key pair with a signature from the identity key,
/// proving that the prekey belongs to the identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedPreKey {
    /// Unique identifier for this prekey
    pub key_id: u32,
    /// The Curve25519 public key
    pub public_key: Vec<u8>,
    /// Ed25519 signature of the public key
    pub signature: Vec<u8>,
    /// Unix timestamp when this prekey was created
    pub created_at: i64,
}

impl SignedPreKey {
    /// Create a new signed prekey
    pub fn new(key_id: u32, key_pair: &Curve25519KeyPair, identity: &IdentityKeyPair) -> Self {
        let public_key = key_pair.public_key_bytes();
        let signature = identity.sign(&public_key);

        Self {
            key_id,
            public_key,
            signature,
            created_at: chrono::Utc::now().timestamp(),
        }
    }

    /// Verify the signature with the identity public key
    pub fn verify(&self, identity_public: &Ed25519PublicKey) -> CryptoResult<()> {
        let signature = vodozemac::Ed25519Signature::from_slice(&self.signature).map_err(|e| {
            CryptoError::SignatureError(format!("Invalid signature format: {:?}", e))
        })?;

        identity_public
            .verify(&self.public_key, &signature)
            .map_err(|e| CryptoError::SignatureError(format!("Signature verification failed: {}", e)))
    }

    /// Check if this prekey has expired (older than max_age_days)
    pub fn is_expired(&self, max_age_days: i64) -> bool {
        let now = chrono::Utc::now().timestamp();
        let age_seconds = now - self.created_at;
        let max_age_seconds = max_age_days * 24 * 60 * 60;
        age_seconds > max_age_seconds
    }

    /// Get the Curve25519 public key
    pub fn get_public_key(&self) -> CryptoResult<Curve25519PublicKey> {
        let arr: [u8; 32] = self.public_key.as_slice().try_into()
            .map_err(|_| CryptoError::InvalidKey("Key must be 32 bytes".to_string()))?;
        Curve25519PublicKey::from_slice(&arr).map_err(Into::into)
    }
}

/// One-time prekey (single use, provides forward secrecy)
///
/// Consumed after a single use to provide forward secrecy for the initial message.
/// Should be replenished when count falls below threshold.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneTimePreKey {
    /// Unique identifier for this prekey
    pub key_id: u32,
    /// The Curve25519 public key
    pub public_key: Vec<u8>,
}

impl OneTimePreKey {
    /// Create a new one-time prekey
    pub fn new(key_id: u32, key_pair: &Curve25519KeyPair) -> Self {
        Self {
            key_id,
            public_key: key_pair.public_key_bytes(),
        }
    }

    /// Get the Curve25519 public key
    pub fn get_public_key(&self) -> CryptoResult<Curve25519PublicKey> {
        let arr: [u8; 32] = self.public_key.as_slice().try_into()
            .map_err(|_| CryptoError::InvalidKey("Key must be 32 bytes".to_string()))?;
        Curve25519PublicKey::from_slice(&arr).map_err(Into::into)
    }
}

/// Stored prekey with secret key (for local storage only)
pub struct StoredPreKey {
    /// Unique identifier
    pub key_id: u32,
    /// Public key bytes
    pub public_key: Vec<u8>,
    /// Secret key bytes (encrypted before storage)
    pub secret_key: Vec<u8>,
    /// Whether this is a signed prekey (vs one-time)
    pub is_signed: bool,
}

impl StoredPreKey {
    /// Create from a Curve25519 key pair
    pub fn from_keypair(key_id: u32, key_pair: &Curve25519KeyPair, is_signed: bool) -> Self {
        Self {
            key_id,
            public_key: key_pair.public_key_bytes(),
            secret_key: key_pair.secret_key_bytes(),
            is_signed,
        }
    }

    /// Restore the key pair
    pub fn to_keypair(&self) -> CryptoResult<Curve25519KeyPair> {
        Curve25519KeyPair::from_bytes(&self.public_key, &self.secret_key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_key_generation() {
        let key = IdentityKeyPair::generate();
        assert_eq!(key.public_key_bytes().len(), 32);
        assert_eq!(key.secret_key_bytes().len(), 32); // Ed25519 secret key seed is 32 bytes
    }

    #[test]
    fn test_identity_key_signing() {
        let key = IdentityKeyPair::generate();
        let message = b"test message";
        let signature = key.sign(message);
        assert_eq!(signature.len(), 64); // Ed25519 signature is 64 bytes

        // Verify signature
        let sig = vodozemac::Ed25519Signature::from_slice(&signature).unwrap();
        assert!(key.public.verify(message, &sig).is_ok());
    }

    #[test]
    fn test_curve25519_key_generation() {
        let key = Curve25519KeyPair::generate();
        assert_eq!(key.public_key_bytes().len(), 32);
        assert_eq!(key.secret_key_bytes().len(), 32);
    }

    #[test]
    fn test_diffie_hellman() {
        let alice = Curve25519KeyPair::generate();
        let bob = Curve25519KeyPair::generate();

        let shared_alice = alice.diffie_hellman(&bob.public);
        let shared_bob = bob.diffie_hellman(&alice.public);

        assert_eq!(shared_alice, shared_bob);
    }

    #[test]
    fn test_signed_prekey() {
        let identity = IdentityKeyPair::generate();
        let prekey_pair = Curve25519KeyPair::generate();
        let signed_prekey = SignedPreKey::new(1, &prekey_pair, &identity);

        assert_eq!(signed_prekey.key_id, 1);
        assert!(signed_prekey.verify(&identity.public).is_ok());
    }

    #[test]
    fn test_signed_prekey_expiry() {
        let identity = IdentityKeyPair::generate();
        let prekey_pair = Curve25519KeyPair::generate();
        let mut signed_prekey = SignedPreKey::new(1, &prekey_pair, &identity);

        // Fresh key should not be expired
        assert!(!signed_prekey.is_expired(7));

        // Set created_at to 8 days ago
        signed_prekey.created_at = chrono::Utc::now().timestamp() - (8 * 24 * 60 * 60);
        assert!(signed_prekey.is_expired(7));
    }

    #[test]
    fn test_fingerprint() {
        let key = IdentityKeyPair::generate();
        let fingerprint = key.fingerprint();
        assert_eq!(fingerprint.len(), 16); // 8 bytes as hex = 16 chars
    }
}
