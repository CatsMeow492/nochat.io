package crypto

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Service provides cryptographic key management operations
type Service struct {
	db *sql.DB
}

// NewService creates a new crypto service
func NewService(db *sql.DB) *Service {
	return &Service{db: db}
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

// StoreIdentityKey stores a new identity key for a user
func (s *Service) StoreIdentityKey(ctx context.Context, userID uuid.UUID, publicKey []byte) (*IdentityKey, error) {
	if len(publicKey) != Dilithium3PublicKeySize {
		return nil, fmt.Errorf("invalid Dilithium public key size")
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
func (s *Service) StoreSignedPreKey(ctx context.Context, userID uuid.UUID, keyID int, kyberPublicKey, signature []byte) (*SignedPreKey, error) {
	if len(kyberPublicKey) != Kyber1024PublicKeySize {
		return nil, fmt.Errorf("invalid Kyber public key size")
	}
	if len(signature) != Dilithium3SignatureSize {
		return nil, fmt.Errorf("invalid signature size")
	}

	fingerprint := KeyFingerprint(kyberPublicKey)
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
		KyberPublicKey: kyberPublicKey,
		Signature:      signature,
		KeyFingerprint: fingerprint,
		Status:         "active",
		CreatedAt:      time.Now(),
		ExpiresAt:      &expiresAt,
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO signed_prekeys (id, user_id, key_id, kyber_public_key, signature, key_fingerprint, status, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, prekey.ID, prekey.UserID, prekey.KeyID, prekey.KyberPublicKey, prekey.Signature, prekey.KeyFingerprint, prekey.Status, prekey.CreatedAt, prekey.ExpiresAt)

	if err != nil {
		return nil, fmt.Errorf("failed to store signed prekey: %w", err)
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
		if len(prekey.KyberPublicKey) != Kyber1024PublicKeySize {
			return fmt.Errorf("invalid Kyber public key size for key %d", prekey.KeyID)
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
