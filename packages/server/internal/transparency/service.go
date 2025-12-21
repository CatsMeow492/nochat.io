package transparency

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Service provides key transparency operations using a Sparse Merkle Tree
type Service struct {
	db     *sql.DB
	redis  *redis.Client
	signer *Signer

	// Batch processing
	batchMu        sync.Mutex
	pendingUpdates []KeyUpdate
	batchTicker    *time.Ticker
	stopBatch      chan struct{}

	// Current state cache
	currentEpoch int64
	currentRoot  []byte
	stateMu      sync.RWMutex
}

// NewService creates a new transparency service
func NewService(db *sql.DB, redisClient *redis.Client) (*Service, error) {
	s := &Service{
		db:        db,
		redis:     redisClient,
		stopBatch: make(chan struct{}),
	}

	// Try to load signer from environment
	signer, err := NewSignerFromEnv()
	if err != nil {
		log.Printf("[Transparency] Warning: No signing key configured: %v", err)
		log.Printf("[Transparency] Key transparency will operate in read-only mode")
	} else {
		s.signer = signer
		log.Printf("[Transparency] Loaded signing key: %s (%s)", signer.Fingerprint(), signer.Algorithm())

		// Ensure signing key is registered in database
		if err := s.registerSigningKey(context.Background()); err != nil {
			log.Printf("[Transparency] Warning: Failed to register signing key: %v", err)
		}
	}

	// Load current state
	if err := s.loadCurrentState(context.Background()); err != nil {
		log.Printf("[Transparency] Warning: Failed to load current state: %v", err)
	}

	// Start batch processor if we have a signer
	if s.signer != nil {
		go s.batchProcessor()
	}

	return s, nil
}

// Close stops the service and cleans up resources
func (s *Service) Close() {
	if s.stopBatch != nil {
		close(s.stopBatch)
	}
	if s.batchTicker != nil {
		s.batchTicker.Stop()
	}
}

// QueueKeyUpdate adds a key change to the pending batch
func (s *Service) QueueKeyUpdate(update KeyUpdate) {
	if s.signer == nil {
		log.Printf("[Transparency] Ignoring key update (no signing key configured)")
		return
	}

	s.batchMu.Lock()
	defer s.batchMu.Unlock()
	s.pendingUpdates = append(s.pendingUpdates, update)
	log.Printf("[Transparency] Queued %s for user %s", update.UpdateType, update.UserID)
}

// GetSignedTreeHead returns the current signed tree head
func (s *Service) GetSignedTreeHead(ctx context.Context) (*SignedTreeHead, error) {
	sth := &SignedTreeHead{}
	err := s.db.QueryRowContext(ctx, `
		SELECT epoch_number, root_hash, tree_size, signature, signing_key_fingerprint, created_at
		FROM transparency_epochs
		WHERE epoch_number > 0
		ORDER BY epoch_number DESC
		LIMIT 1
	`).Scan(&sth.EpochNumber, &sth.RootHash, &sth.TreeSize, &sth.Signature,
		&sth.SigningKeyFingerprint, &sth.Timestamp)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get STH: %w", err)
	}

	return sth, nil
}

// GetSignedTreeHeadAtEpoch returns the signed tree head for a specific epoch
func (s *Service) GetSignedTreeHeadAtEpoch(ctx context.Context, epoch int64) (*SignedTreeHead, error) {
	sth := &SignedTreeHead{}
	err := s.db.QueryRowContext(ctx, `
		SELECT epoch_number, root_hash, tree_size, signature, signing_key_fingerprint, created_at
		FROM transparency_epochs
		WHERE epoch_number = $1
	`, epoch).Scan(&sth.EpochNumber, &sth.RootHash, &sth.TreeSize, &sth.Signature,
		&sth.SigningKeyFingerprint, &sth.Timestamp)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("epoch not found: %d", epoch)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get STH: %w", err)
	}

	return sth, nil
}

// GetInclusionProof generates an inclusion proof for a user's key at a specific epoch
func (s *Service) GetInclusionProof(ctx context.Context, userID uuid.UUID, epochNum int64) (*InclusionProof, error) {
	// If epoch is 0 or not specified, use current epoch
	if epochNum == 0 {
		s.stateMu.RLock()
		epochNum = s.currentEpoch
		s.stateMu.RUnlock()
	}

	// Get the leaf data for this user
	var entry KeyDirectoryEntry
	var leafDataJSON []byte

	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, user_id_hash, identity_key_fingerprint,
		       signed_prekey_fingerprint, key_version, last_epoch, leaf_hash
		FROM key_directory_entries
		WHERE user_id = $1 AND last_epoch <= $2
	`, userID, epochNum).Scan(
		&entry.ID, &entry.UserID, &entry.UserIDHash,
		&entry.IdentityKeyFingerprint, &entry.SignedPreKeyFingerprint,
		&entry.KeyVersion, &entry.LastEpoch, &entry.LeafHash,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user not found in transparency log")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get directory entry: %w", err)
	}

	// Build the leaf data
	leafData := &LeafData{
		UserID:                  entry.UserID,
		IdentityKeyFingerprint:  entry.IdentityKeyFingerprint,
		SignedPreKeyFingerprint: entry.SignedPreKeyFingerprint,
		KeyVersion:              entry.KeyVersion,
		Timestamp:               entry.UpdatedAt.Unix(),
	}

	// Get the timestamp from a separate query if needed
	var updatedAt time.Time
	s.db.QueryRowContext(ctx, `
		SELECT updated_at FROM key_directory_entries WHERE id = $1
	`, entry.ID).Scan(&updatedAt)
	leafData.Timestamp = updatedAt.Unix()

	// Build sibling path by traversing tree from leaf to root
	siblingPath := make([][]byte, TreeDepth)
	pathBits := entry.UserIDHash

	for depth := TreeDepth - 1; depth >= 0; depth-- {
		// Get the sibling at this depth
		siblingPrefix := GetSiblingPrefix(pathBits, depth+1)

		var siblingHash []byte
		err := s.db.QueryRowContext(ctx, `
			SELECT node_hash FROM merkle_nodes
			WHERE epoch = $1 AND depth = $2 AND path_prefix = $3
		`, epochNum, depth+1, siblingPrefix).Scan(&siblingHash)

		if err == sql.ErrNoRows {
			// Use default hash for empty sibling
			siblingHash = GetDefaultHash(depth + 1)
		} else if err != nil {
			return nil, fmt.Errorf("failed to get sibling at depth %d: %w", depth, err)
		}

		siblingPath[depth] = siblingHash
	}

	// Get root hash for this epoch
	var rootHash []byte
	err = s.db.QueryRowContext(ctx, `
		SELECT root_hash FROM transparency_epochs WHERE epoch_number = $1
	`, epochNum).Scan(&rootHash)
	if err != nil {
		return nil, fmt.Errorf("failed to get root hash: %w", err)
	}

	// Marshal leaf data for JSON transport
	leafDataJSON, _ = json.Marshal(leafData)
	_ = leafDataJSON // Used for verification

	return &InclusionProof{
		EpochNumber: epochNum,
		LeafHash:    entry.LeafHash,
		LeafData:    leafData,
		SiblingPath: siblingPath,
		PathBits:    pathBits,
		RootHash:    rootHash,
	}, nil
}

// GetConsistencyProof proves tree consistency between two epochs
func (s *Service) GetConsistencyProof(ctx context.Context, fromEpoch, toEpoch int64) (*ConsistencyProof, error) {
	if fromEpoch >= toEpoch {
		return nil, fmt.Errorf("from_epoch must be less than to_epoch")
	}

	// Get root hashes for both epochs
	var fromRoot, toRoot []byte

	err := s.db.QueryRowContext(ctx, `
		SELECT root_hash FROM transparency_epochs WHERE epoch_number = $1
	`, fromEpoch).Scan(&fromRoot)
	if err != nil {
		return nil, fmt.Errorf("failed to get from-epoch root: %w", err)
	}

	err = s.db.QueryRowContext(ctx, `
		SELECT root_hash FROM transparency_epochs WHERE epoch_number = $1
	`, toEpoch).Scan(&toRoot)
	if err != nil {
		return nil, fmt.Errorf("failed to get to-epoch root: %w", err)
	}

	// For an SMT, consistency proof shows that entries in the old tree
	// exist unchanged in the new tree (or have valid updates)
	// We include the intermediate root hashes between epochs
	rows, err := s.db.QueryContext(ctx, `
		SELECT root_hash FROM transparency_epochs
		WHERE epoch_number > $1 AND epoch_number <= $2
		ORDER BY epoch_number ASC
	`, fromEpoch, toEpoch)
	if err != nil {
		return nil, fmt.Errorf("failed to get intermediate roots: %w", err)
	}
	defer rows.Close()

	var proofHashes [][]byte
	for rows.Next() {
		var hash []byte
		if err := rows.Scan(&hash); err != nil {
			return nil, fmt.Errorf("failed to scan root hash: %w", err)
		}
		proofHashes = append(proofHashes, hash)
	}

	return &ConsistencyProof{
		FromEpoch:   fromEpoch,
		ToEpoch:     toEpoch,
		FromRoot:    fromRoot,
		ToRoot:      toRoot,
		ProofHashes: proofHashes,
	}, nil
}

// GetAuditLog returns audit log entries starting from a given epoch
func (s *Service) GetAuditLog(ctx context.Context, fromEpoch int64, limit int) ([]AuditLogEntry, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, epoch_number, change_type, user_id_commitment, old_leaf_hash, new_leaf_hash, created_at
		FROM transparency_audit_log
		WHERE epoch_number >= $1
		ORDER BY epoch_number ASC, created_at ASC
		LIMIT $2
	`, fromEpoch, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to get audit log: %w", err)
	}
	defer rows.Close()

	var entries []AuditLogEntry
	for rows.Next() {
		var entry AuditLogEntry
		var oldLeafHash, newLeafHash sql.NullString

		err := rows.Scan(&entry.ID, &entry.EpochNumber, &entry.ChangeType,
			&entry.UserIDCommitment, &oldLeafHash, &newLeafHash, &entry.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan audit log entry: %w", err)
		}

		if oldLeafHash.Valid {
			entry.OldLeafHash, _ = hex.DecodeString(oldLeafHash.String)
		}
		if newLeafHash.Valid {
			entry.NewLeafHash, _ = hex.DecodeString(newLeafHash.String)
		}

		entries = append(entries, entry)
	}

	return entries, nil
}

// GetSigningKeys returns all active signing keys
func (s *Service) GetSigningKeys(ctx context.Context) ([]SigningKey, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, key_fingerprint, public_key, algorithm, status, valid_from, valid_until, created_at
		FROM transparency_signing_keys
		WHERE status = 'active'
		ORDER BY valid_from DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to get signing keys: %w", err)
	}
	defer rows.Close()

	var keys []SigningKey
	for rows.Next() {
		var key SigningKey
		var validUntil sql.NullTime

		err := rows.Scan(&key.ID, &key.Fingerprint, &key.PublicKey, &key.Algorithm,
			&key.Status, &key.ValidFrom, &validUntil, &key.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan signing key: %w", err)
		}

		if validUntil.Valid {
			key.ValidUntil = &validUntil.Time
		}

		keys = append(keys, key)
	}

	return keys, nil
}

// UpdateClientState updates a client's verified epoch state
func (s *Service) UpdateClientState(ctx context.Context, userID uuid.UUID, deviceID string, epoch int64, rootHash []byte) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO client_transparency_state (id, user_id, device_id, last_verified_epoch, last_verified_root_hash, verified_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (user_id, device_id) DO UPDATE SET
			last_verified_epoch = EXCLUDED.last_verified_epoch,
			last_verified_root_hash = EXCLUDED.last_verified_root_hash,
			verified_at = NOW()
	`, uuid.New(), userID, deviceID, epoch, rootHash)

	if err != nil {
		return fmt.Errorf("failed to update client state: %w", err)
	}

	return nil
}

// GetClientState retrieves a client's verified epoch state
func (s *Service) GetClientState(ctx context.Context, userID uuid.UUID, deviceID string) (*ClientState, error) {
	state := &ClientState{}
	err := s.db.QueryRowContext(ctx, `
		SELECT user_id, device_id, last_verified_epoch, last_verified_root_hash, verified_at
		FROM client_transparency_state
		WHERE user_id = $1 AND device_id = $2
	`, userID, deviceID).Scan(&state.UserID, &state.DeviceID, &state.LastVerifiedEpoch,
		&state.LastVerifiedRootHash, &state.VerifiedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get client state: %w", err)
	}

	return state, nil
}

// batchProcessor runs in the background and processes pending updates periodically
func (s *Service) batchProcessor() {
	s.batchTicker = time.NewTicker(DefaultBatchInterval)
	defer s.batchTicker.Stop()

	for {
		select {
		case <-s.batchTicker.C:
			s.processBatch()
		case <-s.stopBatch:
			return
		}
	}
}

// processBatch processes all pending updates and creates a new epoch
func (s *Service) processBatch() {
	s.batchMu.Lock()
	updates := s.pendingUpdates
	s.pendingUpdates = nil
	s.batchMu.Unlock()

	if len(updates) == 0 {
		return
	}

	ctx := context.Background()

	// Start transaction
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		log.Printf("[Transparency] Failed to start batch transaction: %v", err)
		return
	}
	defer tx.Rollback()

	// Get current epoch
	var currentEpoch int64
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(epoch_number), 0) FROM transparency_epochs`).Scan(&currentEpoch)
	if err != nil {
		log.Printf("[Transparency] Failed to get current epoch: %v", err)
		return
	}

	newEpoch := currentEpoch + 1
	now := time.Now()
	treeSize := int64(0)

	// Generate epoch salt for pseudonymous commitments
	epochSalt := make([]byte, 32)
	copy(epochSalt, fmt.Sprintf("epoch-%d-%d", newEpoch, now.Unix()))

	// Apply all updates
	for _, update := range updates {
		if err := s.applyUpdate(ctx, tx, update, newEpoch, now, epochSalt); err != nil {
			log.Printf("[Transparency] Failed to apply update for user %s: %v", update.UserID, err)
			continue
		}
		treeSize++
	}

	// Compute new root hash
	rootHash, err := s.computeRoot(ctx, tx, newEpoch)
	if err != nil {
		log.Printf("[Transparency] Failed to compute root: %v", err)
		return
	}

	// Count total entries
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM key_directory_entries`).Scan(&treeSize)
	if err != nil {
		log.Printf("[Transparency] Failed to count entries: %v", err)
		return
	}

	// Sign the new tree head
	sth, err := s.signer.CreateSignedTreeHead(newEpoch, rootHash, treeSize)
	if err != nil {
		log.Printf("[Transparency] Failed to sign tree head: %v", err)
		return
	}

	// Store the signed epoch
	_, err = tx.ExecContext(ctx, `
		INSERT INTO transparency_epochs (id, epoch_number, root_hash, tree_size, signature, signing_key_fingerprint)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, uuid.New(), sth.EpochNumber, sth.RootHash, sth.TreeSize, sth.Signature, sth.SigningKeyFingerprint)
	if err != nil {
		log.Printf("[Transparency] Failed to store epoch: %v", err)
		return
	}

	// Mark pending updates as processed
	for _, update := range updates {
		tx.ExecContext(ctx, `
			UPDATE transparency_pending_updates
			SET processed = true, processed_at = NOW(), processed_epoch = $1
			WHERE user_id = $2 AND processed = false
		`, newEpoch, update.UserID)
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		log.Printf("[Transparency] Failed to commit batch: %v", err)
		return
	}

	// Update local state
	s.stateMu.Lock()
	s.currentEpoch = newEpoch
	s.currentRoot = rootHash
	s.stateMu.Unlock()

	log.Printf("[Transparency] Created epoch %d with %d updates, root: %s",
		newEpoch, len(updates), hex.EncodeToString(rootHash[:8]))
}

// applyUpdate applies a single key update to the tree
func (s *Service) applyUpdate(ctx context.Context, tx *sql.Tx, update KeyUpdate, epoch int64, timestamp time.Time, epochSalt []byte) error {
	userIDHash := ComputeUserPath(update.UserID)

	leafData := &LeafData{
		UserID:                  update.UserID,
		IdentityKeyFingerprint:  update.IdentityKeyFingerprint,
		SignedPreKeyFingerprint: update.SignedPreKeyFingerprint,
		KeyVersion:              update.KeyVersion,
		Timestamp:               timestamp.Unix(),
	}

	leafHash := HashLeaf(leafData)
	leafDataJSON, _ := json.Marshal(leafData)

	// Get old leaf hash for audit log
	var oldLeafHash []byte
	tx.QueryRowContext(ctx, `
		SELECT leaf_hash FROM key_directory_entries WHERE user_id = $1
	`, update.UserID).Scan(&oldLeafHash)

	// Upsert key directory entry
	_, err := tx.ExecContext(ctx, `
		INSERT INTO key_directory_entries (
			id, user_id, user_id_hash, identity_key_fingerprint,
			signed_prekey_fingerprint, key_version, last_epoch, leaf_hash
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (user_id) DO UPDATE SET
			identity_key_fingerprint = EXCLUDED.identity_key_fingerprint,
			signed_prekey_fingerprint = EXCLUDED.signed_prekey_fingerprint,
			key_version = EXCLUDED.key_version,
			last_epoch = EXCLUDED.last_epoch,
			leaf_hash = EXCLUDED.leaf_hash,
			updated_at = NOW()
	`, uuid.New(), update.UserID, userIDHash, update.IdentityKeyFingerprint,
		update.SignedPreKeyFingerprint, update.KeyVersion, epoch, leafHash)
	if err != nil {
		return fmt.Errorf("failed to update directory entry: %w", err)
	}

	// Store leaf node
	pathPrefix := hex.EncodeToString(userIDHash)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO merkle_nodes (id, epoch, depth, path_prefix, node_hash, leaf_data, is_leaf)
		VALUES ($1, $2, $3, $4, $5, $6, true)
		ON CONFLICT (epoch, depth, path_prefix) DO UPDATE SET
			node_hash = EXCLUDED.node_hash,
			leaf_data = EXCLUDED.leaf_data
	`, uuid.New(), epoch, TreeDepth, pathPrefix, leafHash, leafDataJSON)
	if err != nil {
		return fmt.Errorf("failed to store leaf node: %w", err)
	}

	// Update intermediate nodes up to root
	currentHash := leafHash
	for depth := TreeDepth - 1; depth >= 0; depth-- {
		_ = PathPrefixAtDepth(userIDHash, depth+1) // Current node prefix (used for debugging)
		siblingPrefix := GetSiblingPrefix(userIDHash, depth+1)

		// Get sibling hash (or default if not exists)
		var siblingHash []byte
		err := tx.QueryRowContext(ctx, `
			SELECT node_hash FROM merkle_nodes
			WHERE epoch = $1 AND depth = $2 AND path_prefix = $3
		`, epoch, depth+1, siblingPrefix).Scan(&siblingHash)
		if err == sql.ErrNoRows {
			siblingHash = GetDefaultHash(depth + 1)
		} else if err != nil {
			return fmt.Errorf("failed to get sibling: %w", err)
		}

		// Compute parent hash
		bit := GetBit(userIDHash, depth)
		var parentHash []byte
		if bit == 0 {
			parentHash = HashInternal(currentHash, siblingHash)
		} else {
			parentHash = HashInternal(siblingHash, currentHash)
		}

		// Store parent node
		parentPrefix := PathPrefixAtDepth(userIDHash, depth)
		_, err = tx.ExecContext(ctx, `
			INSERT INTO merkle_nodes (id, epoch, depth, path_prefix, node_hash, is_leaf)
			VALUES ($1, $2, $3, $4, $5, false)
			ON CONFLICT (epoch, depth, path_prefix) DO UPDATE SET
				node_hash = EXCLUDED.node_hash
		`, uuid.New(), epoch, depth, parentPrefix, parentHash)
		if err != nil {
			return fmt.Errorf("failed to store internal node: %w", err)
		}

		currentHash = parentHash
	}

	// Add audit log entry
	commitment := ComputeUserIDCommitment(update.UserID, epochSalt)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO transparency_audit_log (id, epoch_number, change_type, user_id_commitment, old_leaf_hash, new_leaf_hash)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, uuid.New(), epoch, update.UpdateType, commitment, oldLeafHash, leafHash)
	if err != nil {
		return fmt.Errorf("failed to add audit log entry: %w", err)
	}

	// Queue pending update record
	_, err = tx.ExecContext(ctx, `
		INSERT INTO transparency_pending_updates (
			id, user_id, update_type, identity_key_fingerprint,
			signed_prekey_fingerprint, key_version
		) VALUES ($1, $2, $3, $4, $5, $6)
	`, uuid.New(), update.UserID, update.UpdateType, update.IdentityKeyFingerprint,
		update.SignedPreKeyFingerprint, update.KeyVersion)
	if err != nil {
		// Non-fatal, just log
		log.Printf("[Transparency] Warning: Failed to queue pending update: %v", err)
	}

	return nil
}

// computeRoot computes the root hash for an epoch
func (s *Service) computeRoot(ctx context.Context, tx *sql.Tx, epoch int64) ([]byte, error) {
	var rootHash []byte
	err := tx.QueryRowContext(ctx, `
		SELECT node_hash FROM merkle_nodes
		WHERE epoch = $1 AND depth = 0 AND path_prefix = ''
	`, epoch).Scan(&rootHash)

	if err == sql.ErrNoRows {
		// Empty tree
		return GetDefaultHash(0), nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get root hash: %w", err)
	}

	return rootHash, nil
}

// loadCurrentState loads the current epoch and root from the database
func (s *Service) loadCurrentState(ctx context.Context) error {
	var epoch int64
	var rootHash []byte

	err := s.db.QueryRowContext(ctx, `
		SELECT epoch_number, root_hash FROM transparency_epochs
		ORDER BY epoch_number DESC
		LIMIT 1
	`).Scan(&epoch, &rootHash)

	if err == sql.ErrNoRows {
		s.currentEpoch = 0
		s.currentRoot = GetDefaultHash(0)
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to load current state: %w", err)
	}

	s.stateMu.Lock()
	s.currentEpoch = epoch
	s.currentRoot = rootHash
	s.stateMu.Unlock()

	log.Printf("[Transparency] Loaded epoch %d, root: %s", epoch, hex.EncodeToString(rootHash[:8]))
	return nil
}

// registerSigningKey ensures the current signing key is in the database
func (s *Service) registerSigningKey(ctx context.Context) error {
	if s.signer == nil {
		return nil
	}

	signingKey, err := s.signer.ToSigningKey()
	if err != nil {
		return err
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO transparency_signing_keys (id, key_fingerprint, public_key, algorithm, status, valid_from)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (key_fingerprint) DO UPDATE SET
			status = 'active',
			valid_from = EXCLUDED.valid_from
	`, uuid.New(), signingKey.Fingerprint, signingKey.PublicKey, signingKey.Algorithm,
		signingKey.Status, signingKey.ValidFrom)

	return err
}

// CurrentEpoch returns the current epoch number
func (s *Service) CurrentEpoch() int64 {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	return s.currentEpoch
}

// CurrentRoot returns the current root hash
func (s *Service) CurrentRoot() []byte {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	result := make([]byte, len(s.currentRoot))
	copy(result, s.currentRoot)
	return result
}

// HasSigner returns true if the service has a signing key configured
func (s *Service) HasSigner() bool {
	return s.signer != nil
}

// CryptoKeyUpdate is a type alias for compatibility with crypto package
type CryptoKeyUpdate struct {
	UserID                  uuid.UUID
	IdentityKeyFingerprint  string
	SignedPreKeyFingerprint string
	KeyVersion              int
	UpdateType              string
}

// QueueCryptoKeyUpdate accepts updates from the crypto package
func (s *Service) QueueCryptoKeyUpdate(update CryptoKeyUpdate) {
	s.QueueKeyUpdate(KeyUpdate{
		UserID:                  update.UserID,
		IdentityKeyFingerprint:  update.IdentityKeyFingerprint,
		SignedPreKeyFingerprint: update.SignedPreKeyFingerprint,
		KeyVersion:              update.KeyVersion,
		UpdateType:              update.UpdateType,
	})
}

// TransparencyAdapter wraps the Service to implement the crypto.TransparencyQueuer interface
type TransparencyAdapter struct {
	service *Service
}

// NewTransparencyAdapter creates a new adapter for the crypto package
func NewTransparencyAdapter(s *Service) *TransparencyAdapter {
	return &TransparencyAdapter{service: s}
}

// CryptoTransparencyKeyUpdate mirrors crypto.TransparencyKeyUpdate
// This allows the adapter to work without importing the crypto package
type CryptoTransparencyKeyUpdate struct {
	UserID                  uuid.UUID
	IdentityKeyFingerprint  string
	SignedPreKeyFingerprint string
	KeyVersion              int
	UpdateType              string
}

// QueueKeyUpdate implements the crypto.TransparencyQueuer interface
func (a *TransparencyAdapter) QueueKeyUpdate(update interface{}) {
	// Use type assertion to handle the update
	switch u := update.(type) {
	case CryptoTransparencyKeyUpdate:
		a.service.QueueKeyUpdate(KeyUpdate{
			UserID:                  u.UserID,
			IdentityKeyFingerprint:  u.IdentityKeyFingerprint,
			SignedPreKeyFingerprint: u.SignedPreKeyFingerprint,
			KeyVersion:              u.KeyVersion,
			UpdateType:              u.UpdateType,
		})
	default:
		// Try reflection-based approach for any struct with matching fields
		log.Printf("[Transparency] Unknown update type: %T", update)
	}
}
