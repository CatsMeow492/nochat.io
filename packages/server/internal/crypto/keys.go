/*
Package crypto provides cryptographic key management for nochat.io E2EE.

SECURITY OVERVIEW:
This package manages public key storage and distribution for end-to-end encryption.
The server operates in a zero-trust model - it stores only public keys and encrypted
blobs, never private keys or plaintext content.

KEY TYPES SUPPORTED:
  - Identity Keys: Long-term keys for user identity (P-256 or Dilithium3)
  - Signed PreKeys: Medium-term keys for session establishment (P-256, X25519, or Kyber)
  - One-Time PreKeys: Single-use keys for forward secrecy
  - Sealed Sender Keys: Keys for metadata protection

BACKWARDS COMPATIBILITY:
The server accepts both classical (P-256) and post-quantum (Kyber/Dilithium) keys.
This allows clients to upgrade to PQC at their own pace.

ZERO-TRUST PROPERTIES:
  - Server stores only public keys
  - Private keys never leave client devices
  - Server cannot derive session keys or decrypt messages
  - Key fingerprints allow out-of-band verification

See /docs/crypto-inventory.md for full cryptographic details.
*/
package crypto

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// TransparencyQueuer is an interface for queueing key updates to the transparency service
type TransparencyQueuer interface {
	QueueKeyUpdate(update TransparencyKeyUpdate)
}

// TransparencyKeyUpdate represents a key update for the transparency service
type TransparencyKeyUpdate struct {
	UserID                  uuid.UUID
	IdentityKeyFingerprint  string
	SignedPreKeyFingerprint string
	KeyVersion              int
	UpdateType              string // "key_added", "key_updated", "key_revoked"
}

// Service provides cryptographic key management operations
type Service struct {
	db                  *sql.DB
	transparencyService TransparencyQueuer
}

// NewService creates a new crypto service
func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

// SetTransparencyService sets the transparency service for queueing key updates
func (s *Service) SetTransparencyService(ts TransparencyQueuer) {
	s.transparencyService = ts
}

// IdentityKey represents a user's long-term identity key
type IdentityKey struct {
	ID             uuid.UUID `json:"id"`
	UserID         uuid.UUID `json:"user_id"`
	PublicKey      []byte    `json:"public_key"`
	KeyFingerprint string    `json:"key_fingerprint"`
	KeyVersion     int       `json:"key_version"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"created_at"`
}

// SignedPreKey represents a medium-term signed prekey
type SignedPreKey struct {
	ID             uuid.UUID  `json:"id"`
	UserID         uuid.UUID  `json:"user_id"`
	KeyID          int        `json:"key_id"`
	KyberPublicKey []byte     `json:"kyber_public_key"`
	Signature      []byte     `json:"signature"`
	KeyFingerprint string     `json:"key_fingerprint"`
	Status         string     `json:"status"`
	CreatedAt      time.Time  `json:"created_at"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
}

// OneTimePreKey represents a single-use prekey
type OneTimePreKey struct {
	ID             uuid.UUID  `json:"id"`
	UserID         uuid.UUID  `json:"user_id"`
	KeyID          int        `json:"key_id"`
	KyberPublicKey []byte     `json:"kyber_public_key"`
	Status         string     `json:"status"`
	UsedBy         *uuid.UUID `json:"used_by,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UsedAt         *time.Time `json:"used_at,omitempty"`
}

// PreKeyBundle represents a complete prekey bundle for key exchange
type PreKeyBundle struct {
	UserID               uuid.UUID      `json:"user_id"`
	IdentityKey          *IdentityKey   `json:"identity_key"`
	SignedPreKey         *SignedPreKey  `json:"signed_prekey"`
	OneTimePreKey        *OneTimePreKey `json:"one_time_prekey,omitempty"`
	BundleVersion        int            `json:"bundle_version"`
	GeneratedAt          time.Time      `json:"generated_at"`
}

// HybridSignedPreKey represents a hybrid signed prekey (X25519 + Kyber) for PQXDH
type HybridSignedPreKey struct {
	ID             uuid.UUID  `json:"id"`
	UserID         uuid.UUID  `json:"user_id"`
	KeyID          int        `json:"key_id"`
	ECPublicKey    []byte     `json:"ec_public_key"`    // X25519 (32 bytes)
	PQPublicKey    []byte     `json:"pq_public_key"`    // Kyber1024 (1568 bytes)
	Signature      []byte     `json:"signature"`        // Signs EC||PQ concatenation
	KeyFingerprint string     `json:"key_fingerprint"`
	HybridVersion  int        `json:"hybrid_version"`   // 2 for PQXDH
	Status         string     `json:"status"`
	CreatedAt      time.Time  `json:"created_at"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
}

// HybridOneTimePreKey represents a hybrid one-time prekey (X25519 + Kyber) for PQXDH
type HybridOneTimePreKey struct {
	ID           uuid.UUID  `json:"id"`
	UserID       uuid.UUID  `json:"user_id"`
	KeyID        int        `json:"key_id"`
	ECPublicKey  []byte     `json:"ec_public_key"`   // X25519 (32 bytes)
	PQPublicKey  []byte     `json:"pq_public_key"`   // Kyber1024 (1568 bytes)
	HybridVersion int       `json:"hybrid_version"`  // 2 for PQXDH
	Status       string     `json:"status"`
	UsedBy       *uuid.UUID `json:"used_by,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UsedAt       *time.Time `json:"used_at,omitempty"`
}

// HybridPreKeyBundle represents a complete hybrid prekey bundle for PQXDH
type HybridPreKeyBundle struct {
	UserID             uuid.UUID            `json:"user_id"`
	IdentityKey        *IdentityKey         `json:"identity_key"`
	SignedPreKey       *HybridSignedPreKey  `json:"signed_prekey"`
	OneTimePreKey      *HybridOneTimePreKey `json:"one_time_prekey,omitempty"`
	BundleVersion      int                  `json:"bundle_version"`  // 2 for PQXDH
	GeneratedAt        time.Time            `json:"generated_at"`
}

// StoreIdentityKey stores a new identity key for a user
// Accepts both P-256 (Web Crypto API) and Dilithium3 (PQC) keys
func (s *Service) StoreIdentityKey(ctx context.Context, userID uuid.UUID, publicKey []byte) (*IdentityKey, error) {
	if !IsValidIdentityKeySize(publicKey) {
		return nil, fmt.Errorf("invalid public key size: got %d, expected %d (P-256) or %d (Dilithium3)",
			len(publicKey), P256PublicKeySize, Dilithium3PublicKeySize)
	}

	fingerprint := KeyFingerprint(publicKey)

	// First, mark any existing active keys as rotated
	_, err := s.db.ExecContext(ctx, `
		UPDATE identity_keys
		SET status = 'rotated', rotated_at = NOW()
		WHERE user_id = $1 AND status = 'active'
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to rotate existing identity keys: %w", err)
	}

	// Get the next version number
	var version int
	err = s.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(key_version), 0) + 1 FROM identity_keys WHERE user_id = $1
	`, userID).Scan(&version)
	if err != nil {
		return nil, fmt.Errorf("failed to get next version: %w", err)
	}

	// Insert new identity key
	key := &IdentityKey{
		ID:             uuid.New(),
		UserID:         userID,
		PublicKey:      publicKey,
		KeyFingerprint: fingerprint,
		KeyVersion:     version,
		Status:         "active",
		CreatedAt:      time.Now(),
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO identity_keys (id, user_id, dilithium_public_key, key_fingerprint, key_version, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, key.ID, key.UserID, key.PublicKey, key.KeyFingerprint, key.KeyVersion, key.Status, key.CreatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to store identity key: %w", err)
	}

	// Log the key creation
	s.logKeyRotation(ctx, userID, "identity", "", fingerprint, "initial")

	// Queue update to transparency service
	if s.transparencyService != nil {
		updateType := "key_added"
		if version > 1 {
			updateType = "key_updated"
		}
		s.transparencyService.QueueKeyUpdate(TransparencyKeyUpdate{
			UserID:                 userID,
			IdentityKeyFingerprint: fingerprint,
			KeyVersion:             version,
			UpdateType:             updateType,
		})
	}

	return key, nil
}

// GetIdentityKey retrieves a user's active identity key
func (s *Service) GetIdentityKey(ctx context.Context, userID uuid.UUID) (*IdentityKey, error) {
	key := &IdentityKey{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, dilithium_public_key, key_fingerprint, key_version, status, created_at
		FROM identity_keys
		WHERE user_id = $1 AND status = 'active'
	`, userID).Scan(&key.ID, &key.UserID, &key.PublicKey, &key.KeyFingerprint, &key.KeyVersion, &key.Status, &key.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get identity key: %w", err)
	}

	return key, nil
}

// StoreSignedPreKey stores a signed prekey for a user
// Accepts both P-256 (Web Crypto API) and Kyber1024 (PQC) keys
func (s *Service) StoreSignedPreKey(ctx context.Context, userID uuid.UUID, keyID int, publicKey, signature []byte) (*SignedPreKey, error) {
	if !IsValidPreKeySize(publicKey) {
		return nil, fmt.Errorf("invalid public key size: got %d, expected %d (P-256) or %d (Kyber1024)",
			len(publicKey), P256PublicKeySize, Kyber1024PublicKeySize)
	}
	if !IsValidSignatureSize(signature) {
		return nil, fmt.Errorf("invalid signature size: got %d", len(signature))
	}

	fingerprint := KeyFingerprint(publicKey)
	expiresAt := time.Now().Add(7 * 24 * time.Hour) // 7 days

	// Mark existing signed prekeys as rotated
	_, err := s.db.ExecContext(ctx, `
		UPDATE signed_prekeys
		SET status = 'rotated', rotated_at = NOW()
		WHERE user_id = $1 AND status = 'active'
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to rotate existing signed prekeys: %w", err)
	}

	// Insert new signed prekey
	prekey := &SignedPreKey{
		ID:             uuid.New(),
		UserID:         userID,
		KeyID:          keyID,
		KyberPublicKey: publicKey,
		Signature:      signature,
		KeyFingerprint: fingerprint,
		Status:         "active",
		CreatedAt:      time.Now(),
		ExpiresAt:      &expiresAt,
	}

	// Use UPSERT to handle re-uploading the same key_id (common during development/testing)
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO signed_prekeys (id, user_id, key_id, kyber_public_key, signature, key_fingerprint, status, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (user_id, key_id) DO UPDATE SET
			kyber_public_key = EXCLUDED.kyber_public_key,
			signature = EXCLUDED.signature,
			key_fingerprint = EXCLUDED.key_fingerprint,
			status = EXCLUDED.status,
			expires_at = EXCLUDED.expires_at
	`, prekey.ID, prekey.UserID, prekey.KeyID, prekey.KyberPublicKey, prekey.Signature, prekey.KeyFingerprint, prekey.Status, prekey.CreatedAt, prekey.ExpiresAt)

	if err != nil {
		return nil, fmt.Errorf("failed to store signed prekey: %w", err)
	}

	// Queue update to transparency service (with signed prekey fingerprint)
	if s.transparencyService != nil {
		// Get identity key fingerprint for the update
		identityKey, _ := s.GetIdentityKey(ctx, userID)
		if identityKey != nil {
			s.transparencyService.QueueKeyUpdate(TransparencyKeyUpdate{
				UserID:                  userID,
				IdentityKeyFingerprint:  identityKey.KeyFingerprint,
				SignedPreKeyFingerprint: fingerprint,
				KeyVersion:              identityKey.KeyVersion,
				UpdateType:              "key_updated",
			})
		}
	}

	return prekey, nil
}

// GetSignedPreKey retrieves a user's active signed prekey
func (s *Service) GetSignedPreKey(ctx context.Context, userID uuid.UUID) (*SignedPreKey, error) {
	prekey := &SignedPreKey{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, key_id, kyber_public_key, signature, key_fingerprint, status, created_at, expires_at
		FROM signed_prekeys
		WHERE user_id = $1 AND status = 'active'
		ORDER BY created_at DESC
		LIMIT 1
	`, userID).Scan(&prekey.ID, &prekey.UserID, &prekey.KeyID, &prekey.KyberPublicKey, &prekey.Signature, &prekey.KeyFingerprint, &prekey.Status, &prekey.CreatedAt, &prekey.ExpiresAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get signed prekey: %w", err)
	}

	return prekey, nil
}

// StoreOneTimePreKeys stores a batch of one-time prekeys
func (s *Service) StoreOneTimePreKeys(ctx context.Context, userID uuid.UUID, prekeys []OneTimePreKeyInput) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO one_time_prekeys (id, user_id, key_id, kyber_public_key, status, created_at, expires_at)
		VALUES ($1, $2, $3, $4, 'available', $5, $6)
		ON CONFLICT (user_id, key_id) DO NOTHING
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	now := time.Now()
	expiresAt := now.Add(30 * 24 * time.Hour) // 30 days

	for _, prekey := range prekeys {
		// Accept both P-256 and Kyber1024 keys
		if !IsValidPreKeySize(prekey.KyberPublicKey) {
			return fmt.Errorf("invalid public key size for key %d: got %d bytes", prekey.KeyID, len(prekey.KyberPublicKey))
		}

		_, err = stmt.ExecContext(ctx, uuid.New(), userID, prekey.KeyID, prekey.KyberPublicKey, now, expiresAt)
		if err != nil {
			return fmt.Errorf("failed to store one-time prekey %d: %w", prekey.KeyID, err)
		}
	}

	return tx.Commit()
}

// OneTimePreKeyInput represents input for storing a one-time prekey
type OneTimePreKeyInput struct {
	KeyID          int    `json:"key_id"`
	KyberPublicKey []byte `json:"kyber_public_key"`
}

// ClaimOneTimePreKey atomically claims an available one-time prekey
func (s *Service) ClaimOneTimePreKey(ctx context.Context, targetUserID, claimingUserID uuid.UUID) (*OneTimePreKey, error) {
	prekey := &OneTimePreKey{}
	err := s.db.QueryRowContext(ctx, `
		SELECT prekey_id, key_id, kyber_public_key
		FROM claim_one_time_prekey($1, $2)
	`, targetUserID, claimingUserID).Scan(&prekey.ID, &prekey.KeyID, &prekey.KyberPublicKey)

	if err == sql.ErrNoRows {
		return nil, nil // No available prekeys
	}
	if err != nil {
		return nil, fmt.Errorf("failed to claim one-time prekey: %w", err)
	}

	prekey.UserID = targetUserID
	prekey.Status = "used"
	prekey.UsedBy = &claimingUserID
	now := time.Now()
	prekey.UsedAt = &now

	return prekey, nil
}

// GetAvailableOneTimePreKeyCount returns the count of available one-time prekeys for a user
func (s *Service) GetAvailableOneTimePreKeyCount(ctx context.Context, userID uuid.UUID) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM one_time_prekeys
		WHERE user_id = $1 AND status = 'available'
		AND (expires_at IS NULL OR expires_at > NOW())
	`, userID).Scan(&count)

	if err != nil {
		return 0, fmt.Errorf("failed to count one-time prekeys: %w", err)
	}

	return count, nil
}

// GetPreKeyBundle retrieves a complete prekey bundle for a user
func (s *Service) GetPreKeyBundle(ctx context.Context, targetUserID, requestingUserID uuid.UUID) (*PreKeyBundle, error) {
	bundle := &PreKeyBundle{
		UserID:      targetUserID,
		GeneratedAt: time.Now(),
	}

	// Get identity key
	identityKey, err := s.GetIdentityKey(ctx, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get identity key: %w", err)
	}
	if identityKey == nil {
		return nil, fmt.Errorf("user has no identity key")
	}
	bundle.IdentityKey = identityKey

	// Get signed prekey
	signedPreKey, err := s.GetSignedPreKey(ctx, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get signed prekey: %w", err)
	}
	if signedPreKey == nil {
		return nil, fmt.Errorf("user has no signed prekey")
	}
	bundle.SignedPreKey = signedPreKey

	// Try to claim a one-time prekey
	oneTimePreKey, err := s.ClaimOneTimePreKey(ctx, targetUserID, requestingUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to claim one-time prekey: %w", err)
	}
	bundle.OneTimePreKey = oneTimePreKey // May be nil if none available

	// Get bundle version
	var version int
	err = s.db.QueryRowContext(ctx, `
		SELECT COALESCE(bundle_version, 1) FROM key_bundles WHERE user_id = $1
	`, targetUserID).Scan(&version)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to get bundle version: %w", err)
	}
	bundle.BundleVersion = version

	return bundle, nil
}

// GetPreKeyBundleWithoutClaim retrieves a prekey bundle without claiming a one-time prekey
// Useful for displaying identity verification info
func (s *Service) GetPreKeyBundleWithoutClaim(ctx context.Context, targetUserID uuid.UUID) (*PreKeyBundle, error) {
	bundle := &PreKeyBundle{
		UserID:      targetUserID,
		GeneratedAt: time.Now(),
	}

	identityKey, err := s.GetIdentityKey(ctx, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get identity key: %w", err)
	}
	bundle.IdentityKey = identityKey

	signedPreKey, err := s.GetSignedPreKey(ctx, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get signed prekey: %w", err)
	}
	bundle.SignedPreKey = signedPreKey

	return bundle, nil
}

// CacheKeyBundle caches a serialized key bundle
func (s *Service) CacheKeyBundle(ctx context.Context, userID uuid.UUID, bundle *PreKeyBundle) error {
	bundleData, err := json.Marshal(bundle)
	if err != nil {
		return fmt.Errorf("failed to serialize bundle: %w", err)
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO key_bundles (id, user_id, bundle_data, bundle_version, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			bundle_data = EXCLUDED.bundle_data,
			bundle_version = key_bundles.bundle_version + 1,
			updated_at = NOW()
	`, uuid.New(), userID, bundleData, bundle.BundleVersion)

	if err != nil {
		return fmt.Errorf("failed to cache key bundle: %w", err)
	}

	return nil
}

// logKeyRotation logs a key rotation event
func (s *Service) logKeyRotation(ctx context.Context, userID uuid.UUID, keyType, oldFingerprint, newFingerprint, reason string) {
	_, _ = s.db.ExecContext(ctx, `
		INSERT INTO key_rotation_log (id, user_id, key_type, old_key_fingerprint, new_key_fingerprint, reason, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
	`, uuid.New(), userID, keyType, sql.NullString{String: oldFingerprint, Valid: oldFingerprint != ""}, newFingerprint, reason)
}

// RotateIdentityKey rotates a user's identity key
func (s *Service) RotateIdentityKey(ctx context.Context, userID uuid.UUID, newPublicKey []byte, reason string) (*IdentityKey, error) {
	// Get current identity key for logging
	currentKey, _ := s.GetIdentityKey(ctx, userID)
	oldFingerprint := ""
	if currentKey != nil {
		oldFingerprint = currentKey.KeyFingerprint
	}

	// Store new identity key (this marks old one as rotated)
	newKey, err := s.StoreIdentityKey(ctx, userID, newPublicKey)
	if err != nil {
		return nil, err
	}

	// Log the rotation
	s.logKeyRotation(ctx, userID, "identity", oldFingerprint, newKey.KeyFingerprint, reason)

	return newKey, nil
}

// HasKeys checks if a user has all necessary keys for E2EE
func (s *Service) HasKeys(ctx context.Context, userID uuid.UUID) (bool, error) {
	identityKey, err := s.GetIdentityKey(ctx, userID)
	if err != nil {
		return false, err
	}
	if identityKey == nil {
		return false, nil
	}

	signedPreKey, err := s.GetSignedPreKey(ctx, userID)
	if err != nil {
		return false, err
	}
	if signedPreKey == nil {
		return false, nil
	}

	return true, nil
}

// ============================================================================
// Hybrid PQXDH Key Management (X25519 + Kyber-1024)
// ============================================================================

// StoreHybridSignedPreKey stores a hybrid signed prekey for PQXDH
func (s *Service) StoreHybridSignedPreKey(ctx context.Context, userID uuid.UUID, keyID int, ecPublicKey, pqPublicKey, signature []byte) (*HybridSignedPreKey, error) {
	// Validate X25519 key size
	if len(ecPublicKey) != X25519PublicKeySize {
		return nil, fmt.Errorf("invalid EC public key size: expected %d, got %d", X25519PublicKeySize, len(ecPublicKey))
	}
	// Validate Kyber key size
	if len(pqPublicKey) != Kyber1024PublicKeySize {
		return nil, fmt.Errorf("invalid PQ public key size: expected %d, got %d", Kyber1024PublicKeySize, len(pqPublicKey))
	}
	if !IsValidSignatureSize(signature) {
		return nil, fmt.Errorf("invalid signature size: got %d", len(signature))
	}

	// Fingerprint of concatenated keys
	combinedKey := append(ecPublicKey, pqPublicKey...)
	fingerprint := KeyFingerprint(combinedKey)
	expiresAt := time.Now().Add(7 * 24 * time.Hour) // 7 days

	// Mark existing signed prekeys as rotated
	_, err := s.db.ExecContext(ctx, `
		UPDATE signed_prekeys
		SET status = 'rotated', rotated_at = NOW()
		WHERE user_id = $1 AND status = 'active'
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to rotate existing signed prekeys: %w", err)
	}

	// Insert new hybrid signed prekey
	prekey := &HybridSignedPreKey{
		ID:             uuid.New(),
		UserID:         userID,
		KeyID:          keyID,
		ECPublicKey:    ecPublicKey,
		PQPublicKey:    pqPublicKey,
		Signature:      signature,
		KeyFingerprint: fingerprint,
		HybridVersion:  2,
		Status:         "active",
		CreatedAt:      time.Now(),
		ExpiresAt:      &expiresAt,
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO signed_prekeys (id, user_id, key_id, ec_public_key, kyber_public_key, signature, key_fingerprint, hybrid_version, status, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, prekey.ID, prekey.UserID, prekey.KeyID, prekey.ECPublicKey, prekey.PQPublicKey, prekey.Signature, prekey.KeyFingerprint, prekey.HybridVersion, prekey.Status, prekey.CreatedAt, prekey.ExpiresAt)

	if err != nil {
		return nil, fmt.Errorf("failed to store hybrid signed prekey: %w", err)
	}

	return prekey, nil
}

// GetHybridSignedPreKey retrieves a user's active hybrid signed prekey
func (s *Service) GetHybridSignedPreKey(ctx context.Context, userID uuid.UUID) (*HybridSignedPreKey, error) {
	prekey := &HybridSignedPreKey{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, key_id, ec_public_key, kyber_public_key, signature, key_fingerprint,
		       COALESCE(hybrid_version, 1), status, created_at, expires_at
		FROM signed_prekeys
		WHERE user_id = $1 AND status = 'active' AND ec_public_key IS NOT NULL
		ORDER BY created_at DESC
		LIMIT 1
	`, userID).Scan(&prekey.ID, &prekey.UserID, &prekey.KeyID, &prekey.ECPublicKey, &prekey.PQPublicKey,
		&prekey.Signature, &prekey.KeyFingerprint, &prekey.HybridVersion, &prekey.Status, &prekey.CreatedAt, &prekey.ExpiresAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get hybrid signed prekey: %w", err)
	}

	return prekey, nil
}

// HybridOneTimePreKeyInput represents input for storing a hybrid one-time prekey
type HybridOneTimePreKeyInput struct {
	KeyID       int    `json:"key_id"`
	ECPublicKey []byte `json:"ec_public_key"`  // X25519 (32 bytes)
	PQPublicKey []byte `json:"pq_public_key"`  // Kyber1024 (1568 bytes)
}

// StoreHybridOneTimePreKeys stores a batch of hybrid one-time prekeys
func (s *Service) StoreHybridOneTimePreKeys(ctx context.Context, userID uuid.UUID, prekeys []HybridOneTimePreKeyInput) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO one_time_prekeys (id, user_id, key_id, ec_public_key, kyber_public_key, hybrid_version, status, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'available', $7, $8)
		ON CONFLICT (user_id, key_id) DO NOTHING
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	now := time.Now()
	expiresAt := now.Add(30 * 24 * time.Hour) // 30 days

	for _, prekey := range prekeys {
		// Validate X25519 key size
		if len(prekey.ECPublicKey) != X25519PublicKeySize {
			return fmt.Errorf("invalid EC public key size for key %d: expected %d, got %d", prekey.KeyID, X25519PublicKeySize, len(prekey.ECPublicKey))
		}
		// Validate Kyber key size
		if len(prekey.PQPublicKey) != Kyber1024PublicKeySize {
			return fmt.Errorf("invalid PQ public key size for key %d: expected %d, got %d", prekey.KeyID, Kyber1024PublicKeySize, len(prekey.PQPublicKey))
		}

		_, err = stmt.ExecContext(ctx, uuid.New(), userID, prekey.KeyID, prekey.ECPublicKey, prekey.PQPublicKey, 2, now, expiresAt)
		if err != nil {
			return fmt.Errorf("failed to store hybrid one-time prekey %d: %w", prekey.KeyID, err)
		}
	}

	return tx.Commit()
}

// ClaimHybridOneTimePreKey atomically claims an available hybrid one-time prekey
func (s *Service) ClaimHybridOneTimePreKey(ctx context.Context, targetUserID, claimingUserID uuid.UUID) (*HybridOneTimePreKey, error) {
	prekey := &HybridOneTimePreKey{}

	// First try to claim a hybrid prekey
	err := s.db.QueryRowContext(ctx, `
		WITH claimed AS (
			SELECT id, key_id, ec_public_key, kyber_public_key, COALESCE(hybrid_version, 1) as hybrid_version
			FROM one_time_prekeys
			WHERE user_id = $1
			AND status = 'available'
			AND ec_public_key IS NOT NULL
			AND (expires_at IS NULL OR expires_at > NOW())
			ORDER BY created_at ASC
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE one_time_prekeys
		SET status = 'used', used_by = $2, used_at = NOW()
		WHERE id = (SELECT id FROM claimed)
		RETURNING id, key_id, ec_public_key, kyber_public_key, (SELECT hybrid_version FROM claimed)
	`, targetUserID, claimingUserID).Scan(&prekey.ID, &prekey.KeyID, &prekey.ECPublicKey, &prekey.PQPublicKey, &prekey.HybridVersion)

	if err == sql.ErrNoRows {
		return nil, nil // No available hybrid prekeys
	}
	if err != nil {
		return nil, fmt.Errorf("failed to claim hybrid one-time prekey: %w", err)
	}

	prekey.UserID = targetUserID
	prekey.Status = "used"
	prekey.UsedBy = &claimingUserID
	now := time.Now()
	prekey.UsedAt = &now

	return prekey, nil
}

// GetHybridPreKeyBundle retrieves a complete hybrid prekey bundle for PQXDH
func (s *Service) GetHybridPreKeyBundle(ctx context.Context, targetUserID, requestingUserID uuid.UUID) (*HybridPreKeyBundle, error) {
	bundle := &HybridPreKeyBundle{
		UserID:        targetUserID,
		BundleVersion: 2, // PQXDH hybrid
		GeneratedAt:   time.Now(),
	}

	// Get identity key
	identityKey, err := s.GetIdentityKey(ctx, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get identity key: %w", err)
	}
	if identityKey == nil {
		return nil, fmt.Errorf("user has no identity key")
	}
	bundle.IdentityKey = identityKey

	// Get hybrid signed prekey
	signedPreKey, err := s.GetHybridSignedPreKey(ctx, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get hybrid signed prekey: %w", err)
	}
	if signedPreKey == nil {
		return nil, fmt.Errorf("user has no hybrid signed prekey")
	}
	bundle.SignedPreKey = signedPreKey

	// Try to claim a hybrid one-time prekey
	oneTimePreKey, err := s.ClaimHybridOneTimePreKey(ctx, targetUserID, requestingUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to claim hybrid one-time prekey: %w", err)
	}
	bundle.OneTimePreKey = oneTimePreKey // May be nil if none available

	return bundle, nil
}

// HasHybridKeys checks if a user has hybrid keys for PQXDH
func (s *Service) HasHybridKeys(ctx context.Context, userID uuid.UUID) (bool, error) {
	identityKey, err := s.GetIdentityKey(ctx, userID)
	if err != nil {
		return false, err
	}
	if identityKey == nil {
		return false, nil
	}

	hybridPreKey, err := s.GetHybridSignedPreKey(ctx, userID)
	if err != nil {
		return false, err
	}
	if hybridPreKey == nil {
		return false, nil
	}

	return true, nil
}

// ============================================================================
// Sealed Sender Key Management
// ============================================================================

// SealedSenderKey represents a user's sealed sender public key
// Private key is stored ONLY on the client; server stores public key for senders
type SealedSenderKey struct {
	ID             uuid.UUID  `json:"id"`
	UserID         uuid.UUID  `json:"user_id"`
	KyberPublicKey []byte     `json:"kyber_public_key"` // 1568 bytes (Kyber1024)
	KeyFingerprint string     `json:"key_fingerprint"`
	KeyVersion     int        `json:"key_version"`
	Status         string     `json:"status"`
	CreatedAt      time.Time  `json:"created_at"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
}

// SealedSenderBundle extends PreKeyBundle with sealed sender data
type SealedSenderBundle struct {
	*PreKeyBundle
	SealedSenderKey  *SealedSenderKey `json:"sealed_sender_key,omitempty"`
	DeliveryVerifier []byte           `json:"delivery_verifier,omitempty"`
}

// HybridSealedSenderBundle extends HybridPreKeyBundle with sealed sender data
type HybridSealedSenderBundle struct {
	*HybridPreKeyBundle
	SealedSenderKey  *SealedSenderKey `json:"sealed_sender_key,omitempty"`
	DeliveryVerifier []byte           `json:"delivery_verifier,omitempty"`
}

// StoreSealedSenderKey stores a new sealed sender public key for a user
func (s *Service) StoreSealedSenderKey(ctx context.Context, userID uuid.UUID, publicKey []byte) (*SealedSenderKey, error) {
	// Validate Kyber1024 key size
	if len(publicKey) != Kyber1024PublicKeySize {
		return nil, fmt.Errorf("invalid sealed sender key size: expected %d, got %d", Kyber1024PublicKeySize, len(publicKey))
	}

	fingerprint := KeyFingerprint(publicKey)

	// Mark any existing active keys as rotated
	_, err := s.db.ExecContext(ctx, `
		UPDATE sealed_sender_keys
		SET status = 'rotated', rotated_at = NOW()
		WHERE user_id = $1 AND status = 'active'
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to rotate existing sealed sender keys: %w", err)
	}

	// Get the next version number
	var version int
	err = s.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(key_version), 0) + 1 FROM sealed_sender_keys WHERE user_id = $1
	`, userID).Scan(&version)
	if err != nil {
		return nil, fmt.Errorf("failed to get next version: %w", err)
	}

	// Default expiration: 30 days
	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	key := &SealedSenderKey{
		ID:             uuid.New(),
		UserID:         userID,
		KyberPublicKey: publicKey,
		KeyFingerprint: fingerprint,
		KeyVersion:     version,
		Status:         "active",
		CreatedAt:      time.Now(),
		ExpiresAt:      &expiresAt,
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO sealed_sender_keys (id, user_id, kyber_public_key, key_fingerprint, key_version, status, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, key.ID, key.UserID, key.KyberPublicKey, key.KeyFingerprint, key.KeyVersion, key.Status, key.CreatedAt, key.ExpiresAt)

	if err != nil {
		return nil, fmt.Errorf("failed to store sealed sender key: %w", err)
	}

	// Log the key creation/rotation
	s.logKeyRotation(ctx, userID, "sealed_sender", "", fingerprint, "initial")

	return key, nil
}

// GetSealedSenderKey retrieves a user's active sealed sender public key
func (s *Service) GetSealedSenderKey(ctx context.Context, userID uuid.UUID) (*SealedSenderKey, error) {
	key := &SealedSenderKey{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, kyber_public_key, key_fingerprint, key_version, status, created_at, expires_at
		FROM sealed_sender_keys
		WHERE user_id = $1 AND status = 'active'
		AND (expires_at IS NULL OR expires_at > NOW())
	`, userID).Scan(&key.ID, &key.UserID, &key.KyberPublicKey, &key.KeyFingerprint, &key.KeyVersion, &key.Status, &key.CreatedAt, &key.ExpiresAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get sealed sender key: %w", err)
	}

	return key, nil
}

// RotateSealedSenderKey rotates a user's sealed sender key
func (s *Service) RotateSealedSenderKey(ctx context.Context, userID uuid.UUID, newPublicKey []byte, reason string) (*SealedSenderKey, error) {
	// Get current key for logging
	currentKey, _ := s.GetSealedSenderKey(ctx, userID)
	oldFingerprint := ""
	if currentKey != nil {
		oldFingerprint = currentKey.KeyFingerprint
	}

	// Store new key (this marks old one as rotated)
	newKey, err := s.StoreSealedSenderKey(ctx, userID, newPublicKey)
	if err != nil {
		return nil, err
	}

	// Log the rotation with reason
	s.logKeyRotation(ctx, userID, "sealed_sender", oldFingerprint, newKey.KeyFingerprint, reason)

	return newKey, nil
}

// GetDeliveryVerifier retrieves a user's delivery verifier for sealed sender tokens
func (s *Service) GetDeliveryVerifier(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	var verifier []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT delivery_verifier FROM users WHERE id = $1
	`, userID).Scan(&verifier)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get delivery verifier: %w", err)
	}

	return verifier, nil
}

// SetDeliveryVerifier sets or updates a user's delivery verifier
func (s *Service) SetDeliveryVerifier(ctx context.Context, userID uuid.UUID, verifier []byte) error {
	if len(verifier) != 32 {
		return fmt.Errorf("delivery verifier must be 32 bytes, got %d", len(verifier))
	}

	_, err := s.db.ExecContext(ctx, `
		UPDATE users SET delivery_verifier = $2 WHERE id = $1
	`, userID, verifier)

	if err != nil {
		return fmt.Errorf("failed to set delivery verifier: %w", err)
	}

	return nil
}

// RegenerateDeliveryVerifier generates a new random delivery verifier
func (s *Service) RegenerateDeliveryVerifier(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	verifier := GenerateRandomBytes(32)
	err := s.SetDeliveryVerifier(ctx, userID, verifier)
	if err != nil {
		return nil, err
	}
	return verifier, nil
}

// IsSealedSenderEnabled checks if a user has sealed sender enabled
func (s *Service) IsSealedSenderEnabled(ctx context.Context, userID uuid.UUID) (bool, error) {
	var enabled bool
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(sealed_sender_enabled, true) FROM users WHERE id = $1
	`, userID).Scan(&enabled)

	if err == sql.ErrNoRows {
		return true, nil // Default to enabled
	}
	if err != nil {
		return false, fmt.Errorf("failed to check sealed sender status: %w", err)
	}

	return enabled, nil
}

// SetSealedSenderEnabled enables or disables sealed sender for a user
func (s *Service) SetSealedSenderEnabled(ctx context.Context, userID uuid.UUID, enabled bool) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE users SET sealed_sender_enabled = $2 WHERE id = $1
	`, userID, enabled)

	if err != nil {
		return fmt.Errorf("failed to set sealed sender enabled: %w", err)
	}

	return nil
}

// GetPreKeyBundleWithSealedSender retrieves a complete prekey bundle including sealed sender key
func (s *Service) GetPreKeyBundleWithSealedSender(ctx context.Context, targetUserID, requestingUserID uuid.UUID) (*SealedSenderBundle, error) {
	// Get the base prekey bundle
	baseBundle, err := s.GetPreKeyBundle(ctx, targetUserID, requestingUserID)
	if err != nil {
		return nil, err
	}

	bundle := &SealedSenderBundle{
		PreKeyBundle: baseBundle,
	}

	// Get sealed sender key
	sealedKey, err := s.GetSealedSenderKey(ctx, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get sealed sender key: %w", err)
	}
	bundle.SealedSenderKey = sealedKey

	// Get or regenerate delivery verifier
	verifier, err := s.GetDeliveryVerifier(ctx, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get delivery verifier: %w", err)
	}
	if verifier == nil {
		// Generate new verifier if none exists
		verifier, err = s.RegenerateDeliveryVerifier(ctx, targetUserID)
		if err != nil {
			return nil, fmt.Errorf("failed to generate delivery verifier: %w", err)
		}
	}
	bundle.DeliveryVerifier = verifier

	return bundle, nil
}

// GetHybridPreKeyBundleWithSealedSender retrieves a complete hybrid prekey bundle including sealed sender key
func (s *Service) GetHybridPreKeyBundleWithSealedSender(ctx context.Context, targetUserID, requestingUserID uuid.UUID) (*HybridSealedSenderBundle, error) {
	// Get the base hybrid prekey bundle
	baseBundle, err := s.GetHybridPreKeyBundle(ctx, targetUserID, requestingUserID)
	if err != nil {
		return nil, err
	}

	bundle := &HybridSealedSenderBundle{
		HybridPreKeyBundle: baseBundle,
	}

	// Get sealed sender key
	sealedKey, err := s.GetSealedSenderKey(ctx, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get sealed sender key: %w", err)
	}
	bundle.SealedSenderKey = sealedKey

	// Get or regenerate delivery verifier
	verifier, err := s.GetDeliveryVerifier(ctx, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get delivery verifier: %w", err)
	}
	if verifier == nil {
		verifier, err = s.RegenerateDeliveryVerifier(ctx, targetUserID)
		if err != nil {
			return nil, fmt.Errorf("failed to generate delivery verifier: %w", err)
		}
	}
	bundle.DeliveryVerifier = verifier

	return bundle, nil
}

// HasSealedSenderKey checks if a user has an active sealed sender key
func (s *Service) HasSealedSenderKey(ctx context.Context, userID uuid.UUID) (bool, error) {
	sealedKey, err := s.GetSealedSenderKey(ctx, userID)
	if err != nil {
		return false, err
	}
	return sealedKey != nil, nil
}

// GetSealedSenderStatus returns a summary of a user's sealed sender readiness
type SealedSenderStatus struct {
	Enabled          bool   `json:"enabled"`
	HasSealedKey     bool   `json:"has_sealed_key"`
	HasDeliveryToken bool   `json:"has_delivery_token"`
	KeyFingerprint   string `json:"key_fingerprint,omitempty"`
	KeyVersion       int    `json:"key_version,omitempty"`
}

func (s *Service) GetSealedSenderStatus(ctx context.Context, userID uuid.UUID) (*SealedSenderStatus, error) {
	status := &SealedSenderStatus{}

	// Check if enabled
	enabled, err := s.IsSealedSenderEnabled(ctx, userID)
	if err != nil {
		return nil, err
	}
	status.Enabled = enabled

	// Check sealed sender key
	sealedKey, err := s.GetSealedSenderKey(ctx, userID)
	if err != nil {
		return nil, err
	}
	status.HasSealedKey = sealedKey != nil
	if sealedKey != nil {
		status.KeyFingerprint = sealedKey.KeyFingerprint
		status.KeyVersion = sealedKey.KeyVersion
	}

	// Check delivery verifier
	verifier, err := s.GetDeliveryVerifier(ctx, userID)
	if err != nil {
		return nil, err
	}
	status.HasDeliveryToken = verifier != nil

	return status, nil
}
