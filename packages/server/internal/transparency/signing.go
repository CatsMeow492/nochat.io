package transparency

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/binary"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"os"
	"time"
)

// Signer handles signing and verification of tree heads
type Signer struct {
	privateKey  crypto.PrivateKey
	publicKey   crypto.PublicKey
	algorithm   string
	fingerprint string
}

// NewSigner creates a new Signer from a PEM-encoded private key
// Supports Ed25519 and P-256 ECDSA keys
func NewSigner(privateKeyPEM []byte) (*Signer, error) {
	block, _ := pem.Decode(privateKeyPEM)
	if block == nil {
		return nil, fmt.Errorf("failed to parse PEM block")
	}

	var privateKey crypto.PrivateKey
	var publicKey crypto.PublicKey
	var algorithm string

	switch block.Type {
	case "PRIVATE KEY":
		// PKCS#8 format
		key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("failed to parse PKCS#8 private key: %w", err)
		}
		privateKey = key
		switch k := key.(type) {
		case ed25519.PrivateKey:
			algorithm = "ed25519"
			publicKey = k.Public()
		case *ecdsa.PrivateKey:
			if k.Curve == elliptic.P256() {
				algorithm = "p256"
				publicKey = &k.PublicKey
			} else {
				return nil, fmt.Errorf("unsupported ECDSA curve: only P-256 is supported")
			}
		default:
			return nil, fmt.Errorf("unsupported key type: %T", key)
		}

	case "ED25519 PRIVATE KEY":
		if len(block.Bytes) == ed25519.PrivateKeySize {
			privateKey = ed25519.PrivateKey(block.Bytes)
			publicKey = privateKey.(ed25519.PrivateKey).Public()
			algorithm = "ed25519"
		} else {
			return nil, fmt.Errorf("invalid Ed25519 private key size")
		}

	case "EC PRIVATE KEY":
		// SEC 1 format
		key, err := x509.ParseECPrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("failed to parse EC private key: %w", err)
		}
		if key.Curve != elliptic.P256() {
			return nil, fmt.Errorf("unsupported ECDSA curve: only P-256 is supported")
		}
		privateKey = key
		publicKey = &key.PublicKey
		algorithm = "p256"

	default:
		return nil, fmt.Errorf("unsupported PEM block type: %s", block.Type)
	}

	// Compute fingerprint from public key
	fingerprint, err := computePublicKeyFingerprint(publicKey, algorithm)
	if err != nil {
		return nil, fmt.Errorf("failed to compute fingerprint: %w", err)
	}

	return &Signer{
		privateKey:  privateKey,
		publicKey:   publicKey,
		algorithm:   algorithm,
		fingerprint: fingerprint,
	}, nil
}

// NewSignerFromFile loads a signer from a PEM file
func NewSignerFromFile(path string) (*Signer, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read key file: %w", err)
	}
	return NewSigner(data)
}

// NewSignerFromEnv loads a signer from the TRANSPARENCY_SIGNING_KEY environment variable
// The value can be either a file path or a PEM-encoded key
func NewSignerFromEnv() (*Signer, error) {
	keyData := os.Getenv("TRANSPARENCY_SIGNING_KEY")
	if keyData == "" {
		return nil, fmt.Errorf("TRANSPARENCY_SIGNING_KEY environment variable not set")
	}

	// Check if it's a file path
	if _, err := os.Stat(keyData); err == nil {
		return NewSignerFromFile(keyData)
	}

	// Try parsing as PEM directly
	return NewSigner([]byte(keyData))
}

// GenerateEd25519Key generates a new Ed25519 key pair and returns PEM-encoded private key
func GenerateEd25519Key() ([]byte, error) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate Ed25519 key: %w", err)
	}

	pkcs8Key, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal private key: %w", err)
	}

	block := &pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: pkcs8Key,
	}

	return pem.EncodeToMemory(block), nil
}

// Sign signs a tree head and returns the signature
func (s *Signer) Sign(sth *SignedTreeHead) ([]byte, error) {
	// Construct the data to sign:
	// epoch_number (8 bytes) || root_hash (32 bytes) || tree_size (8 bytes) || timestamp (8 bytes)
	data := make([]byte, 8+32+8+8)

	binary.BigEndian.PutUint64(data[0:8], uint64(sth.EpochNumber))
	copy(data[8:40], sth.RootHash)
	binary.BigEndian.PutUint64(data[40:48], uint64(sth.TreeSize))
	binary.BigEndian.PutUint64(data[48:56], uint64(sth.Timestamp.Unix()))

	switch s.algorithm {
	case "ed25519":
		privateKey := s.privateKey.(ed25519.PrivateKey)
		return ed25519.Sign(privateKey, data), nil

	case "p256":
		privateKey := s.privateKey.(*ecdsa.PrivateKey)
		hash := sha256.Sum256(data)
		return ecdsa.SignASN1(rand.Reader, privateKey, hash[:])

	default:
		return nil, fmt.Errorf("unsupported algorithm: %s", s.algorithm)
	}
}

// Verify verifies a tree head signature
func (s *Signer) Verify(sth *SignedTreeHead) bool {
	// Reconstruct the signed data
	data := make([]byte, 8+32+8+8)
	binary.BigEndian.PutUint64(data[0:8], uint64(sth.EpochNumber))
	copy(data[8:40], sth.RootHash)
	binary.BigEndian.PutUint64(data[40:48], uint64(sth.TreeSize))
	binary.BigEndian.PutUint64(data[48:56], uint64(sth.Timestamp.Unix()))

	switch s.algorithm {
	case "ed25519":
		publicKey := s.publicKey.(ed25519.PublicKey)
		return ed25519.Verify(publicKey, data, sth.Signature)

	case "p256":
		publicKey := s.publicKey.(*ecdsa.PublicKey)
		hash := sha256.Sum256(data)
		return ecdsa.VerifyASN1(publicKey, hash[:], sth.Signature)

	default:
		return false
	}
}

// VerifyWithPublicKey verifies a signature using a raw public key
func VerifyWithPublicKey(publicKey []byte, algorithm string, sth *SignedTreeHead) bool {
	// Reconstruct the signed data
	data := make([]byte, 8+32+8+8)
	binary.BigEndian.PutUint64(data[0:8], uint64(sth.EpochNumber))
	copy(data[8:40], sth.RootHash)
	binary.BigEndian.PutUint64(data[40:48], uint64(sth.TreeSize))
	binary.BigEndian.PutUint64(data[48:56], uint64(sth.Timestamp.Unix()))

	switch algorithm {
	case "ed25519":
		if len(publicKey) != ed25519.PublicKeySize {
			return false
		}
		return ed25519.Verify(ed25519.PublicKey(publicKey), data, sth.Signature)

	case "p256":
		pk, err := x509.ParsePKIXPublicKey(publicKey)
		if err != nil {
			// Try parsing as uncompressed point
			x, y := elliptic.Unmarshal(elliptic.P256(), publicKey)
			if x == nil {
				return false
			}
			pk = &ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}
		}
		ecdsaPK, ok := pk.(*ecdsa.PublicKey)
		if !ok {
			return false
		}
		hash := sha256.Sum256(data)
		return ecdsa.VerifyASN1(ecdsaPK, hash[:], sth.Signature)

	default:
		return false
	}
}

// Algorithm returns the signing algorithm
func (s *Signer) Algorithm() string {
	return s.algorithm
}

// Fingerprint returns the key fingerprint
func (s *Signer) Fingerprint() string {
	return s.fingerprint
}

// PublicKeyBytes returns the public key as bytes
func (s *Signer) PublicKeyBytes() ([]byte, error) {
	switch s.algorithm {
	case "ed25519":
		pk := s.publicKey.(ed25519.PublicKey)
		return []byte(pk), nil

	case "p256":
		pk := s.publicKey.(*ecdsa.PublicKey)
		return elliptic.Marshal(pk.Curve, pk.X, pk.Y), nil

	default:
		return nil, fmt.Errorf("unsupported algorithm: %s", s.algorithm)
	}
}

// ToSigningKey creates a SigningKey model from this Signer
func (s *Signer) ToSigningKey() (*SigningKey, error) {
	publicKeyBytes, err := s.PublicKeyBytes()
	if err != nil {
		return nil, err
	}

	return &SigningKey{
		Fingerprint: s.fingerprint,
		PublicKey:   publicKeyBytes,
		Algorithm:   s.algorithm,
		Status:      "active",
		ValidFrom:   time.Now(),
	}, nil
}

// computePublicKeyFingerprint computes the fingerprint of a public key
func computePublicKeyFingerprint(publicKey crypto.PublicKey, algorithm string) (string, error) {
	var keyBytes []byte

	switch algorithm {
	case "ed25519":
		pk := publicKey.(ed25519.PublicKey)
		keyBytes = []byte(pk)

	case "p256":
		pk := publicKey.(*ecdsa.PublicKey)
		keyBytes = elliptic.Marshal(pk.Curve, pk.X, pk.Y)

	default:
		return "", fmt.Errorf("unsupported algorithm: %s", algorithm)
	}

	hash := sha256.Sum256(keyBytes)
	return hex.EncodeToString(hash[:16]), nil // First 16 bytes = 32 hex chars
}

// CreateSignedTreeHead creates and signs a new tree head
func (s *Signer) CreateSignedTreeHead(epochNumber int64, rootHash []byte, treeSize int64) (*SignedTreeHead, error) {
	sth := &SignedTreeHead{
		EpochNumber:           epochNumber,
		RootHash:              rootHash,
		TreeSize:              treeSize,
		SigningKeyFingerprint: s.fingerprint,
		Timestamp:             time.Now(),
	}

	signature, err := s.Sign(sth)
	if err != nil {
		return nil, fmt.Errorf("failed to sign tree head: %w", err)
	}

	sth.Signature = signature
	return sth, nil
}
