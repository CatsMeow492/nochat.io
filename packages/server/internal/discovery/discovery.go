package discovery

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kindlyrobotics/nochat/internal/models"
)

var (
	ErrPhoneAlreadyVerified  = errors.New("phone number already verified")
	ErrVerificationNotFound  = errors.New("verification not found")
	ErrVerificationExpired   = errors.New("verification code expired")
	ErrInvalidCode           = errors.New("invalid verification code")
	ErrTooManyAttempts       = errors.New("too many verification attempts")
	ErrPhoneInUse            = errors.New("phone number already in use by another user")
	ErrRateLimitExceeded     = errors.New("rate limit exceeded")
	ErrTooManyHashes         = errors.New("too many contact hashes in request")
)

const (
	VerificationCodeLength = 6
	VerificationExpiry     = 10 * time.Minute
	MaxVerificationAttempts = 3
	MaxCodesPerDay         = 5
	MaxHashesPerSync       = 100
)

type Service struct {
	db                    *sql.DB
	pepper                string // Server-side pepper for hashing
	twilioAccountSID      string
	twilioAuthToken       string
	twilioVerifyServiceSID string
}

func NewService(db *sql.DB) *Service {
	pepper := os.Getenv("PHONE_HASH_PEPPER")
	if pepper == "" {
		pepper = "default-pepper-change-in-production" // Default for development
	}
	return &Service{
		db:                    db,
		pepper:                pepper,
		twilioAccountSID:      os.Getenv("TWILIO_ACCOUNT_SID"),
		twilioAuthToken:       os.Getenv("TWILIO_AUTH_TOKEN"),
		twilioVerifyServiceSID: os.Getenv("TWILIO_VERIFY_SERVICE_SID"),
	}
}

// ============================================================================
// Phone Verification
// ============================================================================

// SendVerificationCode sends an SMS verification code to the given phone number
func (s *Service) SendVerificationCode(ctx context.Context, userID uuid.UUID, phoneNumber string) (*models.PhoneVerification, error) {
	// Normalize phone number
	normalized := normalizePhone(phoneNumber)
	if normalized == "" {
		return nil, errors.New("invalid phone number format")
	}

	// Check if user already has this phone verified
	var existingVerified bool
	err := s.db.QueryRowContext(ctx, `
		SELECT phone_verified FROM users WHERE id = $1
	`, userID).Scan(&existingVerified)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to check user: %w", err)
	}

	// Check if phone is already in use by another user
	var existingUserID uuid.UUID
	err = s.db.QueryRowContext(ctx, `
		SELECT id FROM users WHERE phone_number = $1 AND phone_verified = true AND id != $2
	`, normalized, userID).Scan(&existingUserID)
	if err == nil {
		return nil, ErrPhoneInUse
	}
	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to check phone in use: %w", err)
	}

	// Rate limit: max N codes per phone per day
	var codeCount int
	err = s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM phone_verifications
		WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
	`, userID).Scan(&codeCount)
	if err != nil {
		return nil, fmt.Errorf("failed to check rate limit: %w", err)
	}
	if codeCount >= MaxCodesPerDay {
		return nil, ErrRateLimitExceeded
	}

	// Create verification record (we track attempts even when using Twilio Verify)
	verification := &models.PhoneVerification{
		ID:          uuid.New(),
		UserID:      userID,
		PhoneNumber: normalized,
		Code:        "", // Twilio manages the code
		ExpiresAt:   time.Now().Add(VerificationExpiry),
		Attempts:    0,
		CreatedAt:   time.Now(),
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO phone_verifications (id, user_id, phone_number, code, expires_at, attempts, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, verification.ID, verification.UserID, verification.PhoneNumber, verification.Code, verification.ExpiresAt, verification.Attempts, verification.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create verification: %w", err)
	}

	// Send SMS via Twilio Verify
	if s.twilioVerifyServiceSID != "" {
		if err := s.sendTwilioVerification(normalized); err != nil {
			fmt.Printf("[Discovery] Twilio error: %v\n", err)
			return nil, fmt.Errorf("failed to send SMS: %w", err)
		}
		fmt.Printf("[Discovery] Sent verification SMS to %s via Twilio\n", normalized)
	} else {
		// Development mode - generate and log code
		fmt.Printf("[Discovery] Twilio not configured. Verification code for %s: 123456 (dev mode)\n", normalized)
	}

	return verification, nil
}

// SendAuthCode sends a verification code for phone-based authentication (no user required)
func (s *Service) SendAuthCode(ctx context.Context, phoneNumber string) error {
	normalized := normalizePhone(phoneNumber)
	if normalized == "" {
		return errors.New("invalid phone number format")
	}

	// Send via Twilio Verify (only if all credentials are configured)
	if s.twilioAccountSID != "" && s.twilioAuthToken != "" && s.twilioVerifyServiceSID != "" {
		return s.sendTwilioVerification(normalized)
	}

	// Dev mode - code is "123456"
	fmt.Printf("[Discovery] Dev mode: use code 123456 for phone auth %s\n", normalized)
	return nil
}

// VerifyAuthCode verifies a code for phone-based authentication (no user required)
func (s *Service) VerifyAuthCode(ctx context.Context, phoneNumber, code string) error {
	normalized := normalizePhone(phoneNumber)
	if normalized == "" {
		return errors.New("invalid phone number format")
	}

	// Verify via Twilio Verify (only if all credentials are configured)
	if s.twilioAccountSID != "" && s.twilioAuthToken != "" && s.twilioVerifyServiceSID != "" {
		approved, err := s.verifyTwilioCode(normalized, code)
		if err != nil {
			return fmt.Errorf("failed to verify code: %w", err)
		}
		if !approved {
			return ErrInvalidCode
		}
		return nil
	}

	// Dev mode - accept "123456"
	if code != "123456" {
		return ErrInvalidCode
	}
	return nil
}

// VerifyCode verifies the SMS code and marks the phone as verified
func (s *Service) VerifyCode(ctx context.Context, userID uuid.UUID, code string) error {
	// Get the most recent unverified code for this user
	var verification models.PhoneVerification
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, phone_number, code, expires_at, attempts
		FROM phone_verifications
		WHERE user_id = $1 AND verified_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1
	`, userID).Scan(&verification.ID, &verification.UserID, &verification.PhoneNumber, &verification.Code, &verification.ExpiresAt, &verification.Attempts)
	if err == sql.ErrNoRows {
		return ErrVerificationNotFound
	}
	if err != nil {
		return fmt.Errorf("failed to get verification: %w", err)
	}

	// Check if expired
	if time.Now().After(verification.ExpiresAt) {
		return ErrVerificationExpired
	}

	// Check attempt limit
	if verification.Attempts >= MaxVerificationAttempts {
		return ErrTooManyAttempts
	}

	// Increment attempts
	_, err = s.db.ExecContext(ctx, `
		UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = $1
	`, verification.ID)
	if err != nil {
		return fmt.Errorf("failed to update attempts: %w", err)
	}

	// Verify code via Twilio Verify or locally
	if s.twilioVerifyServiceSID != "" {
		approved, err := s.verifyTwilioCode(verification.PhoneNumber, code)
		if err != nil {
			fmt.Printf("[Discovery] Twilio verify error: %v\n", err)
			return fmt.Errorf("failed to verify code: %w", err)
		}
		if !approved {
			return ErrInvalidCode
		}
	} else {
		// Development mode - accept "123456" as the code
		if code != "123456" {
			return ErrInvalidCode
		}
	}

	// Mark as verified
	now := time.Now()
	_, err = s.db.ExecContext(ctx, `
		UPDATE phone_verifications SET verified_at = $1 WHERE id = $2
	`, now, verification.ID)
	if err != nil {
		return fmt.Errorf("failed to mark verification: %w", err)
	}

	// Update user's phone number
	phoneHash := s.hashPhoneWithPepper(verification.PhoneNumber)
	_, err = s.db.ExecContext(ctx, `
		UPDATE users SET phone_number = $1, phone_verified = true, phone_hash = $2 WHERE id = $3
	`, verification.PhoneNumber, phoneHash, userID)
	if err != nil {
		return fmt.Errorf("failed to update user phone: %w", err)
	}

	// Process discovery notifications for users who have this phone in contacts
	go s.processNewVerification(context.Background(), userID, phoneHash)

	return nil
}

// RemovePhoneNumber removes the phone number from a user's account
func (s *Service) RemovePhoneNumber(ctx context.Context, userID uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE users SET phone_number = NULL, phone_verified = false, phone_hash = NULL WHERE id = $1
	`, userID)
	if err != nil {
		return fmt.Errorf("failed to remove phone: %w", err)
	}

	// Also clear uploaded contact hashes
	_, err = s.db.ExecContext(ctx, `
		DELETE FROM contact_hashes WHERE user_id = $1
	`, userID)
	if err != nil {
		return fmt.Errorf("failed to clear contact hashes: %w", err)
	}

	return nil
}

// GetPhoneStatus returns the phone verification status for a user
func (s *Service) GetPhoneStatus(ctx context.Context, userID uuid.UUID) (*models.PhoneStatus, error) {
	var phoneNumber *string
	var phoneVerified bool

	err := s.db.QueryRowContext(ctx, `
		SELECT phone_number, COALESCE(phone_verified, false) FROM users WHERE id = $1
	`, userID).Scan(&phoneNumber, &phoneVerified)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	status := &models.PhoneStatus{
		HasPhone:      phoneNumber != nil && *phoneNumber != "",
		PhoneVerified: phoneVerified,
	}

	// Get last 4 digits
	if status.HasPhone && phoneNumber != nil {
		phone := *phoneNumber
		if len(phone) >= 4 {
			last4 := phone[len(phone)-4:]
			status.PhoneLast4 = &last4
		}
	}

	// Check if contacts are synced
	var hashCount int
	err = s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM contact_hashes WHERE user_id = $1
	`, userID).Scan(&hashCount)
	if err == nil && hashCount > 0 {
		status.ContactsSynced = true
	}

	return status, nil
}

// ============================================================================
// Contact Sync
// ============================================================================

// SyncContacts uploads hashed phone contacts and returns matches
func (s *Service) SyncContacts(ctx context.Context, userID uuid.UUID, phoneHashes []string) (*models.ContactSyncResult, error) {
	if len(phoneHashes) > MaxHashesPerSync {
		return nil, ErrTooManyHashes
	}

	// Begin transaction
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Clear existing hashes for this user (replace sync)
	_, err = tx.ExecContext(ctx, `DELETE FROM contact_hashes WHERE user_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to clear existing hashes: %w", err)
	}

	// Insert new hashes
	for _, clientHash := range phoneHashes {
		// Re-hash with server pepper for storage
		serverHash := s.hashForMatching(clientHash)
		_, err = tx.ExecContext(ctx, `
			INSERT INTO contact_hashes (id, user_id, phone_hash, created_at)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (user_id, phone_hash) DO NOTHING
		`, uuid.New(), userID, serverHash, time.Now())
		if err != nil {
			return nil, fmt.Errorf("failed to insert hash: %w", err)
		}
	}

	// Find matches - users whose phone_hash matches our contact hashes
	rows, err := tx.QueryContext(ctx, `
		SELECT DISTINCT u.id, u.username, u.display_name, u.avatar_url
		FROM users u
		INNER JOIN contact_hashes ch ON ch.phone_hash = u.phone_hash
		WHERE ch.user_id = $1
		  AND u.phone_verified = true
		  AND u.id != $1
		  AND NOT EXISTS (
			SELECT 1 FROM contacts c
			WHERE (c.user_id = $1 AND c.contact_user_id = u.id)
			   OR (c.user_id = u.id AND c.contact_user_id = $1)
		  )
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to find matches: %w", err)
	}
	defer rows.Close()

	var discoveredUsers []models.DiscoveredContact
	for rows.Next() {
		var dc models.DiscoveredContact
		if err := rows.Scan(&dc.UserID, &dc.Username, &dc.DisplayName, &dc.AvatarURL); err != nil {
			return nil, fmt.Errorf("failed to scan match: %w", err)
		}
		dc.DiscoveredAt = time.Now()
		discoveredUsers = append(discoveredUsers, dc)
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit: %w", err)
	}

	return &models.ContactSyncResult{
		TotalUploaded:   len(phoneHashes),
		MatchesFound:    len(discoveredUsers),
		NewMatches:      len(discoveredUsers), // All matches are new since we just synced
		DiscoveredUsers: discoveredUsers,
	}, nil
}

// GetDiscoveredContacts returns all discovered contacts for a user
func (s *Service) GetDiscoveredContacts(ctx context.Context, userID uuid.UUID) ([]models.DiscoveredContact, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT u.id, u.username, u.display_name, u.avatar_url
		FROM users u
		INNER JOIN contact_hashes ch ON ch.phone_hash = u.phone_hash
		WHERE ch.user_id = $1
		  AND u.phone_verified = true
		  AND u.id != $1
		  AND NOT EXISTS (
			SELECT 1 FROM contacts c
			WHERE (c.user_id = $1 AND c.contact_user_id = u.id)
			   OR (c.user_id = u.id AND c.contact_user_id = $1)
		  )
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get discovered contacts: %w", err)
	}
	defer rows.Close()

	var contacts []models.DiscoveredContact
	for rows.Next() {
		var dc models.DiscoveredContact
		if err := rows.Scan(&dc.UserID, &dc.Username, &dc.DisplayName, &dc.AvatarURL); err != nil {
			return nil, fmt.Errorf("failed to scan contact: %w", err)
		}
		dc.DiscoveredAt = time.Now()
		contacts = append(contacts, dc)
	}

	return contacts, nil
}

// ClearUploadedContacts removes all uploaded contact hashes for a user
func (s *Service) ClearUploadedContacts(ctx context.Context, userID uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM contact_hashes WHERE user_id = $1`, userID)
	if err != nil {
		return fmt.Errorf("failed to clear hashes: %w", err)
	}
	return nil
}

// ============================================================================
// Discovery Notifications
// ============================================================================

// processNewVerification is called when a user verifies their phone
// It creates discovery notifications for users who have that phone in their contacts
func (s *Service) processNewVerification(ctx context.Context, newUserID uuid.UUID, phoneHash string) {
	// Find users who have this phone hash in their contacts
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT ch.user_id
		FROM contact_hashes ch
		WHERE ch.phone_hash = $1 AND ch.user_id != $2
	`, phoneHash, newUserID)
	if err != nil {
		fmt.Printf("[Discovery] Error finding users with contact: %v\n", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var watcherUserID uuid.UUID
		if err := rows.Scan(&watcherUserID); err != nil {
			continue
		}

		// Create discovery notification
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO discovery_queue (id, user_id, discovered_user_id, notified, created_at)
			VALUES ($1, $2, $3, false, $4)
			ON CONFLICT (user_id, discovered_user_id) DO NOTHING
		`, uuid.New(), watcherUserID, newUserID, time.Now())
		if err != nil {
			fmt.Printf("[Discovery] Error creating notification: %v\n", err)
		}
	}
}

// GetPendingNotifications returns pending discovery notifications for a user
func (s *Service) GetPendingNotifications(ctx context.Context, userID uuid.UUID) ([]models.DiscoveredContact, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT dq.discovered_user_id, u.username, u.display_name, u.avatar_url, dq.created_at
		FROM discovery_queue dq
		JOIN users u ON u.id = dq.discovered_user_id
		WHERE dq.user_id = $1 AND dq.notified = false
		ORDER BY dq.created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get notifications: %w", err)
	}
	defer rows.Close()

	var notifications []models.DiscoveredContact
	for rows.Next() {
		var n models.DiscoveredContact
		if err := rows.Scan(&n.UserID, &n.Username, &n.DisplayName, &n.AvatarURL, &n.DiscoveredAt); err != nil {
			return nil, fmt.Errorf("failed to scan notification: %w", err)
		}
		notifications = append(notifications, n)
	}

	return notifications, nil
}

// MarkNotificationsRead marks discovery notifications as read
func (s *Service) MarkNotificationsRead(ctx context.Context, userID uuid.UUID, notificationIDs []uuid.UUID) error {
	if len(notificationIDs) == 0 {
		// Mark all as read
		_, err := s.db.ExecContext(ctx, `
			UPDATE discovery_queue SET notified = true, notified_at = $1
			WHERE user_id = $2 AND notified = false
		`, time.Now(), userID)
		return err
	}

	// Mark specific ones as read
	for _, id := range notificationIDs {
		_, err := s.db.ExecContext(ctx, `
			UPDATE discovery_queue SET notified = true, notified_at = $1
			WHERE id = $2 AND user_id = $3
		`, time.Now(), id, userID)
		if err != nil {
			return err
		}
	}
	return nil
}

// ============================================================================
// Helper Functions
// ============================================================================

// normalizePhone normalizes a phone number to E.164 format
func normalizePhone(phone string) string {
	// Remove all non-digit characters except leading +
	re := regexp.MustCompile(`[^\d+]`)
	normalized := re.ReplaceAllString(phone, "")

	// Ensure it starts with +
	if !strings.HasPrefix(normalized, "+") {
		// Assume US if no country code
		normalized = "+1" + normalized
	}

	// Basic validation: should be between 10 and 15 digits (excluding +)
	digits := strings.TrimPrefix(normalized, "+")
	if len(digits) < 10 || len(digits) > 15 {
		return ""
	}

	return normalized
}

// hashPhoneWithPepper hashes a phone number with the server pepper
func (s *Service) hashPhoneWithPepper(phone string) string {
	h := sha256.New()
	h.Write([]byte(phone + s.pepper))
	return hex.EncodeToString(h.Sum(nil))
}

// hashForMatching re-hashes a client-side hash with the server pepper
// This allows matching without exposing the pepper to clients
func (s *Service) hashForMatching(clientHash string) string {
	h := sha256.New()
	h.Write([]byte(clientHash + s.pepper))
	return hex.EncodeToString(h.Sum(nil))
}

// sendTwilioVerification sends an SMS via Twilio Verify API
func (s *Service) sendTwilioVerification(phone string) error {
	if s.twilioAccountSID == "" || s.twilioAuthToken == "" || s.twilioVerifyServiceSID == "" {
		return fmt.Errorf("Twilio credentials not configured")
	}

	// Twilio Verify API endpoint
	apiURL := fmt.Sprintf("https://verify.twilio.com/v2/Services/%s/Verifications", s.twilioVerifyServiceSID)

	// Create form data
	data := url.Values{}
	data.Set("To", phone)
	data.Set("Channel", "sms")

	req, err := http.NewRequest("POST", apiURL, bytes.NewBufferString(data.Encode()))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(s.twilioAccountSID, s.twilioAuthToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Twilio API error (status %d): %s", resp.StatusCode, string(body))
	}

	return nil
}

// verifyTwilioCode verifies a code via Twilio Verify API
func (s *Service) verifyTwilioCode(phone, code string) (bool, error) {
	if s.twilioAccountSID == "" || s.twilioAuthToken == "" || s.twilioVerifyServiceSID == "" {
		return false, fmt.Errorf("Twilio credentials not configured")
	}

	// Twilio Verify API endpoint
	apiURL := fmt.Sprintf("https://verify.twilio.com/v2/Services/%s/VerificationCheck", s.twilioVerifyServiceSID)

	// Create form data
	data := url.Values{}
	data.Set("To", phone)
	data.Set("Code", code)

	req, err := http.NewRequest("POST", apiURL, bytes.NewBufferString(data.Encode()))
	if err != nil {
		return false, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(s.twilioAccountSID, s.twilioAuthToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, fmt.Errorf("failed to read response: %w", err)
	}

	var result struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return false, fmt.Errorf("failed to parse response: %w", err)
	}

	return result.Status == "approved", nil
}
