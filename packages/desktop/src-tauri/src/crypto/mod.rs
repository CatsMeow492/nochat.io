//! Signal Protocol cryptography module
//!
//! This module implements the Signal Protocol using the vodozemac library,
//! providing end-to-end encryption with per-message forward secrecy.
//!
//! ## Components
//!
//! - **keys**: Key generation and storage (identity, signed prekeys, one-time prekeys)
//! - **x3dh**: Extended Triple Diffie-Hellman for asynchronous key agreement
//! - **ratchet**: Double Ratchet for per-message forward secrecy
//! - **prekeys**: Prekey bundle management and replenishment
//! - **sessions**: Session storage and retrieval (SQLite-backed)
//! - **service**: High-level CryptoService facade
//!
//! ## Usage
//!
//! ```rust,ignore
//! use crate::crypto::{CryptoService, CryptoResult};
//!
//! // Initialize crypto service
//! let service = CryptoService::new(db_pool, pickle_key).await?;
//!
//! // Establish session with a peer
//! let bundle = fetch_prekey_bundle(peer_id).await?;
//! service.establish_session(peer_id, &bundle).await?;
//!
//! // Encrypt a message
//! let ciphertext = service.encrypt(peer_id, plaintext).await?;
//!
//! // Decrypt a message
//! let plaintext = service.decrypt(peer_id, &ciphertext).await?;
//! ```

pub mod errors;
pub mod keys;
pub mod prekeys;
pub mod ratchet;
pub mod service;
pub mod sessions;
pub mod x3dh;

// Re-export commonly used types
pub use errors::{CryptoError, CryptoResult};
pub use keys::{Curve25519KeyPair, IdentityKeyPair, OneTimePreKey, SignedPreKey};
pub use prekeys::PreKeyManager;
pub use x3dh::PreKeyBundle;
pub use ratchet::RatchetSession;
pub use service::CryptoService;
pub use sessions::SessionStore;
pub use x3dh::{x3dh_initiate, x3dh_respond, X3dhResult};
