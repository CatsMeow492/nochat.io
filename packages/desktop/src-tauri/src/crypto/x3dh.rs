//! X3DH (Extended Triple Diffie-Hellman) Key Agreement
//!
//! This module implements the X3DH protocol for asynchronous key agreement
//! as used in the Signal Protocol. X3DH allows two parties to establish a
//! shared secret even when one party is offline.
//!
//! ## Protocol Overview
//!
//! 1. Bob publishes his prekey bundle (identity key, signed prekey, one-time prekeys)
//! 2. Alice fetches Bob's bundle from the server
//! 3. Alice performs X3DH calculations:
//!    - DH1 = DH(IK_A, SPK_B)
//!    - DH2 = DH(EK_A, IK_B)
//!    - DH3 = DH(EK_A, SPK_B)
//!    - DH4 = DH(EK_A, OPK_B) [optional, if one-time prekey available]
//! 4. Alice derives shared secret: SK = KDF(DH1 || DH2 || DH3 || DH4)
//! 5. Alice sends initial message with her identity and ephemeral public keys
//! 6. Bob performs the same DH calculations to derive the same shared secret

use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use vodozemac::{Curve25519PublicKey, Ed25519PublicKey};

use crate::crypto::errors::{CryptoError, CryptoResult};
use crate::crypto::keys::{Curve25519KeyPair, IdentityKeyPair, OneTimePreKey, SignedPreKey};

/// Result of X3DH key agreement (initiator side)
#[derive(Debug)]
pub struct X3dhResult {
    /// The derived shared secret (32 bytes)
    pub shared_secret: [u8; 32],
    /// The ephemeral public key to send to the responder
    pub ephemeral_public: Vec<u8>,
    /// The ID of the one-time prekey that was used (if any)
    pub used_one_time_prekey: Option<u32>,
}

/// Prekey bundle fetched from the server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreKeyBundle {
    /// The responder's identity public key (Ed25519)
    pub identity_key: Vec<u8>,
    /// The responder's signed prekey
    pub signed_prekey: SignedPreKey,
    /// Optional one-time prekey (consumed after use)
    pub one_time_prekey: Option<OneTimePreKey>,
}

impl PreKeyBundle {
    /// Get the identity key as Ed25519PublicKey
    pub fn get_identity_key(&self) -> CryptoResult<Ed25519PublicKey> {
        let arr: [u8; 32] = self.identity_key.as_slice().try_into()
            .map_err(|_| CryptoError::InvalidKey("Identity key must be 32 bytes".to_string()))?;
        Ed25519PublicKey::from_slice(&arr).map_err(|e| {
            CryptoError::InvalidKey(format!("Invalid identity key in bundle: {:?}", e))
        })
    }

    /// Verify that the signed prekey has a valid signature from the identity key
    pub fn verify(&self) -> CryptoResult<()> {
        let identity_key = self.get_identity_key()?;
        self.signed_prekey.verify(&identity_key)
    }
}

/// Perform X3DH key agreement (initiator/Alice side)
///
/// This function is called by the party initiating the conversation.
/// It generates an ephemeral key pair and derives a shared secret using
/// the responder's prekey bundle.
///
/// # Arguments
///
/// * `our_identity` - Our long-term identity key pair
/// * `their_bundle` - The responder's prekey bundle (fetched from server)
///
/// # Returns
///
/// * `X3dhResult` containing the shared secret and ephemeral public key
pub fn x3dh_initiate(
    our_identity: &IdentityKeyPair,
    their_bundle: &PreKeyBundle,
) -> CryptoResult<X3dhResult> {
    // Verify the bundle first
    their_bundle.verify()?;

    // Generate ephemeral key pair for this session
    let ephemeral = Curve25519KeyPair::generate();

    // Parse their keys
    let their_identity = their_bundle.get_identity_key()?;
    let their_signed_prekey = their_bundle.signed_prekey.get_public_key()?;

    // Get our identity key as Curve25519 (for DH)
    // Note: In Signal, identity keys are both Ed25519 (for signing) and Curve25519 (for DH)
    // vodozemac's olm::Account handles this conversion internally
    // For now, we compute DH directly using the Curve25519 equivalent

    // DH1 = DH(IK_A_curve, SPK_B)
    // We need to convert our Ed25519 identity to Curve25519
    // This is typically done by the Account, but we can approximate it
    let our_identity_curve = convert_ed25519_to_curve25519_secret(&our_identity.secret_key_bytes())?;
    let dh1 = our_identity_curve.diffie_hellman(&their_signed_prekey);

    // DH2 = DH(EK_A, IK_B_curve)
    // Convert their Ed25519 identity to Curve25519
    let their_identity_curve = convert_ed25519_to_curve25519_public(&their_identity)?;
    let dh2 = ephemeral.diffie_hellman(&their_identity_curve);

    // DH3 = DH(EK_A, SPK_B)
    let dh3 = ephemeral.diffie_hellman(&their_signed_prekey);

    // DH4 = DH(EK_A, OPK_B) if one-time prekey exists
    let (dh4, used_otk_id) = if let Some(ref otk) = their_bundle.one_time_prekey {
        let their_otk = otk.get_public_key()?;
        (Some(ephemeral.diffie_hellman(&their_otk)), Some(otk.key_id))
    } else {
        (None, None)
    };

    // Combine secrets with KDF
    let shared_secret = kdf_x3dh(&dh1, &dh2, &dh3, dh4.as_ref())?;

    Ok(X3dhResult {
        shared_secret,
        ephemeral_public: ephemeral.public_key_bytes(),
        used_one_time_prekey: used_otk_id,
    })
}

/// Perform X3DH key agreement (responder/Bob side)
///
/// This function is called when receiving an initial message from Alice.
/// It uses our prekeys to derive the same shared secret that Alice computed.
///
/// # Arguments
///
/// * `our_identity` - Our long-term identity key pair
/// * `our_signed_prekey` - Our signed prekey that was used
/// * `our_one_time_prekey` - Our one-time prekey (if one was used)
/// * `their_identity` - The initiator's identity public key
/// * `their_ephemeral` - The initiator's ephemeral public key
///
/// # Returns
///
/// * The derived shared secret (32 bytes)
pub fn x3dh_respond(
    our_identity: &IdentityKeyPair,
    our_signed_prekey: &Curve25519KeyPair,
    our_one_time_prekey: Option<&Curve25519KeyPair>,
    their_identity: &Ed25519PublicKey,
    their_ephemeral: &Curve25519PublicKey,
) -> CryptoResult<[u8; 32]> {
    // Convert keys as needed
    let their_identity_curve = convert_ed25519_to_curve25519_public(their_identity)?;

    // DH1 = DH(SPK_B, IK_A_curve)
    let dh1 = our_signed_prekey.diffie_hellman(&their_identity_curve);

    // DH2 = DH(IK_B_curve, EK_A)
    let our_identity_curve = convert_ed25519_to_curve25519_secret(&our_identity.secret_key_bytes())?;
    let dh2 = our_identity_curve.diffie_hellman(their_ephemeral);

    // DH3 = DH(SPK_B, EK_A)
    let dh3 = our_signed_prekey.diffie_hellman(their_ephemeral);

    // DH4 = DH(OPK_B, EK_A) if one-time prekey was used
    let dh4 = our_one_time_prekey.map(|otk| otk.diffie_hellman(their_ephemeral));

    // Combine secrets with KDF
    kdf_x3dh(&dh1, &dh2, &dh3, dh4.as_ref())
}

/// KDF for combining X3DH DH outputs into a shared secret
///
/// Uses HKDF-SHA256 with a fixed info string to derive the final shared secret.
fn kdf_x3dh(
    dh1: &[u8; 32],
    dh2: &[u8; 32],
    dh3: &[u8; 32],
    dh4: Option<&[u8; 32]>,
) -> CryptoResult<[u8; 32]> {
    // Concatenate DH outputs with 32 bytes of 0xFF padding
    // This is per the X3DH specification
    let mut input = Vec::with_capacity(if dh4.is_some() { 160 } else { 128 });

    // 32 bytes of 0xFF (per Signal spec)
    input.extend_from_slice(&[0xFF; 32]);
    input.extend_from_slice(dh1);
    input.extend_from_slice(dh2);
    input.extend_from_slice(dh3);

    if let Some(dh4_bytes) = dh4 {
        input.extend_from_slice(dh4_bytes);
    }

    // Use HKDF to derive the shared secret
    let hkdf = Hkdf::<Sha256>::new(None, &input);
    let mut output = [0u8; 32];
    hkdf.expand(b"NoChat X3DH v1", &mut output)
        .map_err(|e| CryptoError::KeyExchangeFailed(format!("HKDF expansion failed: {}", e)))?;

    Ok(output)
}

/// Convert an Ed25519 secret key to its Curve25519 equivalent
///
/// This is needed because identity keys are Ed25519 (for signing) but
/// X3DH requires Curve25519 keys (for DH).
fn convert_ed25519_to_curve25519_secret(ed_secret: &[u8]) -> CryptoResult<Curve25519KeyPair> {
    use sha2::{Digest, Sha512};

    // Ed25519 secret key is 64 bytes: 32-byte seed + 32-byte public
    if ed_secret.len() < 32 {
        return Err(CryptoError::InvalidKey(
            "Ed25519 secret key too short".to_string(),
        ));
    }

    // Hash the seed portion (first 32 bytes) with SHA-512
    let seed = &ed_secret[..32];
    let hash = Sha512::digest(seed);

    // The first 32 bytes of the hash, with clamping, is the Curve25519 secret
    let mut curve_secret = [0u8; 32];
    curve_secret.copy_from_slice(&hash[..32]);

    // Apply Curve25519 clamping
    curve_secret[0] &= 248;
    curve_secret[31] &= 127;
    curve_secret[31] |= 64;

    // Derive public key from secret
    // Use x25519-dalek for this computation
    let secret = x25519_dalek::StaticSecret::from(curve_secret);
    let public = x25519_dalek::PublicKey::from(&secret);

    Curve25519KeyPair::from_bytes(public.as_bytes(), curve_secret.as_ref())
}

/// Convert an Ed25519 public key to its Curve25519 equivalent
fn convert_ed25519_to_curve25519_public(
    ed_public: &Ed25519PublicKey,
) -> CryptoResult<Curve25519PublicKey> {
    use curve25519_dalek::edwards::CompressedEdwardsY;

    let ed_bytes = ed_public.as_bytes();

    // Decompress the Edwards point
    let compressed = CompressedEdwardsY::from_slice(ed_bytes)
        .map_err(|e| CryptoError::InvalidKey(format!("Invalid Ed25519 public key: {:?}", e)))?;

    let point = compressed.decompress().ok_or_else(|| {
        CryptoError::InvalidKey("Failed to decompress Ed25519 public key".to_string())
    })?;

    // Convert to Montgomery (Curve25519) form
    let montgomery = point.to_montgomery();
    let curve_bytes = montgomery.to_bytes();

    Curve25519PublicKey::from_slice(&curve_bytes).map_err(Into::into)
}

/// Information sent from initiator to responder with the first message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct X3dhHeader {
    /// Initiator's identity public key
    pub identity_key: Vec<u8>,
    /// Initiator's ephemeral public key
    pub ephemeral_key: Vec<u8>,
    /// ID of the signed prekey that was used
    pub signed_prekey_id: u32,
    /// ID of the one-time prekey that was used (if any)
    pub one_time_prekey_id: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_x3dh_key_agreement() {
        // Generate Alice's identity key
        let alice_identity = IdentityKeyPair::generate();

        // Generate Bob's keys
        let bob_identity = IdentityKeyPair::generate();
        let bob_signed_prekey = Curve25519KeyPair::generate();
        let bob_otk = Curve25519KeyPair::generate();

        // Create Bob's prekey bundle
        let bob_bundle = PreKeyBundle {
            identity_key: bob_identity.public_key_bytes(),
            signed_prekey: SignedPreKey::new(1, &bob_signed_prekey, &bob_identity),
            one_time_prekey: Some(OneTimePreKey::new(1, &bob_otk)),
        };

        // Alice initiates X3DH
        let alice_result = x3dh_initiate(&alice_identity, &bob_bundle).unwrap();

        // Bob responds with the same calculation
        let alice_ephemeral =
            Curve25519PublicKey::from_slice(&alice_result.ephemeral_public).unwrap();

        let bob_result = x3dh_respond(
            &bob_identity,
            &bob_signed_prekey,
            Some(&bob_otk),
            &alice_identity.public,
            &alice_ephemeral,
        )
        .unwrap();

        // Both should derive the same shared secret
        assert_eq!(alice_result.shared_secret, bob_result);
        assert_eq!(alice_result.used_one_time_prekey, Some(1));
    }

    #[test]
    fn test_x3dh_without_one_time_prekey() {
        let alice_identity = IdentityKeyPair::generate();
        let bob_identity = IdentityKeyPair::generate();
        let bob_signed_prekey = Curve25519KeyPair::generate();

        // Bundle without one-time prekey
        let bob_bundle = PreKeyBundle {
            identity_key: bob_identity.public_key_bytes(),
            signed_prekey: SignedPreKey::new(1, &bob_signed_prekey, &bob_identity),
            one_time_prekey: None,
        };

        let alice_result = x3dh_initiate(&alice_identity, &bob_bundle).unwrap();

        let alice_ephemeral =
            Curve25519PublicKey::from_slice(&alice_result.ephemeral_public).unwrap();

        let bob_result = x3dh_respond(
            &bob_identity,
            &bob_signed_prekey,
            None, // No one-time prekey
            &alice_identity.public,
            &alice_ephemeral,
        )
        .unwrap();

        assert_eq!(alice_result.shared_secret, bob_result);
        assert_eq!(alice_result.used_one_time_prekey, None);
    }

    #[test]
    fn test_bundle_verification() {
        let identity = IdentityKeyPair::generate();
        let prekey = Curve25519KeyPair::generate();

        let bundle = PreKeyBundle {
            identity_key: identity.public_key_bytes(),
            signed_prekey: SignedPreKey::new(1, &prekey, &identity),
            one_time_prekey: None,
        };

        // Valid bundle should verify
        assert!(bundle.verify().is_ok());

        // Modified bundle should fail
        let mut bad_bundle = bundle.clone();
        bad_bundle.signed_prekey.signature[0] ^= 0xFF;
        assert!(bad_bundle.verify().is_err());
    }
}
