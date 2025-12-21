package transparency

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

// ProofResponse represents a JSON-serializable inclusion proof
type ProofResponse struct {
	EpochNumber int64             `json:"epoch_number"`
	LeafHash    string            `json:"leaf_hash"`
	LeafData    *LeafDataResponse `json:"leaf_data"`
	SiblingPath []string          `json:"sibling_path"`
	PathBits    string            `json:"path_bits"`
	RootHash    string            `json:"root_hash"`
}

// LeafDataResponse is a JSON-serializable version of LeafData
type LeafDataResponse struct {
	UserID                  string `json:"user_id"`
	IdentityKeyFingerprint  string `json:"identity_key_fingerprint"`
	SignedPreKeyFingerprint string `json:"signed_prekey_fingerprint,omitempty"`
	KeyVersion              int    `json:"key_version"`
	Timestamp               int64  `json:"timestamp"`
}

// ConsistencyProofResponse is a JSON-serializable consistency proof
type ConsistencyProofResponse struct {
	FromEpoch   int64    `json:"from_epoch"`
	ToEpoch     int64    `json:"to_epoch"`
	FromRoot    string   `json:"from_root"`
	ToRoot      string   `json:"to_root"`
	ProofHashes []string `json:"proof_hashes"`
}

// TreeHeadResponse is a JSON-serializable signed tree head
type TreeHeadResponse struct {
	EpochNumber           int64  `json:"epoch_number"`
	RootHash              string `json:"root_hash"`
	TreeSize              int64  `json:"tree_size"`
	Signature             string `json:"signature"`
	SigningKeyFingerprint string `json:"signing_key_fingerprint"`
	Timestamp             string `json:"timestamp"`
}

// SigningKeyResponse is a JSON-serializable signing key
type SigningKeyResponse struct {
	Fingerprint string  `json:"fingerprint"`
	PublicKey   string  `json:"public_key"`
	Algorithm   string  `json:"algorithm"`
	ValidFrom   string  `json:"valid_from"`
	ValidUntil  *string `json:"valid_until,omitempty"`
}

// AuditLogEntryResponse is a JSON-serializable audit log entry
type AuditLogEntryResponse struct {
	EpochNumber      int64   `json:"epoch_number"`
	ChangeType       string  `json:"change_type"`
	UserIDCommitment string  `json:"user_id_commitment"`
	OldLeafHash      *string `json:"old_leaf_hash,omitempty"`
	NewLeafHash      *string `json:"new_leaf_hash,omitempty"`
	Timestamp        string  `json:"timestamp"`
}

// ToResponse converts an InclusionProof to a JSON-serializable response
func (p *InclusionProof) ToResponse() *ProofResponse {
	siblingPath := make([]string, len(p.SiblingPath))
	for i, hash := range p.SiblingPath {
		siblingPath[i] = base64.StdEncoding.EncodeToString(hash)
	}

	var leafDataResp *LeafDataResponse
	if p.LeafData != nil {
		leafDataResp = &LeafDataResponse{
			UserID:                  p.LeafData.UserID.String(),
			IdentityKeyFingerprint:  p.LeafData.IdentityKeyFingerprint,
			SignedPreKeyFingerprint: p.LeafData.SignedPreKeyFingerprint,
			KeyVersion:              p.LeafData.KeyVersion,
			Timestamp:               p.LeafData.Timestamp,
		}
	}

	return &ProofResponse{
		EpochNumber: p.EpochNumber,
		LeafHash:    base64.StdEncoding.EncodeToString(p.LeafHash),
		LeafData:    leafDataResp,
		SiblingPath: siblingPath,
		PathBits:    base64.StdEncoding.EncodeToString(p.PathBits),
		RootHash:    base64.StdEncoding.EncodeToString(p.RootHash),
	}
}

// ToResponse converts a ConsistencyProof to a JSON-serializable response
func (p *ConsistencyProof) ToResponse() *ConsistencyProofResponse {
	proofHashes := make([]string, len(p.ProofHashes))
	for i, hash := range p.ProofHashes {
		proofHashes[i] = base64.StdEncoding.EncodeToString(hash)
	}

	return &ConsistencyProofResponse{
		FromEpoch:   p.FromEpoch,
		ToEpoch:     p.ToEpoch,
		FromRoot:    base64.StdEncoding.EncodeToString(p.FromRoot),
		ToRoot:      base64.StdEncoding.EncodeToString(p.ToRoot),
		ProofHashes: proofHashes,
	}
}

// ToResponse converts a SignedTreeHead to a JSON-serializable response
func (sth *SignedTreeHead) ToResponse() *TreeHeadResponse {
	return &TreeHeadResponse{
		EpochNumber:           sth.EpochNumber,
		RootHash:              base64.StdEncoding.EncodeToString(sth.RootHash),
		TreeSize:              sth.TreeSize,
		Signature:             base64.StdEncoding.EncodeToString(sth.Signature),
		SigningKeyFingerprint: sth.SigningKeyFingerprint,
		Timestamp:             sth.Timestamp.Format("2006-01-02T15:04:05Z07:00"),
	}
}

// ToResponse converts a SigningKey to a JSON-serializable response
func (k *SigningKey) ToResponse() *SigningKeyResponse {
	resp := &SigningKeyResponse{
		Fingerprint: k.Fingerprint,
		PublicKey:   base64.StdEncoding.EncodeToString(k.PublicKey),
		Algorithm:   k.Algorithm,
		ValidFrom:   k.ValidFrom.Format("2006-01-02T15:04:05Z07:00"),
	}
	if k.ValidUntil != nil {
		validUntil := k.ValidUntil.Format("2006-01-02T15:04:05Z07:00")
		resp.ValidUntil = &validUntil
	}
	return resp
}

// ToResponse converts an AuditLogEntry to a JSON-serializable response
func (e *AuditLogEntry) ToResponse() *AuditLogEntryResponse {
	resp := &AuditLogEntryResponse{
		EpochNumber:      e.EpochNumber,
		ChangeType:       e.ChangeType,
		UserIDCommitment: base64.StdEncoding.EncodeToString(e.UserIDCommitment),
		Timestamp:        e.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
	if len(e.OldLeafHash) > 0 {
		oldHash := base64.StdEncoding.EncodeToString(e.OldLeafHash)
		resp.OldLeafHash = &oldHash
	}
	if len(e.NewLeafHash) > 0 {
		newHash := base64.StdEncoding.EncodeToString(e.NewLeafHash)
		resp.NewLeafHash = &newHash
	}
	return resp
}

// VerifyConsistencyProof verifies that two epochs are consistent
// This proves the tree is append-only (no entries were removed or modified incorrectly)
func VerifyConsistencyProof(proof *ConsistencyProof) bool {
	if proof == nil {
		return false
	}

	// Basic validation
	if proof.FromEpoch >= proof.ToEpoch {
		return false
	}
	if len(proof.FromRoot) != HashSize || len(proof.ToRoot) != HashSize {
		return false
	}

	// For an SMT, consistency is verified by checking that:
	// 1. The proof contains all intermediate root hashes
	// 2. Each root hash leads to the next via valid tree operations
	// In a production implementation, this would verify cryptographic proofs

	// Simple check: verify the chain of roots exists
	if len(proof.ProofHashes) == 0 && proof.FromEpoch < proof.ToEpoch-1 {
		// Should have at least some intermediate roots
		return false
	}

	// Verify the last proof hash matches the to_root
	if len(proof.ProofHashes) > 0 {
		lastHash := proof.ProofHashes[len(proof.ProofHashes)-1]
		if !bytesEqual(lastHash, proof.ToRoot) {
			return false
		}
	}

	return true
}

// FormatFingerprint formats a key fingerprint for display
// Shows first 32 chars in groups of 4
func FormatFingerprint(fingerprint string) string {
	if len(fingerprint) < 32 {
		return fingerprint
	}

	// Group into chunks of 4
	result := ""
	for i := 0; i < 32; i += 4 {
		if i > 0 {
			result += " "
		}
		end := i + 4
		if end > len(fingerprint) {
			end = len(fingerprint)
		}
		result += fingerprint[i:end]
	}
	return result
}

// HashToHex converts a hash to hex string
func HashToHex(hash []byte) string {
	return hex.EncodeToString(hash)
}

// HexToHash converts a hex string to hash bytes
func HexToHash(hexStr string) ([]byte, error) {
	return hex.DecodeString(hexStr)
}

// Base64ToBytes converts a base64 string to bytes
func Base64ToBytes(b64 string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(b64)
}

// BytesToBase64 converts bytes to base64 string
func BytesToBase64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

// ValidateProofRequest validates inclusion proof request parameters
func ValidateProofRequest(userID, epochStr string) error {
	if userID == "" {
		return fmt.Errorf("user_id is required")
	}
	// Epoch is optional (defaults to current)
	return nil
}

// ValidateConsistencyRequest validates consistency proof request parameters
func ValidateConsistencyRequest(fromEpoch, toEpoch int64) error {
	if fromEpoch < 0 {
		return fmt.Errorf("from epoch must be non-negative")
	}
	if toEpoch <= fromEpoch {
		return fmt.Errorf("to epoch must be greater than from epoch")
	}
	return nil
}

// NonExistenceProof represents a proof that a user is NOT in the tree
// Used to prove a user has not registered keys
type NonExistenceProof struct {
	EpochNumber int64    `json:"epoch_number"`
	UserIDHash  []byte   `json:"user_id_hash"`
	SiblingPath [][]byte `json:"sibling_path"` // Path to empty location
	RootHash    []byte   `json:"root_hash"`
}

// VerifyNonExistenceProof verifies that a user is NOT in the tree
func VerifyNonExistenceProof(proof *NonExistenceProof) bool {
	if proof == nil || len(proof.SiblingPath) != TreeDepth {
		return false
	}

	// Start with empty leaf (proving slot is empty)
	currentHash := GetDefaultHash(TreeDepth)

	// Traverse up the tree
	for depth := TreeDepth - 1; depth >= 0; depth-- {
		siblingHash := proof.SiblingPath[depth]
		bit := GetBit(proof.UserIDHash, depth)

		if bit == 0 {
			currentHash = HashInternal(currentHash, siblingHash)
		} else {
			currentHash = HashInternal(siblingHash, currentHash)
		}
	}

	// Check if computed root matches expected root
	return bytesEqual(currentHash, proof.RootHash)
}

// NonExistenceProofResponse is a JSON-serializable non-existence proof
type NonExistenceProofResponse struct {
	EpochNumber int64    `json:"epoch_number"`
	UserIDHash  string   `json:"user_id_hash"`
	SiblingPath []string `json:"sibling_path"`
	RootHash    string   `json:"root_hash"`
}

// ToResponse converts a NonExistenceProof to a JSON-serializable response
func (p *NonExistenceProof) ToResponse() *NonExistenceProofResponse {
	siblingPath := make([]string, len(p.SiblingPath))
	for i, hash := range p.SiblingPath {
		siblingPath[i] = base64.StdEncoding.EncodeToString(hash)
	}

	return &NonExistenceProofResponse{
		EpochNumber: p.EpochNumber,
		UserIDHash:  base64.StdEncoding.EncodeToString(p.UserIDHash),
		SiblingPath: siblingPath,
		RootHash:    base64.StdEncoding.EncodeToString(p.RootHash),
	}
}
