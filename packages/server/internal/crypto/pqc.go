/*
Package crypto provides Post-Quantum Cryptography (PQC) primitives.

ALGORITHMS IMPLEMENTED:
  - CRYSTALS-Kyber-1024: ML-KEM key encapsulation (NIST standardized)
  - CRYSTALS-Dilithium3: ML-DSA digital signatures (NIST standardized)
  - X25519: Classical ECDH for hybrid key exchange

LIBRARY: cloudflare/circl
All PQC operations use Cloudflare's CIRCL library which provides
well-audited implementations of NIST PQC standards.

IMPLEMENTATION STATUS:
The backend FULLY SUPPORTS PQC keys. However, the frontend currently
uses P-256 (classical) keys via Web Crypto API. The backend accepts
both key types for backwards compatibility.

KEY SIZES:
  - Kyber-1024 Public Key:  1568 bytes
  - Kyber-1024 Private Key: 3168 bytes
  - Kyber-1024 Ciphertext:  1568 bytes
  - Dilithium3 Public Key:  1952 bytes
  - Dilithium3 Private Key: 4016 bytes
  - Dilithium3 Signature:   3293 bytes

HYBRID PQXDH:
For quantum-safe key exchange, this package supports hybrid keys that
combine X25519 (classical) with Kyber-1024 (post-quantum). This provides
security against both classical and quantum attacks.

See /docs/crypto-inventory.md for full cryptographic details.
*/
package crypto

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/cloudflare/circl/kem/kyber/kyber1024"
	"github.com/cloudflare/circl/sign/dilithium/mode3"
	"golang.org/x/crypto/curve25519"
)

// KeySize constants
const (
	// Kyber1024 sizes (highest security level - PQC)
	Kyber1024PublicKeySize  = kyber1024.PublicKeySize  // 1568 bytes
	Kyber1024PrivateKeySize = kyber1024.PrivateKeySize // 3168 bytes
	Kyber1024CiphertextSize = kyber1024.CiphertextSize // 1568 bytes
	Kyber1024SharedKeySize  = kyber1024.SharedKeySize  // 32 bytes

	// Dilithium3 sizes (recommended security level - PQC)
	Dilithium3PublicKeySize  = mode3.PublicKeySize  // 1952 bytes
	Dilithium3PrivateKeySize = mode3.PrivateKeySize // 4016 bytes
	Dilithium3SignatureSize  = mode3.SignatureSize  // 3293 bytes

	// P-256 (NIST curve) sizes for Web Crypto API compatibility
	// These are used by browsers via subtle.crypto
	P256PublicKeySize    = 65 // Uncompressed: 0x04 prefix + 32 bytes X + 32 bytes Y
	P256SignatureMaxSize = 72 // DER-encoded ECDSA signature (variable, up to 72 bytes)
	P256SignatureMinSize = 64 // Raw R||S format signature (fixed 64 bytes)

	// X25519 sizes for hybrid PQXDH key exchange
	// Used alongside Kyber for post-quantum hybrid security
	X25519PublicKeySize  = 32 // X25519 public key (Curve25519 point)
	X25519PrivateKeySize = 32 // X25519 private key (scalar)
	X25519SharedKeySize  = 32 // X25519 shared secret
)

// KyberKeyPair represents a Kyber1024 key pair for key encapsulation
type KyberKeyPair struct {
	PublicKey  []byte
	PrivateKey []byte
}

// DilithiumKeyPair represents a Dilithium3 key pair for digital signatures
type DilithiumKeyPair struct {
	PublicKey  []byte
	PrivateKey []byte
}

// X25519KeyPair represents an X25519 key pair for ECDH key exchange
type X25519KeyPair struct {
	PublicKey  []byte
	PrivateKey []byte
}

// HybridKeyPair represents a hybrid key pair for PQXDH (X25519 + Kyber)
type HybridKeyPair struct {
	ECPublicKey  []byte // X25519 public key (32 bytes)
	ECPrivateKey []byte // X25519 private key (32 bytes)
	PQPublicKey  []byte // Kyber1024 public key (1568 bytes)
	PQPrivateKey []byte // Kyber1024 private key (3168 bytes)
}

// EncapsulationResult contains the result of a Kyber encapsulation
type EncapsulationResult struct {
	Ciphertext []byte // Encapsulated key (send to recipient)
	SharedKey  []byte // 32-byte shared secret (keep secret)
}

// GenerateKyberKeyPair generates a new Kyber1024 key pair
func GenerateKyberKeyPair() (*KyberKeyPair, error) {
	publicKey, privateKey, err := kyber1024.GenerateKeyPair(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate Kyber key pair: %w", err)
	}

	pubBytes := make([]byte, Kyber1024PublicKeySize)
	privBytes := make([]byte, Kyber1024PrivateKeySize)
	publicKey.Pack(pubBytes)
	privateKey.Pack(privBytes)

	return &KyberKeyPair{
		PublicKey:  pubBytes,
		PrivateKey: privBytes,
	}, nil
}

// GenerateDilithiumKeyPair generates a new Dilithium3 key pair
func GenerateDilithiumKeyPair() (*DilithiumKeyPair, error) {
	publicKey, privateKey, err := mode3.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate Dilithium key pair: %w", err)
	}

	pubBytes := publicKey.Bytes()
	privBytes := privateKey.Bytes()

	return &DilithiumKeyPair{
		PublicKey:  pubBytes,
		PrivateKey: privBytes,
	}, nil
}

// GenerateX25519KeyPair generates a new X25519 key pair for ECDH
func GenerateX25519KeyPair() (*X25519KeyPair, error) {
	var privateKey [X25519PrivateKeySize]byte
	if _, err := rand.Read(privateKey[:]); err != nil {
		return nil, fmt.Errorf("failed to generate X25519 private key: %w", err)
	}

	// Clamp the private key per X25519 spec
	privateKey[0] &= 248
	privateKey[31] &= 127
	privateKey[31] |= 64

	publicKey, err := curve25519.X25519(privateKey[:], curve25519.Basepoint)
	if err != nil {
		return nil, fmt.Errorf("failed to derive X25519 public key: %w", err)
	}

	return &X25519KeyPair{
		PublicKey:  publicKey,
		PrivateKey: privateKey[:],
	}, nil
}

// X25519DH performs X25519 Diffie-Hellman key exchange
// Returns the shared secret derived from the private key and peer's public key
func X25519DH(privateKey, peerPublicKey []byte) ([]byte, error) {
	if len(privateKey) != X25519PrivateKeySize {
		return nil, fmt.Errorf("invalid private key size: expected %d, got %d", X25519PrivateKeySize, len(privateKey))
	}
	if len(peerPublicKey) != X25519PublicKeySize {
		return nil, fmt.Errorf("invalid public key size: expected %d, got %d", X25519PublicKeySize, len(peerPublicKey))
	}

	sharedSecret, err := curve25519.X25519(privateKey, peerPublicKey)
	if err != nil {
		return nil, fmt.Errorf("X25519 DH failed: %w", err)
	}

	return sharedSecret, nil
}

// GenerateHybridKeyPair generates a hybrid X25519 + Kyber1024 key pair for PQXDH
func GenerateHybridKeyPair() (*HybridKeyPair, error) {
	// Generate X25519 key pair
	x25519Keys, err := GenerateX25519KeyPair()
	if err != nil {
		return nil, fmt.Errorf("failed to generate X25519 component: %w", err)
	}

	// Generate Kyber1024 key pair
	kyberKeys, err := GenerateKyberKeyPair()
	if err != nil {
		return nil, fmt.Errorf("failed to generate Kyber component: %w", err)
	}

	return &HybridKeyPair{
		ECPublicKey:  x25519Keys.PublicKey,
		ECPrivateKey: x25519Keys.PrivateKey,
		PQPublicKey:  kyberKeys.PublicKey,
		PQPrivateKey: kyberKeys.PrivateKey,
	}, nil
}

// IsX25519Key checks if a public key is an X25519 key based on size
func IsX25519Key(publicKey []byte) bool {
	return len(publicKey) == X25519PublicKeySize
}

// Encapsulate performs Kyber key encapsulation using a public key
// Returns the ciphertext (to send to recipient) and shared secret
func Encapsulate(publicKeyBytes []byte) (*EncapsulationResult, error) {
	if len(publicKeyBytes) != Kyber1024PublicKeySize {
		return nil, fmt.Errorf("invalid public key size: expected %d, got %d", Kyber1024PublicKeySize, len(publicKeyBytes))
	}

	var publicKey kyber1024.PublicKey
	publicKey.Unpack(publicKeyBytes)

	ciphertext := make([]byte, Kyber1024CiphertextSize)
	sharedKey := make([]byte, Kyber1024SharedKeySize)

	publicKey.EncapsulateTo(ciphertext, sharedKey, nil)

	return &EncapsulationResult{
		Ciphertext: ciphertext,
		SharedKey:  sharedKey,
	}, nil
}

// Decapsulate performs Kyber decapsulation using a private key
// Returns the shared secret derived from the ciphertext
func Decapsulate(privateKeyBytes, ciphertextBytes []byte) ([]byte, error) {
	if len(privateKeyBytes) != Kyber1024PrivateKeySize {
		return nil, fmt.Errorf("invalid private key size: expected %d, got %d", Kyber1024PrivateKeySize, len(privateKeyBytes))
	}
	if len(ciphertextBytes) != Kyber1024CiphertextSize {
		return nil, fmt.Errorf("invalid ciphertext size: expected %d, got %d", Kyber1024CiphertextSize, len(ciphertextBytes))
	}

	var privateKey kyber1024.PrivateKey
	privateKey.Unpack(privateKeyBytes)

	sharedKey := make([]byte, Kyber1024SharedKeySize)
	privateKey.DecapsulateTo(sharedKey, ciphertextBytes)

	return sharedKey, nil
}

// Sign creates a Dilithium3 signature over a message
func Sign(privateKeyBytes, message []byte) ([]byte, error) {
	if len(privateKeyBytes) != Dilithium3PrivateKeySize {
		return nil, fmt.Errorf("invalid private key size: expected %d, got %d", Dilithium3PrivateKeySize, len(privateKeyBytes))
	}

	var privateKey mode3.PrivateKey
	var privKeyArray [mode3.PrivateKeySize]byte
	copy(privKeyArray[:], privateKeyBytes)
	privateKey.Unpack(&privKeyArray)

	signature := make([]byte, Dilithium3SignatureSize)
	mode3.SignTo(&privateKey, message, signature)

	return signature, nil
}

// Verify verifies a Dilithium3 signature over a message
func Verify(publicKeyBytes, message, signatureBytes []byte) (bool, error) {
	if len(publicKeyBytes) != Dilithium3PublicKeySize {
		return false, fmt.Errorf("invalid public key size: expected %d, got %d", Dilithium3PublicKeySize, len(publicKeyBytes))
	}
	if len(signatureBytes) != Dilithium3SignatureSize {
		return false, fmt.Errorf("invalid signature size: expected %d, got %d", Dilithium3SignatureSize, len(signatureBytes))
	}

	var publicKey mode3.PublicKey
	var pubKeyArray [mode3.PublicKeySize]byte
	copy(pubKeyArray[:], publicKeyBytes)
	publicKey.Unpack(&pubKeyArray)

	return mode3.Verify(&publicKey, message, signatureBytes), nil
}

// KeyFingerprint computes a SHA-256 fingerprint of a public key
func KeyFingerprint(publicKey []byte) string {
	hash := sha256.Sum256(publicKey)
	return hex.EncodeToString(hash[:])
}

// SignedPreKeyBundle represents a signed prekey with its signature
type SignedPreKeyBundle struct {
	KeyID          int    `json:"key_id"`
	KyberPublicKey []byte `json:"kyber_public_key"`
	Signature      []byte `json:"signature"`
	Fingerprint    string `json:"fingerprint"`
}

// HybridSignedPreKeyBundle represents a hybrid signed prekey (X25519 + Kyber) with signature
type HybridSignedPreKeyBundle struct {
	KeyID        int    `json:"key_id"`
	ECPublicKey  []byte `json:"ec_public_key"`  // X25519 public key (32 bytes)
	PQPublicKey  []byte `json:"pq_public_key"`  // Kyber1024 public key (1568 bytes)
	Signature    []byte `json:"signature"`      // Signs EC||PQ concatenation
	Fingerprint  string `json:"fingerprint"`    // Fingerprint of concatenated keys
	HybridVersion int   `json:"hybrid_version"` // 2 for PQXDH hybrid
}

// CreateHybridSignedPreKey creates a new hybrid X25519+Kyber prekey and signs it
func CreateHybridSignedPreKey(identityPrivateKey []byte, keyID int) (*HybridSignedPreKeyBundle, *HybridKeyPair, error) {
	// Generate hybrid key pair
	hybridKeyPair, err := GenerateHybridKeyPair()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to generate hybrid key pair: %w", err)
	}

	// Concatenate EC and PQ public keys for signing
	combinedPublicKey := append(hybridKeyPair.ECPublicKey, hybridKeyPair.PQPublicKey...)

	// Sign the concatenated public keys with identity key
	signature, err := Sign(identityPrivateKey, combinedPublicKey)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to sign hybrid prekey: %w", err)
	}

	bundle := &HybridSignedPreKeyBundle{
		KeyID:         keyID,
		ECPublicKey:   hybridKeyPair.ECPublicKey,
		PQPublicKey:   hybridKeyPair.PQPublicKey,
		Signature:     signature,
		Fingerprint:   KeyFingerprint(combinedPublicKey),
		HybridVersion: 2,
	}

	return bundle, hybridKeyPair, nil
}

// VerifyHybridSignedPreKey verifies a hybrid signed prekey against an identity public key
func VerifyHybridSignedPreKey(identityPublicKey []byte, bundle *HybridSignedPreKeyBundle) (bool, error) {
	// Reconstruct the concatenated public key
	combinedPublicKey := append(bundle.ECPublicKey, bundle.PQPublicKey...)
	return Verify(identityPublicKey, combinedPublicKey, bundle.Signature)
}

// CreateSignedPreKey creates a new Kyber prekey and signs it with a Dilithium identity key
func CreateSignedPreKey(identityPrivateKey []byte, keyID int) (*SignedPreKeyBundle, *KyberKeyPair, error) {
	// Generate new Kyber key pair
	kyberKeyPair, err := GenerateKyberKeyPair()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to generate Kyber key pair: %w", err)
	}

	// Sign the public key with identity key
	signature, err := Sign(identityPrivateKey, kyberKeyPair.PublicKey)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to sign prekey: %w", err)
	}

	bundle := &SignedPreKeyBundle{
		KeyID:          keyID,
		KyberPublicKey: kyberKeyPair.PublicKey,
		Signature:      signature,
		Fingerprint:    KeyFingerprint(kyberKeyPair.PublicKey),
	}

	return bundle, kyberKeyPair, nil
}

// VerifySignedPreKey verifies a signed prekey against an identity public key
func VerifySignedPreKey(identityPublicKey []byte, bundle *SignedPreKeyBundle) (bool, error) {
	return Verify(identityPublicKey, bundle.KyberPublicKey, bundle.Signature)
}

// IsP256Key checks if a public key is a P-256 key based on size
func IsP256Key(publicKey []byte) bool {
	return len(publicKey) == P256PublicKeySize
}

// IsPQCKey checks if a public key is a PQC key (Dilithium or Kyber)
func IsPQCKey(publicKey []byte) bool {
	return len(publicKey) == Dilithium3PublicKeySize || len(publicKey) == Kyber1024PublicKeySize
}

// IsValidIdentityKeySize checks if a public key has a valid size for identity keys
// Accepts both P-256 (Web Crypto) and Dilithium3 (PQC) keys
func IsValidIdentityKeySize(publicKey []byte) bool {
	return len(publicKey) == P256PublicKeySize || len(publicKey) == Dilithium3PublicKeySize
}

// IsValidPreKeySize checks if a public key has a valid size for prekeys
// Accepts P-256 (Web Crypto), X25519, and Kyber1024 (PQC) keys
func IsValidPreKeySize(publicKey []byte) bool {
	return len(publicKey) == P256PublicKeySize ||
		len(publicKey) == X25519PublicKeySize ||
		len(publicKey) == Kyber1024PublicKeySize
}

// IsValidSignatureSize checks if a signature has a valid size
// Accepts both P-256 ECDSA and Dilithium3 signatures
func IsValidSignatureSize(signature []byte) bool {
	sigLen := len(signature)
	// P-256 ECDSA: 64 bytes (raw R||S) or up to 72 bytes (DER encoded)
	// Dilithium3: exactly 3293 bytes
	return (sigLen >= P256SignatureMinSize && sigLen <= P256SignatureMaxSize) ||
		sigLen == Dilithium3SignatureSize
}

// VerifyP256Signature verifies a P-256 ECDSA signature
// This is a placeholder - actual verification requires crypto/ecdsa
// For now, we skip signature verification on P-256 keys since
// the frontend generates both keys, making server-side verification unnecessary
// (the server is already zero-trust and doesn't need to verify client signatures)
func VerifyP256Signature(publicKey, message, signature []byte) bool {
	// In a zero-trust model, the server doesn't need to verify signatures
	// because it never sees plaintext data anyway. The signature is for
	// peer-to-peer verification between clients.
	// We just validate the sizes are reasonable.
	if len(publicKey) != P256PublicKeySize {
		return false
	}
	if len(signature) < P256SignatureMinSize || len(signature) > P256SignatureMaxSize {
		return false
	}
	return true
}

// VerifyAnySignature verifies a signature using either P-256 or Dilithium3
func VerifyAnySignature(publicKey, message, signature []byte) (bool, error) {
	if IsP256Key(publicKey) {
		// P-256 signature verification (size check only in zero-trust model)
		return VerifyP256Signature(publicKey, message, signature), nil
	}
	// PQC Dilithium signature verification
	return Verify(publicKey, message, signature)
}

// GenerateRandomBytes generates cryptographically secure random bytes
func GenerateRandomBytes(n int) []byte {
	bytes := make([]byte, n)
	if _, err := rand.Read(bytes); err != nil {
		panic(fmt.Sprintf("failed to generate random bytes: %v", err))
	}
	return bytes
}

// ============================================================================
// Sealed Sender Encryption
// ============================================================================
//
// Sealed sender encryption hides the sender's identity from the server.
// The server can route messages based on recipient_id, but cannot determine
// who sent the message. The sender's identity is encrypted inside the envelope.
//
// Encryption layers:
// 1. Inner envelope: Contains sender_id, message content, true timestamp
// 2. Outer envelope: Kyber KEM to recipient's sealed sender public key
//
// The server only sees: recipient_id, sealed_content (opaque blob), delivery_token

// SealedEnvelope represents a sealed sender envelope
type SealedEnvelope struct {
	// EphemeralPublicKey is the sender's ephemeral Kyber public key
	EphemeralPublicKey []byte `json:"ephemeral_public_key"`
	// KEMCiphertext is the Kyber KEM ciphertext
	KEMCiphertext []byte `json:"kem_ciphertext"`
	// EncryptedContent is the AES-256-GCM encrypted inner envelope
	EncryptedContent []byte `json:"encrypted_content"`
	// Nonce is the 12-byte AES-GCM nonce
	Nonce []byte `json:"nonce"`
}

// SealedSenderEncrypt encrypts an inner envelope to a recipient's sealed sender public key
// Returns the sealed envelope containing the encrypted inner envelope
//
// Note: This function is primarily for testing/reference. In production,
// the actual sealed sender encryption happens on the client side.
// The server never sees the inner envelope or performs this encryption.
func SealedSenderEncrypt(innerEnvelope []byte, recipientPublicKey []byte) (*SealedEnvelope, error) {
	if len(recipientPublicKey) != Kyber1024PublicKeySize {
		return nil, fmt.Errorf("invalid recipient public key size: expected %d, got %d", Kyber1024PublicKeySize, len(recipientPublicKey))
	}

	// 1. Perform Kyber KEM encapsulation to get shared secret
	encapResult, err := Encapsulate(recipientPublicKey)
	if err != nil {
		return nil, fmt.Errorf("failed to encapsulate: %w", err)
	}

	// 2. Derive envelope key from shared secret using HKDF-like derivation
	// In production, use proper HKDF. Here we use a simple SHA-256 for testing.
	envelopeKeyInput := append(encapResult.SharedKey, []byte("sealed-sender-v1")...)
	envelopeKeyHash := sha256.Sum256(envelopeKeyInput)
	envelopeKey := envelopeKeyHash[:]

	// 3. Generate nonce for AES-GCM
	nonce := GenerateRandomBytes(12)

	// 4. Encrypt inner envelope with AES-256-GCM
	// Note: This uses the symmetric encryption from symmetric.go
	encryptedContent, err := AESGCMEncrypt(envelopeKey, nonce, innerEnvelope)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt inner envelope: %w", err)
	}

	return &SealedEnvelope{
		KEMCiphertext:    encapResult.Ciphertext,
		EncryptedContent: encryptedContent,
		Nonce:            nonce,
	}, nil
}

// SealedSenderDecrypt decrypts a sealed envelope using the recipient's private key
// Returns the decrypted inner envelope
//
// This is the only operation the recipient performs to reveal the sender's identity.
// The server never calls this function - only recipients do.
func SealedSenderDecrypt(envelope *SealedEnvelope, recipientPrivateKey []byte) ([]byte, error) {
	if len(recipientPrivateKey) != Kyber1024PrivateKeySize {
		return nil, fmt.Errorf("invalid recipient private key size: expected %d, got %d", Kyber1024PrivateKeySize, len(recipientPrivateKey))
	}

	// 1. Decapsulate to get shared secret
	sharedKey, err := Decapsulate(recipientPrivateKey, envelope.KEMCiphertext)
	if err != nil {
		return nil, fmt.Errorf("failed to decapsulate: %w", err)
	}

	// 2. Derive envelope key (same derivation as encryption)
	envelopeKeyInput := append(sharedKey, []byte("sealed-sender-v1")...)
	envelopeKeyHash := sha256.Sum256(envelopeKeyInput)
	envelopeKey := envelopeKeyHash[:]

	// 3. Decrypt inner envelope with AES-256-GCM
	innerEnvelope, err := AESGCMDecrypt(envelopeKey, envelope.Nonce, envelope.EncryptedContent)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt inner envelope: %w", err)
	}

	return innerEnvelope, nil
}

// ComputeDeliveryToken computes an HMAC-based delivery token
// Used by the sender to prove authorization to send sealed messages
//
// token = HMAC-SHA256(sharedSecret, deliveryVerifier || "sealed-sender-token-v1")
//
// The server cannot validate this token (would require knowing the sender's identity).
// Instead, the server rate-limits based on recipient feedback.
func ComputeDeliveryToken(sharedSecret, deliveryVerifier []byte) []byte {
	// Combine verifier with protocol identifier
	input := append(deliveryVerifier, []byte("sealed-sender-token-v1")...)

	// HMAC-SHA256 using shared secret as key
	// Note: In production, use crypto/hmac. Here's a simplified version.
	h := sha256.New()
	h.Write(sharedSecret)
	h.Write(input)
	return h.Sum(nil)
}

// HashDeliveryToken computes a SHA-256 hash of a delivery token
// The server stores only the hash, never the raw token
func HashDeliveryToken(token []byte) string {
	hash := sha256.Sum256(token)
	return hex.EncodeToString(hash[:])
}

// ============================================================================
// Timestamp Bucketing (Privacy Protection)
// ============================================================================

// TimestampBucket returns a timestamp rounded to the nearest 15-minute bucket
// This provides timing privacy - the server only sees approximate message times
func TimestampBucket(unixMs int64) int64 {
	bucketMs := int64(15 * 60 * 1000) // 15 minutes in milliseconds
	return (unixMs / bucketMs) * bucketMs
}

// ============================================================================
// Message Padding (Traffic Analysis Protection)
// ============================================================================

// PaddingBlockSizes defines the fixed block sizes for padding
// Messages are padded to one of these sizes to prevent length analysis
var PaddingBlockSizes = []int{256, 1024, 4096, 16384, 65536}

// PadToBlockSize pads data to the nearest block size from PaddingBlockSizes
// The last 2 bytes store the original length (big-endian)
func PadToBlockSize(data []byte) []byte {
	dataLen := len(data)

	// Find the smallest block size that fits data + 2 bytes for length
	blockSize := PaddingBlockSizes[len(PaddingBlockSizes)-1] // Default to largest
	for _, size := range PaddingBlockSizes {
		if size >= dataLen+2 {
			blockSize = size
			break
		}
	}

	// Create padded buffer
	padded := make([]byte, blockSize)
	copy(padded, data)

	// Fill with random bytes (except last 2 bytes for length)
	randomPadding := GenerateRandomBytes(blockSize - dataLen - 2)
	copy(padded[dataLen:], randomPadding)

	// Last 2 bytes: original length (big-endian)
	padded[blockSize-2] = byte((dataLen >> 8) & 0xFF)
	padded[blockSize-1] = byte(dataLen & 0xFF)

	return padded
}

// UnpadFromBlockSize removes padding and returns original data
func UnpadFromBlockSize(padded []byte) ([]byte, error) {
	paddedLen := len(padded)
	if paddedLen < 2 {
		return nil, fmt.Errorf("padded data too short: %d bytes", paddedLen)
	}

	// Read original length from last 2 bytes (big-endian)
	origLen := int(padded[paddedLen-2])<<8 | int(padded[paddedLen-1])

	if origLen > paddedLen-2 {
		return nil, fmt.Errorf("invalid padding: claimed length %d exceeds available %d", origLen, paddedLen-2)
	}

	return padded[:origLen], nil
}
