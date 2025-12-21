/*
Package crypto provides symmetric encryption primitives.

ALGORITHMS SUPPORTED:
  - AES-256-GCM: NIST-approved authenticated encryption
  - XChaCha20-Poly1305: Extended-nonce ChaCha20 with Poly1305 MAC

SECURITY PROPERTIES:
Both algorithms provide AEAD (Authenticated Encryption with Associated Data):
  - Confidentiality: 256-bit key provides strong encryption
  - Integrity: Authentication tag detects any tampering
  - Authenticity: Decryption fails if ciphertext modified

NONCE HANDLING:
  - AES-GCM: 12-byte (96-bit) nonce, randomly generated
  - XChaCha20-Poly1305: 24-byte nonce, randomly generated

KEY DERIVATION:
HKDF-SHA256 is used to derive encryption keys from shared secrets.
This ensures domain separation and key independence.

NOTE: This package is used for server-side operations like sealed sender
envelope encryption. Message encryption happens client-side.

See /docs/crypto-inventory.md for full cryptographic details.
*/
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"io"

	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/hkdf"
)

// SymmetricKeySize is the size of symmetric keys (256 bits)
const SymmetricKeySize = 32

// AESGCMNonceSize is the nonce size for AES-GCM
const AESGCMNonceSize = 12

// XChaCha20NonceSize is the nonce size for XChaCha20-Poly1305
const XChaCha20NonceSize = 24

// EncryptedMessage represents an encrypted message with metadata
type EncryptedMessage struct {
	Ciphertext []byte `json:"ciphertext"`
	Nonce      []byte `json:"nonce"`
	Algorithm  string `json:"algorithm"` // "aes-256-gcm" or "xchacha20-poly1305"
}

// GenerateSymmetricKey generates a random 256-bit symmetric key
func GenerateSymmetricKey() ([]byte, error) {
	key := make([]byte, SymmetricKeySize)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("failed to generate random key: %w", err)
	}
	return key, nil
}

// GenerateNonce generates a random nonce of the specified size
func GenerateNonce(size int) ([]byte, error) {
	nonce := make([]byte, size)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("failed to generate random nonce: %w", err)
	}
	return nonce, nil
}

// EncryptAESGCM encrypts plaintext using AES-256-GCM
func EncryptAESGCM(key, plaintext, additionalData []byte) (*EncryptedMessage, error) {
	if len(key) != SymmetricKeySize {
		return nil, fmt.Errorf("invalid key size: expected %d, got %d", SymmetricKeySize, len(key))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	nonce, err := GenerateNonce(gcm.NonceSize())
	if err != nil {
		return nil, err
	}

	ciphertext := gcm.Seal(nil, nonce, plaintext, additionalData)

	return &EncryptedMessage{
		Ciphertext: ciphertext,
		Nonce:      nonce,
		Algorithm:  "aes-256-gcm",
	}, nil
}

// DecryptAESGCM decrypts ciphertext using AES-256-GCM
func DecryptAESGCM(key, ciphertext, nonce, additionalData []byte) ([]byte, error) {
	if len(key) != SymmetricKeySize {
		return nil, fmt.Errorf("invalid key size: expected %d, got %d", SymmetricKeySize, len(key))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	if len(nonce) != gcm.NonceSize() {
		return nil, fmt.Errorf("invalid nonce size: expected %d, got %d", gcm.NonceSize(), len(nonce))
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, additionalData)
	if err != nil {
		return nil, fmt.Errorf("decryption failed: %w", err)
	}

	return plaintext, nil
}

// EncryptXChaCha20 encrypts plaintext using XChaCha20-Poly1305
func EncryptXChaCha20(key, plaintext, additionalData []byte) (*EncryptedMessage, error) {
	if len(key) != SymmetricKeySize {
		return nil, fmt.Errorf("invalid key size: expected %d, got %d", SymmetricKeySize, len(key))
	}

	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create XChaCha20-Poly1305: %w", err)
	}

	nonce, err := GenerateNonce(aead.NonceSize())
	if err != nil {
		return nil, err
	}

	ciphertext := aead.Seal(nil, nonce, plaintext, additionalData)

	return &EncryptedMessage{
		Ciphertext: ciphertext,
		Nonce:      nonce,
		Algorithm:  "xchacha20-poly1305",
	}, nil
}

// DecryptXChaCha20 decrypts ciphertext using XChaCha20-Poly1305
func DecryptXChaCha20(key, ciphertext, nonce, additionalData []byte) ([]byte, error) {
	if len(key) != SymmetricKeySize {
		return nil, fmt.Errorf("invalid key size: expected %d, got %d", SymmetricKeySize, len(key))
	}

	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create XChaCha20-Poly1305: %w", err)
	}

	if len(nonce) != aead.NonceSize() {
		return nil, fmt.Errorf("invalid nonce size: expected %d, got %d", aead.NonceSize(), len(nonce))
	}

	plaintext, err := aead.Open(nil, nonce, ciphertext, additionalData)
	if err != nil {
		return nil, fmt.Errorf("decryption failed: %w", err)
	}

	return plaintext, nil
}

// Encrypt encrypts plaintext using the specified algorithm
func Encrypt(algorithm string, key, plaintext, additionalData []byte) (*EncryptedMessage, error) {
	switch algorithm {
	case "aes-256-gcm":
		return EncryptAESGCM(key, plaintext, additionalData)
	case "xchacha20-poly1305":
		return EncryptXChaCha20(key, plaintext, additionalData)
	default:
		return nil, fmt.Errorf("unsupported algorithm: %s", algorithm)
	}
}

// Decrypt decrypts ciphertext using the message's algorithm
func Decrypt(msg *EncryptedMessage, key, additionalData []byte) ([]byte, error) {
	switch msg.Algorithm {
	case "aes-256-gcm":
		return DecryptAESGCM(key, msg.Ciphertext, msg.Nonce, additionalData)
	case "xchacha20-poly1305":
		return DecryptXChaCha20(key, msg.Ciphertext, msg.Nonce, additionalData)
	default:
		return nil, fmt.Errorf("unsupported algorithm: %s", msg.Algorithm)
	}
}

// DeriveKey derives a key from a master key using HKDF-SHA256
// This is useful for deriving message keys from shared secrets
func DeriveKey(masterKey, salt, info []byte, keyLen int) ([]byte, error) {
	if keyLen > 255*32 {
		return nil, fmt.Errorf("requested key length too large")
	}

	hkdf := hkdf.New(sha256.New, masterKey, salt, info)
	derivedKey := make([]byte, keyLen)
	if _, err := io.ReadFull(hkdf, derivedKey); err != nil {
		return nil, fmt.Errorf("failed to derive key: %w", err)
	}

	return derivedKey, nil
}

// ============================================================================
// Simple AES-GCM helpers (for sealed sender)
// ============================================================================

// AESGCMEncrypt encrypts plaintext with a provided nonce (no additional data)
// Used by sealed sender encryption where nonce is pre-generated
func AESGCMEncrypt(key, nonce, plaintext []byte) ([]byte, error) {
	if len(key) != SymmetricKeySize {
		return nil, fmt.Errorf("invalid key size: expected %d, got %d", SymmetricKeySize, len(key))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	if len(nonce) != gcm.NonceSize() {
		return nil, fmt.Errorf("invalid nonce size: expected %d, got %d", gcm.NonceSize(), len(nonce))
	}

	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)
	return ciphertext, nil
}

// AESGCMDecrypt decrypts ciphertext with a provided nonce (no additional data)
// Used by sealed sender decryption
func AESGCMDecrypt(key, nonce, ciphertext []byte) ([]byte, error) {
	if len(key) != SymmetricKeySize {
		return nil, fmt.Errorf("invalid key size: expected %d, got %d", SymmetricKeySize, len(key))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	if len(nonce) != gcm.NonceSize() {
		return nil, fmt.Errorf("invalid nonce size: expected %d, got %d", gcm.NonceSize(), len(nonce))
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decryption failed: %w", err)
	}

	return plaintext, nil
}
