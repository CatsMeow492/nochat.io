package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrEmailNotVerified   = errors.New("email not verified")
	ErrTooManyAttempts    = errors.New("too many login attempts")
)

type AuthService struct {
	db *sql.DB
}

type Session struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	User      *User     `json:"user"`
}

type User struct {
	ID                     string    `json:"id"`
	Email                  string    `json:"email,omitempty"`
	Name                   string    `json:"name"`
	WalletAddress          string    `json:"wallet_address,omitempty"`
	PasswordHash           string    `json:"-"`
	EmailVerified          bool      `json:"email_verified"`
	EmailVerificationToken string    `json:"-"`
	LastLoginAt            time.Time `json:"last_login_at"`
}

func NewAuthService(db *sql.DB) *AuthService {
	return &AuthService{db: db}
}

func (s *AuthService) RegisterUser(ctx context.Context, email, name, password string) (*User, error) {
	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %v", err)
	}

	// Generate email verification token
	verificationToken, err := generateToken(32)
	if err != nil {
		return nil, fmt.Errorf("failed to generate verification token: %v", err)
	}

	// Create user
	var user User
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO users (
			email, 
			name, 
			password_hash, 
			email_verification_token,
			email_verification_expires_at
		)
		VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')
		RETURNING id, email, name, email_verified
	`, email, name, hashedPassword, verificationToken).Scan(
		&user.ID, &user.Email, &user.Name, &user.EmailVerified,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %v", err)
	}

	return &user, nil
}

func (s *AuthService) Login(ctx context.Context, email, password string, r *http.Request) (*Session, error) {
	log.Printf("[DEBUG] Starting login process for email: %s", email)

	// Check for too many failed attempts
	if err := s.checkLoginAttempts(ctx, email); err != nil {
		log.Printf("[ERROR] Failed to check login attempts: %v", err)
		return nil, err
	}

	// Get user
	var user User
	err := s.db.QueryRowContext(ctx, `
		SELECT id, email, name, password_hash, email_verified
		FROM users
		WHERE email = $1
	`, email).Scan(
		&user.ID, &user.Email, &user.Name, &user.PasswordHash, &user.EmailVerified,
	)
	if err == sql.ErrNoRows {
		log.Printf("[DEBUG] No user found with email: %s", email)
		if err := s.recordFailedAttempt(ctx, email); err != nil {
			log.Printf("[ERROR] Failed to record failed attempt: %v", err)
			return nil, fmt.Errorf("failed to record failed attempt: %v", err)
		}
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		log.Printf("[ERROR] Failed to get user: %v", err)
		return nil, fmt.Errorf("failed to get user: %v", err)
	}

	// Check password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		log.Printf("[DEBUG] Invalid password for user: %s", email)
		if err := s.recordFailedAttempt(ctx, email); err != nil {
			log.Printf("[ERROR] Failed to record failed attempt: %v", err)
			return nil, fmt.Errorf("failed to record failed attempt: %v", err)
		}
		return nil, ErrInvalidCredentials
	}

	// Check email verification
	if !user.EmailVerified {
		log.Printf("[DEBUG] Email not verified for user: %s", email)
		return nil, ErrEmailNotVerified
	}

	// Generate session token
	token, err := generateToken(32)
	if err != nil {
		log.Printf("[ERROR] Failed to generate session token: %v", err)
		return nil, fmt.Errorf("failed to generate session token: %v", err)
	}

	// Create session
	expiresAt := time.Now().Add(24 * time.Hour)
	var session Session
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO sessions (user_id, token, expires_at)
		VALUES ($1, $2, $3)
		RETURNING id, user_id, token, expires_at
	`, user.ID, token, expiresAt).Scan(
		&session.ID, &session.UserID, &session.Token, &session.ExpiresAt,
	)
	if err != nil {
		log.Printf("[ERROR] Failed to create session: %v", err)
		return nil, fmt.Errorf("failed to create session: %v", err)
	}

	// Update last login
	_, err = s.db.ExecContext(ctx, `
		UPDATE users
		SET last_login_at = NOW()
		WHERE id = $1
	`, user.ID)
	if err != nil {
		log.Printf("[ERROR] Failed to update last login: %v", err)
		return nil, fmt.Errorf("failed to update last login: %v", err)
	}

	log.Printf("[DEBUG] Successfully logged in user: %s", email)
	session.User = &user
	return &session, nil
}

func (s *AuthService) ValidateSession(ctx context.Context, token string) (*Session, error) {
	var session Session
	var user User

	err := s.db.QueryRowContext(ctx, `
		SELECT s.id, s.user_id, s.token, s.expires_at,
			   u.id, u.email, u.name, u.email_verified
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token = $1 AND s.expires_at > NOW()
	`, token).Scan(
		&session.ID, &session.UserID, &session.Token, &session.ExpiresAt,
		&user.ID, &user.Email, &user.Name, &user.EmailVerified,
	)
	if err == sql.ErrNoRows {
		return nil, errors.New("invalid or expired session")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to validate session: %v", err)
	}

	session.User = &user
	return &session, nil
}

func (s *AuthService) Logout(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM sessions
		WHERE token = $1
	`, token)
	return err
}

func (s *AuthService) VerifyEmail(ctx context.Context, token string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE users
		SET email_verified = true,
			email_verification_token = NULL
		WHERE email_verification_token = $1
	`, token)
	if err != nil {
		return fmt.Errorf("failed to verify email: %v", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %v", err)
	}
	if rows == 0 {
		return errors.New("invalid verification token")
	}

	return nil
}

func (s *AuthService) RequestPasswordReset(ctx context.Context, email string) (*User, error) {
	// Generate reset token
	token, err := generateToken(32)
	if err != nil {
		return nil, fmt.Errorf("failed to generate reset token: %v", err)
	}

	// Set expiration time (1 hour from now)
	expiresAt := time.Now().Add(time.Hour)

	var user User
	err = s.db.QueryRowContext(ctx, `
		UPDATE users
		SET password_reset_token = $1,
			password_reset_expires_at = $2
		WHERE email = $3
		RETURNING id, email, name
	`, token, expiresAt, email).Scan(&user.ID, &user.Email, &user.Name)
	if err == sql.ErrNoRows {
		return nil, nil // User not found, but don't reveal this
	}
	if err != nil {
		return nil, fmt.Errorf("failed to set reset token: %v", err)
	}

	return &user, nil
}

func (s *AuthService) ResetPassword(ctx context.Context, token, newPassword string) error {
	// Hash new password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %v", err)
	}

	result, err := s.db.ExecContext(ctx, `
		UPDATE users
		SET password_hash = $1,
			password_reset_token = NULL,
			password_reset_expires_at = NULL
		WHERE password_reset_token = $2
		AND password_reset_expires_at > NOW()
	`, hashedPassword, token)
	if err != nil {
		return fmt.Errorf("failed to reset password: %v", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %v", err)
	}
	if rows == 0 {
		return errors.New("invalid or expired reset token")
	}

	return nil
}

func (s *AuthService) checkLoginAttempts(ctx context.Context, email string) error {
	log.Printf("[DEBUG] Checking login attempts for email: %s", email)
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM failed_login_attempts
		WHERE email = $1
		AND created_at > NOW() - INTERVAL '15 minutes'
	`, email).Scan(&count)
	if err != nil {
		log.Printf("[ERROR] Failed to check login attempts: %v", err)
		return fmt.Errorf("failed to check login attempts: %v", err)
	}

	if count >= 5 {
		log.Printf("[DEBUG] Too many login attempts for email: %s (count: %d)", email, count)
		return ErrTooManyAttempts
	}

	log.Printf("[DEBUG] Login attempts check passed for email: %s (count: %d)", email, count)
	return nil
}

func (s *AuthService) recordFailedAttempt(ctx context.Context, email string) error {
	log.Printf("[DEBUG] Recording failed login attempt for email: %s", email)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO failed_login_attempts (email)
		VALUES ($1)
	`, email)
	if err != nil {
		log.Printf("[ERROR] Failed to record login attempt: %v", err)
		return fmt.Errorf("failed to record login attempt: %v", err)
	}

	log.Printf("[DEBUG] Successfully recorded failed login attempt for email: %s", email)
	return nil
}

func generateToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(bytes), nil
}
