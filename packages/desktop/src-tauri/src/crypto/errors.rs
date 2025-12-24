//! Cryptographic error types
//!
//! This module defines all error types for the Signal Protocol implementation.

use thiserror::Error;

/// Errors that can occur during cryptographic operations
#[derive(Debug, Error)]
pub enum CryptoError {
    /// Failed to generate a key
    #[error("Key generation failed: {0}")]
    KeyGenerationFailed(String),

    /// Failed to parse or decode a key
    #[error("Invalid key format: {0}")]
    InvalidKey(String),

    /// Failed to derive a shared secret
    #[error("Key exchange failed: {0}")]
    KeyExchangeFailed(String),

    /// X3DH protocol error
    #[error("X3DH error: {0}")]
    X3dhError(String),

    /// Double Ratchet protocol error
    #[error("Ratchet error: {0}")]
    RatchetError(String),

    /// Signature verification failed
    #[error("Signature verification failed: {0}")]
    SignatureError(String),

    /// Encryption failed
    #[error("Encryption failed: {0}")]
    EncryptionError(String),

    /// Decryption failed
    #[error("Decryption failed: {0}")]
    DecryptionError(String),

    /// Session not found for peer
    #[error("No session found for peer: {0}")]
    SessionNotFound(String),

    /// Session corrupted or invalid
    #[error("Session corrupted: {0}")]
    SessionCorrupted(String),

    /// Prekey exhausted (need to replenish)
    #[error("No prekeys available for peer: {0}")]
    NoPrekeysAvailable(String),

    /// Database error
    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),

    /// Serialization error
    #[error("Serialization error: {0}")]
    SerializationError(String),

    /// vodozemac library error
    #[error("vodozemac error: {0}")]
    VodozemacError(String),

    /// Internal error
    #[error("Internal crypto error: {0}")]
    InternalError(String),
}

impl From<vodozemac::KeyError> for CryptoError {
    fn from(e: vodozemac::KeyError) -> Self {
        CryptoError::InvalidKey(e.to_string())
    }
}

impl From<vodozemac::olm::SessionCreationError> for CryptoError {
    fn from(e: vodozemac::olm::SessionCreationError) -> Self {
        CryptoError::X3dhError(e.to_string())
    }
}

impl From<vodozemac::olm::DecryptionError> for CryptoError {
    fn from(e: vodozemac::olm::DecryptionError) -> Self {
        CryptoError::DecryptionError(e.to_string())
    }
}

// SessionPickleError doesn't exist in vodozemac 0.9, session errors are handled differently

impl From<aes_gcm::Error> for CryptoError {
    fn from(_: aes_gcm::Error) -> Self {
        CryptoError::EncryptionError("AES-GCM operation failed".to_string())
    }
}

/// Result type for cryptographic operations
pub type CryptoResult<T> = Result<T, CryptoError>;
