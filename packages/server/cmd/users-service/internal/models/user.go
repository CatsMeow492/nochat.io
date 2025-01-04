package models

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID                       string     `json:"id"`
	Email                    string     `json:"email,omitempty"`
	Name                     string     `json:"name"`
	WalletAddress            string     `json:"wallet_address,omitempty"`
	PasswordHash             string     `json:"-"`
	EmailVerified            bool       `json:"email_verified"`
	EmailVerificationToken   string     `json:"-"`
	EmailVerificationExpires *time.Time `json:"-"`
	PasswordResetToken       string     `json:"-"`
	PasswordResetExpires     *time.Time `json:"-"`
	LastLoginAt              *time.Time `json:"last_login_at,omitempty"`
	CreatedAt                time.Time  `json:"created_at"`
	UpdatedAt                time.Time  `json:"updated_at"`
}

type Session struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	Token          string    `json:"token"`
	ExpiresAt      time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`
	LastActivityAt time.Time `json:"last_activity_at"`
	IPAddress      string    `json:"ip_address"`
	UserAgent      string    `json:"user_agent"`
	IsValid        bool      `json:"is_valid"`
}

type FailedLoginAttempt struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	IPAddress   string    `json:"ip_address"`
	AttemptedAt time.Time `json:"attempted_at"`
}

// SetPassword hashes and sets the user's password
func (u *User) SetPassword(password string) error {
	if len(password) < 8 {
		return errors.New("password must be at least 8 characters")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	u.PasswordHash = string(hash)
	return nil
}

// CheckPassword verifies the provided password against the hash
func (u *User) CheckPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password))
	return err == nil
}

// GenerateToken creates a cryptographically secure random token
func GenerateToken(length int) (string, error) {
	b := make([]byte, length)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// GenerateEmailVerificationToken creates and sets a new email verification token
func (u *User) GenerateEmailVerificationToken() error {
	token, err := GenerateToken(32)
	if err != nil {
		return err
	}

	expires := time.Now().Add(24 * time.Hour)
	u.EmailVerificationToken = token
	u.EmailVerificationExpires = &expires
	return nil
}

// GeneratePasswordResetToken creates and sets a new password reset token
func (u *User) GeneratePasswordResetToken() error {
	token, err := GenerateToken(32)
	if err != nil {
		return err
	}

	expires := time.Now().Add(1 * time.Hour)
	u.PasswordResetToken = token
	u.PasswordResetExpires = &expires
	return nil
}

// IsPasswordResetTokenValid checks if the reset token is valid and not expired
func (u *User) IsPasswordResetTokenValid(token string) bool {
	if u.PasswordResetToken == "" || u.PasswordResetExpires == nil {
		return false
	}

	if time.Now().After(*u.PasswordResetExpires) {
		return false
	}

	return u.PasswordResetToken == token
}

// IsEmailVerificationTokenValid checks if the verification token is valid and not expired
func (u *User) IsEmailVerificationTokenValid(token string) bool {
	if u.EmailVerificationToken == "" || u.EmailVerificationExpires == nil {
		return false
	}

	if time.Now().After(*u.EmailVerificationExpires) {
		return false
	}

	return u.EmailVerificationToken == token
}
