package contacts

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gitlab.com/secp/services/backend/internal/models"
)

var (
	ErrContactNotFound     = errors.New("contact not found")
	ErrContactExists       = errors.New("contact already exists")
	ErrInviteNotFound      = errors.New("invite not found")
	ErrInviteExpired       = errors.New("invite has expired")
	ErrInviteMaxUses       = errors.New("invite has reached max uses")
	ErrCannotAddSelf       = errors.New("cannot add yourself as a contact")
	ErrUnauthorized        = errors.New("unauthorized")
)

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

// ============================================================================
// Contact Operations
// ============================================================================

// GetContacts retrieves contacts for a user, optionally filtered by status
func (s *Service) GetContacts(ctx context.Context, userID uuid.UUID, status string) ([]models.ContactWithUser, error) {
	query := `
		SELECT c.id, c.user_id, c.contact_user_id, c.status, c.created_at, c.updated_at,
		       u.id, u.username, u.display_name, u.avatar_url
		FROM contacts c
		JOIN users u ON u.id = c.contact_user_id
		WHERE c.user_id = $1
	`
	args := []interface{}{userID}

	if status != "" {
		query += " AND c.status = $2"
		args = append(args, status)
	}

	query += " ORDER BY u.display_name ASC"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query contacts: %w", err)
	}
	defer rows.Close()

	var contacts []models.ContactWithUser
	for rows.Next() {
		var c models.ContactWithUser
		if err := rows.Scan(
			&c.ID, &c.UserID, &c.ContactUserID, &c.Status, &c.CreatedAt, &c.UpdatedAt,
			&c.ContactUser.ID, &c.ContactUser.Username, &c.ContactUser.DisplayName, &c.ContactUser.AvatarURL,
		); err != nil {
			return nil, fmt.Errorf("failed to scan contact: %w", err)
		}
		contacts = append(contacts, c)
	}

	return contacts, nil
}

// GetPendingRequests retrieves incoming contact requests for a user
func (s *Service) GetPendingRequests(ctx context.Context, userID uuid.UUID) ([]models.ContactWithUser, error) {
	query := `
		SELECT c.id, c.user_id, c.contact_user_id, c.status, c.created_at, c.updated_at,
		       u.id, u.username, u.display_name, u.avatar_url
		FROM contacts c
		JOIN users u ON u.id = c.user_id
		WHERE c.contact_user_id = $1 AND c.status = 'pending'
		ORDER BY c.created_at DESC
	`

	rows, err := s.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query pending requests: %w", err)
	}
	defer rows.Close()

	var contacts []models.ContactWithUser
	for rows.Next() {
		var c models.ContactWithUser
		if err := rows.Scan(
			&c.ID, &c.UserID, &c.ContactUserID, &c.Status, &c.CreatedAt, &c.UpdatedAt,
			&c.ContactUser.ID, &c.ContactUser.Username, &c.ContactUser.DisplayName, &c.ContactUser.AvatarURL,
		); err != nil {
			return nil, fmt.Errorf("failed to scan contact: %w", err)
		}
		contacts = append(contacts, c)
	}

	return contacts, nil
}

// SendRequest sends a contact request from one user to another
func (s *Service) SendRequest(ctx context.Context, fromUserID, toUserID uuid.UUID) (*models.Contact, error) {
	if fromUserID == toUserID {
		return nil, ErrCannotAddSelf
	}

	// Check if contact already exists (in either direction)
	var existingID uuid.UUID
	err := s.db.QueryRowContext(ctx, `
		SELECT id FROM contacts
		WHERE (user_id = $1 AND contact_user_id = $2)
		   OR (user_id = $2 AND contact_user_id = $1)
	`, fromUserID, toUserID).Scan(&existingID)

	if err == nil {
		return nil, ErrContactExists
	}
	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to check existing contact: %w", err)
	}

	// Check if target user requires approval
	settings, err := s.GetSettings(ctx, toUserID)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to get user settings: %w", err)
	}

	status := "pending"
	if settings != nil && !settings.RequireContactApproval {
		status = "accepted"
	}

	contact := &models.Contact{
		ID:            uuid.New(),
		UserID:        fromUserID,
		ContactUserID: toUserID,
		Status:        status,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO contacts (id, user_id, contact_user_id, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, contact.ID, contact.UserID, contact.ContactUserID, contact.Status, contact.CreatedAt, contact.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create contact: %w", err)
	}

	// If auto-accepted, create the reverse relationship
	if status == "accepted" {
		reverseContact := &models.Contact{
			ID:            uuid.New(),
			UserID:        toUserID,
			ContactUserID: fromUserID,
			Status:        "accepted",
			CreatedAt:     time.Now(),
			UpdatedAt:     time.Now(),
		}
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO contacts (id, user_id, contact_user_id, status, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, reverseContact.ID, reverseContact.UserID, reverseContact.ContactUserID, reverseContact.Status, reverseContact.CreatedAt, reverseContact.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to create reverse contact: %w", err)
		}
	}

	return contact, nil
}

// UpdateStatus updates the status of a contact (accept/block)
func (s *Service) UpdateStatus(ctx context.Context, contactID, userID uuid.UUID, newStatus string) error {
	// First verify the contact exists and the user is the recipient
	var contact models.Contact
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, contact_user_id, status FROM contacts WHERE id = $1
	`, contactID).Scan(&contact.ID, &contact.UserID, &contact.ContactUserID, &contact.Status)

	if err == sql.ErrNoRows {
		return ErrContactNotFound
	}
	if err != nil {
		return fmt.Errorf("failed to query contact: %w", err)
	}

	// User must be the recipient (contact_user_id) to accept/block
	if contact.ContactUserID != userID {
		return ErrUnauthorized
	}

	// Update the contact status
	_, err = s.db.ExecContext(ctx, `
		UPDATE contacts SET status = $1, updated_at = $2 WHERE id = $3
	`, newStatus, time.Now(), contactID)
	if err != nil {
		return fmt.Errorf("failed to update contact: %w", err)
	}

	// If accepting, create the reverse relationship
	if newStatus == "accepted" {
		reverseContact := &models.Contact{
			ID:            uuid.New(),
			UserID:        userID,
			ContactUserID: contact.UserID,
			Status:        "accepted",
			CreatedAt:     time.Now(),
			UpdatedAt:     time.Now(),
		}
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO contacts (id, user_id, contact_user_id, status, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT DO NOTHING
		`, reverseContact.ID, reverseContact.UserID, reverseContact.ContactUserID, reverseContact.Status, reverseContact.CreatedAt, reverseContact.UpdatedAt)
		if err != nil {
			return fmt.Errorf("failed to create reverse contact: %w", err)
		}
	}

	return nil
}

// Delete removes a contact relationship
func (s *Service) Delete(ctx context.Context, contactID, userID uuid.UUID) error {
	// Verify ownership and get contact details
	var contact models.Contact
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, contact_user_id FROM contacts WHERE id = $1
	`, contactID).Scan(&contact.ID, &contact.UserID, &contact.ContactUserID)

	if err == sql.ErrNoRows {
		return ErrContactNotFound
	}
	if err != nil {
		return fmt.Errorf("failed to query contact: %w", err)
	}

	// User must be either the requester or recipient
	if contact.UserID != userID && contact.ContactUserID != userID {
		return ErrUnauthorized
	}

	// Delete both directions of the relationship
	_, err = s.db.ExecContext(ctx, `
		DELETE FROM contacts
		WHERE (user_id = $1 AND contact_user_id = $2)
		   OR (user_id = $2 AND contact_user_id = $1)
	`, contact.UserID, contact.ContactUserID)

	if err != nil {
		return fmt.Errorf("failed to delete contact: %w", err)
	}

	return nil
}

// ============================================================================
// Invite Operations
// ============================================================================

// CreateInvite generates a new invite code for a user
func (s *Service) CreateInvite(ctx context.Context, userID uuid.UUID, maxUses *int, expiresIn *time.Duration) (*models.InviteCode, error) {
	// Generate random code
	codeBytes := make([]byte, 8)
	if _, err := rand.Read(codeBytes); err != nil {
		return nil, fmt.Errorf("failed to generate code: %w", err)
	}
	code := base64.URLEncoding.EncodeToString(codeBytes)[:12]

	var expiresAt *time.Time
	if expiresIn != nil {
		t := time.Now().Add(*expiresIn)
		expiresAt = &t
	}

	invite := &models.InviteCode{
		ID:        uuid.New(),
		UserID:    userID,
		Code:      code,
		MaxUses:   maxUses,
		UseCount:  0,
		ExpiresAt: expiresAt,
		IsActive:  true,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO invite_codes (id, user_id, code, max_uses, use_count, expires_at, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, invite.ID, invite.UserID, invite.Code, invite.MaxUses, invite.UseCount, invite.ExpiresAt, invite.IsActive, invite.CreatedAt, invite.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create invite: %w", err)
	}

	return invite, nil
}

// GetInviteInfo retrieves public information about an invite
func (s *Service) GetInviteInfo(ctx context.Context, code string) (*models.InviteInfo, error) {
	var invite models.InviteCode
	var user models.UserPublic

	err := s.db.QueryRowContext(ctx, `
		SELECT i.id, i.user_id, i.code, i.max_uses, i.use_count, i.expires_at, i.is_active, i.created_at, i.updated_at,
		       u.id, u.username, u.display_name, u.avatar_url
		FROM invite_codes i
		JOIN users u ON u.id = i.user_id
		WHERE i.code = $1
	`, code).Scan(
		&invite.ID, &invite.UserID, &invite.Code, &invite.MaxUses, &invite.UseCount, &invite.ExpiresAt, &invite.IsActive, &invite.CreatedAt, &invite.UpdatedAt,
		&user.ID, &user.Username, &user.DisplayName, &user.AvatarURL,
	)

	if err == sql.ErrNoRows {
		return nil, ErrInviteNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query invite: %w", err)
	}

	// Check validity
	isValid := invite.IsActive
	if invite.ExpiresAt != nil && time.Now().After(*invite.ExpiresAt) {
		isValid = false
	}
	if invite.MaxUses != nil && invite.UseCount >= *invite.MaxUses {
		isValid = false
	}

	var remainingUses *int
	if invite.MaxUses != nil {
		remaining := *invite.MaxUses - invite.UseCount
		remainingUses = &remaining
	}

	return &models.InviteInfo{
		Code:          invite.Code,
		User:          user,
		IsValid:       isValid,
		ExpiresAt:     invite.ExpiresAt,
		RemainingUses: remainingUses,
	}, nil
}

// AcceptInvite accepts an invite and creates a contact relationship
func (s *Service) AcceptInvite(ctx context.Context, code string, acceptingUserID uuid.UUID) (*models.Contact, error) {
	// Get invite info
	info, err := s.GetInviteInfo(ctx, code)
	if err != nil {
		return nil, err
	}

	if !info.IsValid {
		// Check specific reason
		var invite models.InviteCode
		s.db.QueryRowContext(ctx, `SELECT expires_at, max_uses, use_count FROM invite_codes WHERE code = $1`, code).Scan(&invite.ExpiresAt, &invite.MaxUses, &invite.UseCount)
		if invite.ExpiresAt != nil && time.Now().After(*invite.ExpiresAt) {
			return nil, ErrInviteExpired
		}
		if invite.MaxUses != nil && invite.UseCount >= *invite.MaxUses {
			return nil, ErrInviteMaxUses
		}
		return nil, ErrInviteNotFound
	}

	if info.User.ID == acceptingUserID {
		return nil, ErrCannotAddSelf
	}

	// Increment use count
	_, err = s.db.ExecContext(ctx, `
		UPDATE invite_codes SET use_count = use_count + 1, updated_at = $1 WHERE code = $2
	`, time.Now(), code)
	if err != nil {
		return nil, fmt.Errorf("failed to update invite count: %w", err)
	}

	// Create contact (bypassing approval since they used an invite link)
	contact := &models.Contact{
		ID:            uuid.New(),
		UserID:        acceptingUserID,
		ContactUserID: info.User.ID,
		Status:        "accepted",
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO contacts (id, user_id, contact_user_id, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT DO NOTHING
	`, contact.ID, contact.UserID, contact.ContactUserID, contact.Status, contact.CreatedAt, contact.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create contact: %w", err)
	}

	// Create reverse contact
	reverseContact := &models.Contact{
		ID:            uuid.New(),
		UserID:        info.User.ID,
		ContactUserID: acceptingUserID,
		Status:        "accepted",
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO contacts (id, user_id, contact_user_id, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT DO NOTHING
	`, reverseContact.ID, reverseContact.UserID, reverseContact.ContactUserID, reverseContact.Status, reverseContact.CreatedAt, reverseContact.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create reverse contact: %w", err)
	}

	return contact, nil
}

// GetUserInvites retrieves all invites created by a user
func (s *Service) GetUserInvites(ctx context.Context, userID uuid.UUID) ([]models.InviteCode, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, code, max_uses, use_count, expires_at, is_active, created_at, updated_at
		FROM invite_codes
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query invites: %w", err)
	}
	defer rows.Close()

	var invites []models.InviteCode
	for rows.Next() {
		var i models.InviteCode
		if err := rows.Scan(&i.ID, &i.UserID, &i.Code, &i.MaxUses, &i.UseCount, &i.ExpiresAt, &i.IsActive, &i.CreatedAt, &i.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan invite: %w", err)
		}
		invites = append(invites, i)
	}

	return invites, nil
}

// DeactivateInvite deactivates an invite code
func (s *Service) DeactivateInvite(ctx context.Context, inviteID, userID uuid.UUID) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE invite_codes SET is_active = false, updated_at = $1
		WHERE id = $2 AND user_id = $3
	`, time.Now(), inviteID, userID)
	if err != nil {
		return fmt.Errorf("failed to deactivate invite: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return ErrInviteNotFound
	}

	return nil
}

// ============================================================================
// Settings Operations
// ============================================================================

// GetSettings retrieves user settings
func (s *Service) GetSettings(ctx context.Context, userID uuid.UUID) (*models.UserSettings, error) {
	var settings models.UserSettings

	err := s.db.QueryRowContext(ctx, `
		SELECT user_id, require_contact_approval, updated_at
		FROM user_settings
		WHERE user_id = $1
	`, userID).Scan(&settings.UserID, &settings.RequireContactApproval, &settings.UpdatedAt)

	if err == sql.ErrNoRows {
		// Return default settings
		return &models.UserSettings{
			UserID:                 userID,
			RequireContactApproval: true,
			UpdatedAt:              time.Now(),
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query settings: %w", err)
	}

	return &settings, nil
}

// UpdateSettings updates user settings
func (s *Service) UpdateSettings(ctx context.Context, userID uuid.UUID, requireApproval bool) (*models.UserSettings, error) {
	settings := &models.UserSettings{
		UserID:                 userID,
		RequireContactApproval: requireApproval,
		UpdatedAt:              time.Now(),
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO user_settings (user_id, require_contact_approval, updated_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		SET require_contact_approval = EXCLUDED.require_contact_approval,
		    updated_at = EXCLUDED.updated_at
	`, settings.UserID, settings.RequireContactApproval, settings.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to update settings: %w", err)
	}

	return settings, nil
}

// ============================================================================
// Helper Operations
// ============================================================================

// GetPendingCount returns the count of pending contact requests for a user
func (s *Service) GetPendingCount(ctx context.Context, userID uuid.UUID) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM contacts
		WHERE contact_user_id = $1 AND status = 'pending'
	`, userID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count pending requests: %w", err)
	}
	return count, nil
}
