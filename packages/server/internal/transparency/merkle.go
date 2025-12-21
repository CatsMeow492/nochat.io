/*
Package transparency implements an Auditable Key Directory (AKD) using Sparse Merkle Trees.

This package provides cryptographic verification that the server serves consistent
public keys to all users, eliminating the need for manual Safety Number verification.

SECURITY OVERVIEW:
- Append-only tree: Keys can be added or rotated, but never deleted
- Signed tree heads: Each epoch's root is signed by the server's transparency key
- Inclusion proofs: Clients can verify their keys are correctly included
- Consistency proofs: Clients can verify the tree only grew (no rollback)

TREE STRUCTURE:
- 256-bit Sparse Merkle Tree (SMT) using SHA-256
- Path is derived from SHA-256(user_id)
- Only non-empty nodes are stored (sparse storage)
- Default hashes for empty subtrees are precomputed

REFERENCES:
- WhatsApp Key Transparency: https://engineering.fb.com/2023/04/13/security/whatsapp-key-transparency/
- CONIKS: https://eprint.iacr.org/2014/1004.pdf
- Certificate Transparency RFC 6962
*/
package transparency

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	// TreeDepth is the depth of the Sparse Merkle Tree (SHA-256 = 256 bits)
	TreeDepth = 256

	// HashSize is the size of SHA-256 output in bytes
	HashSize = 32

	// DefaultBatchInterval is how often to process pending updates
	DefaultBatchInterval = 60 * time.Second

	// MaxProofSize is the maximum number of sibling hashes in a proof
	MaxProofSize = TreeDepth
)

// LeafData represents the data stored at each Merkle tree leaf
type LeafData struct {
	UserID                  uuid.UUID `json:"user_id"`
	IdentityKeyFingerprint  string    `json:"identity_key_fingerprint"`
	SignedPreKeyFingerprint string    `json:"signed_prekey_fingerprint,omitempty"`
	KeyVersion              int       `json:"key_version"`
	Timestamp               int64     `json:"timestamp"` // Unix timestamp
}

// MerkleNode represents a node in the Sparse Merkle Tree
type MerkleNode struct {
	ID         uuid.UUID  `json:"id"`
	Epoch      int64      `json:"epoch"`
	Depth      int        `json:"depth"`
	PathPrefix string     `json:"path_prefix"` // Hex-encoded path bits
	NodeHash   []byte     `json:"node_hash"`
	LeafData   *LeafData  `json:"leaf_data,omitempty"`
	IsLeaf     bool       `json:"is_leaf"`
	CreatedAt  time.Time  `json:"created_at"`
}

// SignedTreeHead represents a signed epoch root (STH)
type SignedTreeHead struct {
	EpochNumber           int64     `json:"epoch_number"`
	RootHash              []byte    `json:"root_hash"`
	TreeSize              int64     `json:"tree_size"`
	Signature             []byte    `json:"signature"`
	SigningKeyFingerprint string    `json:"signing_key_fingerprint"`
	Timestamp             time.Time `json:"timestamp"`
}

// InclusionProof proves a leaf exists in the tree at a specific epoch
type InclusionProof struct {
	EpochNumber int64      `json:"epoch_number"`
	LeafHash    []byte     `json:"leaf_hash"`
	LeafData    *LeafData  `json:"leaf_data"`
	SiblingPath [][]byte   `json:"sibling_path"` // Path from leaf to root
	PathBits    []byte     `json:"path_bits"`    // 32 bytes (256 bits) - the path through the tree
	RootHash    []byte     `json:"root_hash"`
}

// ConsistencyProof proves two epochs are consistent (tree only grew)
type ConsistencyProof struct {
	FromEpoch   int64    `json:"from_epoch"`
	ToEpoch     int64    `json:"to_epoch"`
	FromRoot    []byte   `json:"from_root"`
	ToRoot      []byte   `json:"to_root"`
	ProofHashes [][]byte `json:"proof_hashes"`
}

// KeyUpdate represents a pending key change to be added to the tree
type KeyUpdate struct {
	UserID                  uuid.UUID `json:"user_id"`
	IdentityKeyFingerprint  string    `json:"identity_key_fingerprint"`
	SignedPreKeyFingerprint string    `json:"signed_prekey_fingerprint,omitempty"`
	KeyVersion              int       `json:"key_version"`
	UpdateType              string    `json:"update_type"` // "key_added", "key_updated", "key_revoked"
}

// SigningKey represents a transparency signing key
type SigningKey struct {
	ID          uuid.UUID  `json:"id"`
	Fingerprint string     `json:"fingerprint"`
	PublicKey   []byte     `json:"public_key"`
	Algorithm   string     `json:"algorithm"` // "ed25519" or "p256"
	Status      string     `json:"status"`    // "active", "rotated", "revoked"
	ValidFrom   time.Time  `json:"valid_from"`
	ValidUntil  *time.Time `json:"valid_until,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// KeyDirectoryEntry represents a user's current key state in the directory
type KeyDirectoryEntry struct {
	ID                      uuid.UUID `json:"id"`
	UserID                  uuid.UUID `json:"user_id"`
	UserIDHash              []byte    `json:"user_id_hash"`
	IdentityKeyFingerprint  string    `json:"identity_key_fingerprint"`
	SignedPreKeyFingerprint string    `json:"signed_prekey_fingerprint,omitempty"`
	KeyVersion              int       `json:"key_version"`
	LastEpoch               int64     `json:"last_epoch"`
	LeafHash                []byte    `json:"leaf_hash"`
	CreatedAt               time.Time `json:"created_at"`
	UpdatedAt               time.Time `json:"updated_at"`
}

// AuditLogEntry represents a public audit log entry
type AuditLogEntry struct {
	ID               uuid.UUID  `json:"id"`
	EpochNumber      int64      `json:"epoch_number"`
	ChangeType       string     `json:"change_type"`
	UserIDCommitment []byte     `json:"user_id_commitment"` // Pseudonymous
	OldLeafHash      []byte     `json:"old_leaf_hash,omitempty"`
	NewLeafHash      []byte     `json:"new_leaf_hash,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

// ClientState represents a client's transparency verification state
type ClientState struct {
	UserID               uuid.UUID `json:"user_id"`
	DeviceID             string    `json:"device_id"`
	LastVerifiedEpoch    int64     `json:"last_verified_epoch"`
	LastVerifiedRootHash []byte    `json:"last_verified_root_hash"`
	VerifiedAt           time.Time `json:"verified_at"`
}

// defaultHashes contains precomputed hashes for empty subtrees at each depth
// defaultHashes[i] = hash of empty subtree at depth i
var defaultHashes [TreeDepth + 1][]byte

func init() {
	initDefaultHashes()
}

// initDefaultHashes precomputes the hash of empty subtrees at each level
// H(empty leaf) = SHA256("")
// H(empty at depth i) = SHA256(H(empty at depth i+1) || H(empty at depth i+1))
func initDefaultHashes() {
	// At leaf level (depth 256), empty = hash of nothing
	emptyLeaf := sha256.Sum256(nil)
	defaultHashes[TreeDepth] = emptyLeaf[:]

	// Work up from leaves to root
	for i := TreeDepth - 1; i >= 0; i-- {
		h := sha256.New()
		h.Write(defaultHashes[i+1])
		h.Write(defaultHashes[i+1])
		hash := h.Sum(nil)
		defaultHashes[i] = hash
	}
}

// GetDefaultHash returns the precomputed hash for an empty subtree at the given depth
func GetDefaultHash(depth int) []byte {
	if depth < 0 || depth > TreeDepth {
		return nil
	}
	result := make([]byte, HashSize)
	copy(result, defaultHashes[depth])
	return result
}

// HashLeaf computes the leaf hash from leaf data
// Format: SHA256(user_id || identity_fingerprint || prekey_fingerprint || version || timestamp)
func HashLeaf(data *LeafData) []byte {
	if data == nil {
		return GetDefaultHash(TreeDepth)
	}

	h := sha256.New()
	h.Write(data.UserID[:])
	h.Write([]byte(data.IdentityKeyFingerprint))
	h.Write([]byte(data.SignedPreKeyFingerprint))
	h.Write([]byte(fmt.Sprintf("%d", data.KeyVersion)))
	h.Write([]byte(fmt.Sprintf("%d", data.Timestamp)))
	return h.Sum(nil)
}

// HashInternal computes the hash of an internal node
// Format: SHA256(left_child || right_child)
func HashInternal(left, right []byte) []byte {
	h := sha256.New()
	h.Write(left)
	h.Write(right)
	return h.Sum(nil)
}

// ComputeUserPath returns the SMT path for a user ID
// The path is SHA256(user_id), which gives us 256 bits to traverse the tree
func ComputeUserPath(userID uuid.UUID) []byte {
	hash := sha256.Sum256(userID[:])
	return hash[:]
}

// GetBit returns the bit at the given index in the byte slice
// Index 0 is the most significant bit of the first byte
func GetBit(data []byte, index int) int {
	if index < 0 || index >= len(data)*8 {
		return 0
	}
	byteIndex := index / 8
	bitIndex := 7 - (index % 8)
	return int((data[byteIndex] >> bitIndex) & 1)
}

// PathPrefixAtDepth returns the hex-encoded path prefix for a given depth
// For example, at depth 4, we take the first 4 bits and encode as hex
func PathPrefixAtDepth(pathBits []byte, depth int) string {
	if depth == 0 {
		return ""
	}
	if depth >= TreeDepth {
		return hex.EncodeToString(pathBits)
	}

	// Calculate how many complete bytes and remaining bits
	numBytes := depth / 8
	remainingBits := depth % 8

	if remainingBits == 0 {
		return hex.EncodeToString(pathBits[:numBytes])
	}

	// We need numBytes complete bytes plus partial bits
	result := make([]byte, numBytes+1)
	copy(result[:numBytes], pathBits[:numBytes])

	// Mask the remaining bits
	if numBytes < len(pathBits) {
		mask := byte(0xFF) << (8 - remainingBits)
		result[numBytes] = pathBits[numBytes] & mask
	}

	return hex.EncodeToString(result)
}

// GetSiblingPrefix returns the path prefix for the sibling node
// If the current bit is 0, sibling is 1 (and vice versa)
func GetSiblingPrefix(pathBits []byte, depth int) string {
	if depth == 0 {
		return ""
	}

	// Copy the path bits
	siblingPath := make([]byte, len(pathBits))
	copy(siblingPath, pathBits)

	// Flip the bit at (depth-1) position
	bitIndex := depth - 1
	byteIndex := bitIndex / 8
	bitPosition := 7 - (bitIndex % 8)

	siblingPath[byteIndex] ^= (1 << bitPosition)

	return PathPrefixAtDepth(siblingPath, depth)
}

// VerifyInclusionProof verifies that a leaf is included in the tree
// Returns true if the proof is valid
func VerifyInclusionProof(proof *InclusionProof) bool {
	if proof == nil || len(proof.SiblingPath) != TreeDepth {
		return false
	}

	// Start with the leaf hash
	currentHash := proof.LeafHash
	if proof.LeafData != nil {
		computedLeaf := HashLeaf(proof.LeafData)
		if !bytesEqual(currentHash, computedLeaf) {
			return false
		}
	}

	// Traverse up the tree
	for depth := TreeDepth - 1; depth >= 0; depth-- {
		siblingHash := proof.SiblingPath[depth]
		bit := GetBit(proof.PathBits, depth)

		if bit == 0 {
			// Current node is left child
			currentHash = HashInternal(currentHash, siblingHash)
		} else {
			// Current node is right child
			currentHash = HashInternal(siblingHash, currentHash)
		}
	}

	// Check if computed root matches expected root
	return bytesEqual(currentHash, proof.RootHash)
}

// bytesEqual performs constant-time comparison of two byte slices
func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var result byte
	for i := 0; i < len(a); i++ {
		result |= a[i] ^ b[i]
	}
	return result == 0
}

// LeafDataToJSON serializes LeafData to JSON bytes
func LeafDataToJSON(data *LeafData) ([]byte, error) {
	return json.Marshal(data)
}

// LeafDataFromJSON deserializes LeafData from JSON bytes
func LeafDataFromJSON(data []byte) (*LeafData, error) {
	var leaf LeafData
	if err := json.Unmarshal(data, &leaf); err != nil {
		return nil, err
	}
	return &leaf, nil
}

// ComputeUserIDCommitment creates a pseudonymous commitment for audit logs
// Commitment = SHA256(user_id || epoch_salt)
// This hides the actual user ID while allowing the same user's updates to be linked
func ComputeUserIDCommitment(userID uuid.UUID, epochSalt []byte) []byte {
	h := sha256.New()
	h.Write(userID[:])
	h.Write(epochSalt)
	return h.Sum(nil)
}

// ComputeKeyFingerprint computes SHA-256 fingerprint of a public key
func ComputeKeyFingerprint(publicKey []byte) string {
	hash := sha256.Sum256(publicKey)
	return hex.EncodeToString(hash[:16]) // First 16 bytes = 32 hex chars
}
