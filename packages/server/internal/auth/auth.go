package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gitlab.com/secp/services/backend/internal/models"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserNotFound       = errors.New("user not found")
	ErrUserExists         = errors.New("user already exists")
	ErrInvalidToken       = errors.New("invalid token")
)

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

// CreateUser creates a new user with password
func (s *Service) CreateUser(ctx context.Context, username, email, password string) (*models.User, error) {
	// Hash password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	user := &models.User{
		ID:           uuid.New(),
		Username:     username,
		Email:        &email,
		PasswordHash: stringPtr(string(passwordHash)),
		DisplayName:  username,
		IsAnonymous:  false,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
		LastSeenAt:   time.Now(),
	}

	query := `
		INSERT INTO users (id, username, email, password_hash, display_name, is_anonymous, created_at, updated_at, last_seen_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, username, email, display_name, is_anonymous, created_at, updated_at, last_seen_at
	`

	err = s.db.QueryRowContext(ctx, query,
		user.ID, user.Username, user.Email, user.PasswordHash, user.DisplayName,
		user.IsAnonymous, user.CreatedAt, user.UpdatedAt, user.LastSeenAt,
	).Scan(&user.ID, &user.Username, &user.Email, &user.DisplayName, &user.IsAnonymous,
		&user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	return user, nil
}

// CreateAnonymousUser creates a temporary anonymous user
func (s *Service) CreateAnonymousUser(ctx context.Context) (*models.User, error) {
	// Generate random username
	randomBytes := make([]byte, 8)
	if _, err := rand.Read(randomBytes); err != nil {
		return nil, fmt.Errorf("failed to generate random username: %w", err)
	}
	username := "anon_" + base64.URLEncoding.EncodeToString(randomBytes)[:12]

	user := &models.User{
		ID:          uuid.New(),
		Username:    username,
		DisplayName: "Anonymous",
		IsAnonymous: true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		LastSeenAt:  time.Now(),
	}

	query := `
		INSERT INTO users (id, username, display_name, is_anonymous, created_at, updated_at, last_seen_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, username, display_name, is_anonymous, created_at, updated_at, last_seen_at
	`

	err := s.db.QueryRowContext(ctx, query,
		user.ID, user.Username, user.DisplayName, user.IsAnonymous,
		user.CreatedAt, user.UpdatedAt, user.LastSeenAt,
	).Scan(&user.ID, &user.Username, &user.DisplayName, &user.IsAnonymous,
		&user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create anonymous user: %w", err)
	}

	return user, nil
}

// CreateWalletUser creates a user via Web3 wallet address
func (s *Service) CreateWalletUser(ctx context.Context, walletAddress string) (*models.User, error) {
	user := &models.User{
		ID:            uuid.New(),
		Username:      fmt.Sprintf("wallet_%s", walletAddress[:8]),
		WalletAddress: &walletAddress,
		DisplayName:   fmt.Sprintf("User %s", walletAddress[:6]),
		IsAnonymous:   false,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
		LastSeenAt:    time.Now(),
	}

	query := `
		INSERT INTO users (id, username, wallet_address, display_name, is_anonymous, created_at, updated_at, last_seen_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, username, wallet_address, display_name, is_anonymous, created_at, updated_at, last_seen_at
	`

	err := s.db.QueryRowContext(ctx, query,
		user.ID, user.Username, user.WalletAddress, user.DisplayName,
		user.IsAnonymous, user.CreatedAt, user.UpdatedAt, user.LastSeenAt,
	).Scan(&user.ID, &user.Username, &user.WalletAddress, &user.DisplayName,
		&user.IsAnonymous, &user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create wallet user: %w", err)
	}

	return user, nil
}

// AuthenticateUser verifies username/password and returns user
func (s *Service) AuthenticateUser(ctx context.Context, username, password string) (*models.User, error) {
	var user models.User
	var passwordHash string

	query := `
		SELECT id, username, email, password_hash, display_name, wallet_address,
		       avatar_url, is_anonymous, created_at, updated_at, last_seen_at
		FROM users
		WHERE username = $1 AND password_hash IS NOT NULL
	`

	err := s.db.QueryRowContext(ctx, query, username).Scan(
		&user.ID, &user.Username, &user.Email, &passwordHash, &user.DisplayName,
		&user.WalletAddress, &user.AvatarURL, &user.IsAnonymous,
		&user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt,
	)

	if err == sql.ErrNoRows {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query user: %w", err)
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	return &user, nil
}

// AuthenticateByEmail verifies email/password and returns user
func (s *Service) AuthenticateByEmail(ctx context.Context, email, password string) (*models.User, error) {
	var user models.User
	var passwordHash string

	query := `
		SELECT id, username, email, password_hash, display_name, wallet_address,
		       avatar_url, is_anonymous, created_at, updated_at, last_seen_at
		FROM users
		WHERE email = $1 AND password_hash IS NOT NULL
	`

	err := s.db.QueryRowContext(ctx, query, email).Scan(
		&user.ID, &user.Username, &user.Email, &passwordHash, &user.DisplayName,
		&user.WalletAddress, &user.AvatarURL, &user.IsAnonymous,
		&user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt,
	)

	if err == sql.ErrNoRows {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query user: %w", err)
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	return &user, nil
}

// GetUserByID retrieves a user by ID
func (s *Service) GetUserByID(ctx context.Context, userID uuid.UUID) (*models.User, error) {
	var user models.User

	query := `
		SELECT id, username, email, display_name, wallet_address, avatar_url,
		       is_anonymous, created_at, updated_at, last_seen_at
		FROM users
		WHERE id = $1
	`

	err := s.db.QueryRowContext(ctx, query, userID).Scan(
		&user.ID, &user.Username, &user.Email, &user.DisplayName,
		&user.WalletAddress, &user.AvatarURL, &user.IsAnonymous,
		&user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt,
	)

	if err == sql.ErrNoRows {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query user: %w", err)
	}

	return &user, nil
}

// GetUserByWallet retrieves a user by wallet address
func (s *Service) GetUserByWallet(ctx context.Context, walletAddress string) (*models.User, error) {
	var user models.User

	query := `
		SELECT id, username, email, display_name, wallet_address, avatar_url,
		       is_anonymous, created_at, updated_at, last_seen_at
		FROM users
		WHERE wallet_address = $1
	`

	err := s.db.QueryRowContext(ctx, query, walletAddress).Scan(
		&user.ID, &user.Username, &user.Email, &user.DisplayName,
		&user.WalletAddress, &user.AvatarURL, &user.IsAnonymous,
		&user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt,
	)

	if err == sql.ErrNoRows {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query user: %w", err)
	}

	return &user, nil
}

// UpdateLastSeen updates the user's last seen timestamp
func (s *Service) UpdateLastSeen(ctx context.Context, userID uuid.UUID) error {
	query := `UPDATE users SET last_seen_at = $1 WHERE id = $2`
	_, err := s.db.ExecContext(ctx, query, time.Now(), userID)
	return err
}

// GenerateSessionToken generates a simple session token (in production, use JWT or similar)
func (s *Service) GenerateSessionToken(userID uuid.UUID) (string, error) {
	// In a production app, you'd use JWT with proper signing
	// For now, we'll use a simple base64-encoded token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}

	token := base64.URLEncoding.EncodeToString(tokenBytes)
	return fmt.Sprintf("%s:%s", userID.String(), token), nil
}

// ValidateSessionToken validates a session token and returns the user ID
func (s *Service) ValidateSessionToken(token string) (uuid.UUID, error) {
	// Parse token (format: "userID:randomToken")
	// In production, use proper JWT validation
	parts := strings.SplitN(token, ":", 2)
	if len(parts) != 2 {
		return uuid.Nil, ErrInvalidToken
	}

	userID, err := uuid.Parse(parts[0])
	if err != nil {
		return uuid.Nil, ErrInvalidToken
	}

	return userID, nil
}

// SearchUsers searches for users by email, username, or user ID (UUID)
// Excludes anonymous users and the requesting user from results
func (s *Service) SearchUsers(ctx context.Context, query string, excludeUserID uuid.UUID, limit int) ([]*models.User, error) {
	if limit <= 0 || limit > 20 {
		limit = 10
	}

	// Clean up the query
	query = strings.TrimSpace(query)
	if len(query) < 2 {
		return []*models.User{}, nil
	}

	// Try to parse as UUID first (exact match)
	if parsedID, err := uuid.Parse(query); err == nil {
		var user models.User
		err := s.db.QueryRowContext(ctx, `
			SELECT id, username, email, display_name, wallet_address, avatar_url,
			       is_anonymous, created_at, updated_at, last_seen_at
			FROM users
			WHERE id = $1 AND is_anonymous = false AND id != $2
		`, parsedID, excludeUserID).Scan(
			&user.ID, &user.Username, &user.Email, &user.DisplayName,
			&user.WalletAddress, &user.AvatarURL, &user.IsAnonymous,
			&user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt,
		)
		if err == sql.ErrNoRows {
			return []*models.User{}, nil
		}
		if err != nil {
			return nil, fmt.Errorf("failed to search by ID: %w", err)
		}
		return []*models.User{&user}, nil
	}

	// Search by email (exact match) or username (prefix match)
	users := []*models.User{}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, username, email, display_name, wallet_address, avatar_url,
		       is_anonymous, created_at, updated_at, last_seen_at
		FROM users
		WHERE is_anonymous = false
		  AND id != $1
		  AND (
		      LOWER(email) = LOWER($2)
		      OR LOWER(username) LIKE LOWER($3)
		  )
		ORDER BY
		  CASE WHEN LOWER(email) = LOWER($2) THEN 0 ELSE 1 END,
		  username ASC
		LIMIT $4
	`, excludeUserID, query, query+"%", limit)
	if err != nil {
		return nil, fmt.Errorf("failed to search users: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var user models.User
		if err := rows.Scan(
			&user.ID, &user.Username, &user.Email, &user.DisplayName,
			&user.WalletAddress, &user.AvatarURL, &user.IsAnonymous,
			&user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan user: %w", err)
		}
		users = append(users, &user)
	}

	return users, nil
}

// GetUserByPhone retrieves a user by phone number
func (s *Service) GetUserByPhone(ctx context.Context, phoneNumber string) (*models.User, error) {
	var user models.User

	query := `
		SELECT id, username, email, display_name, wallet_address, avatar_url,
		       is_anonymous, phone_number, phone_verified, created_at, updated_at, last_seen_at
		FROM users
		WHERE phone_number = $1
	`

	err := s.db.QueryRowContext(ctx, query, phoneNumber).Scan(
		&user.ID, &user.Username, &user.Email, &user.DisplayName,
		&user.WalletAddress, &user.AvatarURL, &user.IsAnonymous,
		&user.PhoneNumber, &user.PhoneVerified,
		&user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt,
	)

	if err == sql.ErrNoRows {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query user: %w", err)
	}

	return &user, nil
}

// CreatePhoneUser creates a new user with a verified phone number
func (s *Service) CreatePhoneUser(ctx context.Context, phoneNumber string) (*models.User, error) {
	// Generate random username based on phone
	randomBytes := make([]byte, 4)
	if _, err := rand.Read(randomBytes); err != nil {
		return nil, fmt.Errorf("failed to generate random username: %w", err)
	}
	username := "user_" + base64.URLEncoding.EncodeToString(randomBytes)[:6]

	user := &models.User{
		ID:            uuid.New(),
		Username:      username,
		PhoneNumber:   &phoneNumber,
		PhoneVerified: true, // Already verified via OTP
		DisplayName:   username,
		IsAnonymous:   false,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
		LastSeenAt:    time.Now(),
	}

	query := `
		INSERT INTO users (id, username, phone_number, phone_verified, display_name, is_anonymous, created_at, updated_at, last_seen_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, username, phone_number, phone_verified, display_name, is_anonymous, created_at, updated_at, last_seen_at
	`

	err := s.db.QueryRowContext(ctx, query,
		user.ID, user.Username, user.PhoneNumber, user.PhoneVerified, user.DisplayName,
		user.IsAnonymous, user.CreatedAt, user.UpdatedAt, user.LastSeenAt,
	).Scan(&user.ID, &user.Username, &user.PhoneNumber, &user.PhoneVerified, &user.DisplayName,
		&user.IsAnonymous, &user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create phone user: %w", err)
	}

	return user, nil
}

// FindOrCreatePhoneUser finds an existing user by phone or creates a new one
func (s *Service) FindOrCreatePhoneUser(ctx context.Context, phoneNumber string) (*models.User, bool, error) {
	// Try to find existing user
	user, err := s.GetUserByPhone(ctx, phoneNumber)
	if err == nil {
		return user, false, nil // Existing user
	}
	if err != ErrUserNotFound {
		return nil, false, err
	}

	// Create new user
	user, err = s.CreatePhoneUser(ctx, phoneNumber)
	if err != nil {
		return nil, false, err
	}

	return user, true, nil // New user created
}

func stringPtr(s string) *string {
	return &s
}
