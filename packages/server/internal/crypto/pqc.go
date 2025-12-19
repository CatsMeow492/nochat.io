// Package crypto provides Post-Quantum Cryptography (PQC) primitives
// using CRYSTALS-Kyber for key encapsulation and CRYSTALS-Dilithium for signatures.
package crypto

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/cloudflare/circl/kem/kyber/kyber1024"
	"github.com/cloudflare/circl/sign/dilithium/mode3"
)

// KeySize constants
const (
	// Kyber1024 sizes (highest security level)
	Kyber1024PublicKeySize  = kyber1024.PublicKeySize  // 1568 bytes
	Kyber1024PrivateKeySize = kyber1024.PrivateKeySize // 3168 bytes
	Kyber1024CiphertextSize = kyber1024.CiphertextSize // 1568 bytes
	Kyber1024SharedKeySize  = kyber1024.SharedKeySize  // 32 bytes

	// Dilithium3 sizes (recommended security level)
	Dilithium3PublicKeySize  = mode3.PublicKeySize  // 1952 bytes
	Dilithium3PrivateKeySize = mode3.PrivateKeySize // 4016 bytes
	Dilithium3SignatureSize  = mode3.SignatureSize  // 3293 bytes
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
