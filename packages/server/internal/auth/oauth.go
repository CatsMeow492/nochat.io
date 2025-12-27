package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kindlyrobotics/nochat/internal/models"
)

var (
	ErrOAuthProviderNotSupported = errors.New("OAuth provider not supported")
	ErrOAuthStateMismatch        = errors.New("OAuth state mismatch")
	ErrOAuthCodeExchange         = errors.New("failed to exchange OAuth code")
	ErrOAuthUserInfo             = errors.New("failed to get OAuth user info")
)

// OAuthConfig holds configuration for OAuth providers
type OAuthConfig struct {
	GoogleClientID       string
	GoogleClientSecret   string
	GitHubClientID       string
	GitHubClientSecret   string
	AppleClientID        string
	AppleClientSecret    string
	AppleTeamID          string
	AppleKeyID           string
	FacebookClientID     string
	FacebookClientSecret string
	RedirectBaseURL      string // Base URL for callbacks, e.g., "http://localhost:8080"
	FrontendURL          string // Frontend URL for final redirect, e.g., "http://localhost:3000"
}

// OAuthProvider represents a supported OAuth provider
type OAuthProvider string

const (
	ProviderGoogle   OAuthProvider = "google"
	ProviderGitHub   OAuthProvider = "github"
	ProviderApple    OAuthProvider = "apple"
	ProviderFacebook OAuthProvider = "facebook"
)

// OAuthAccount represents a linked OAuth account
type OAuthAccount struct {
	ID             uuid.UUID  `json:"id"`
	UserID         uuid.UUID  `json:"user_id"`
	Provider       string     `json:"provider"`
	ProviderUserID string     `json:"provider_user_id"`
	Email          *string    `json:"email,omitempty"`
	Name           *string    `json:"name,omitempty"`
	AvatarURL      *string    `json:"avatar_url,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// OAuthUserInfo holds user information from OAuth provider
type OAuthUserInfo struct {
	ID        string
	Email     string
	Name      string
	AvatarURL string
}

// OAuthService handles OAuth authentication
type OAuthService struct {
	db     *sql.DB
	config OAuthConfig
}

// NewOAuthService creates a new OAuth service
func NewOAuthService(db *sql.DB, config OAuthConfig) *OAuthService {
	return &OAuthService{
		db:     db,
		config: config,
	}
}

// GenerateState generates a random state string for OAuth CSRF protection
func (s *OAuthService) GenerateState() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// GetAuthURL returns the OAuth authorization URL for a provider
func (s *OAuthService) GetAuthURL(provider OAuthProvider, state string) (string, error) {
	redirectURI := fmt.Sprintf("%s/api/auth/oauth/%s/callback", s.config.RedirectBaseURL, provider)

	switch provider {
	case ProviderGoogle:
		if s.config.GoogleClientID == "" {
			return "", ErrOAuthProviderNotSupported
		}
		params := url.Values{
			"client_id":     {s.config.GoogleClientID},
			"redirect_uri":  {redirectURI},
			"response_type": {"code"},
			"scope":         {"openid email profile"},
			"state":         {state},
			"access_type":   {"offline"},
			"prompt":        {"consent"},
		}
		return "https://accounts.google.com/o/oauth2/v2/auth?" + params.Encode(), nil

	case ProviderGitHub:
		if s.config.GitHubClientID == "" {
			return "", ErrOAuthProviderNotSupported
		}
		params := url.Values{
			"client_id":    {s.config.GitHubClientID},
			"redirect_uri": {redirectURI},
			"scope":        {"user:email read:user"},
			"state":        {state},
		}
		return "https://github.com/login/oauth/authorize?" + params.Encode(), nil

	case ProviderApple:
		if s.config.AppleClientID == "" {
			return "", ErrOAuthProviderNotSupported
		}
		params := url.Values{
			"client_id":     {s.config.AppleClientID},
			"redirect_uri":  {redirectURI},
			"response_type": {"code"},
			"scope":         {"name email"},
			"response_mode": {"form_post"},
			"state":         {state},
		}
		return "https://appleid.apple.com/auth/authorize?" + params.Encode(), nil

	case ProviderFacebook:
		if s.config.FacebookClientID == "" {
			return "", ErrOAuthProviderNotSupported
		}
		params := url.Values{
			"client_id":    {s.config.FacebookClientID},
			"redirect_uri": {redirectURI},
			"scope":        {"email,public_profile"},
			"state":        {state},
		}
		return "https://www.facebook.com/v18.0/dialog/oauth?" + params.Encode(), nil

	default:
		return "", ErrOAuthProviderNotSupported
	}
}

// ExchangeCode exchanges an authorization code for tokens and user info
func (s *OAuthService) ExchangeCode(ctx context.Context, provider OAuthProvider, code string) (*OAuthUserInfo, error) {
	redirectURI := fmt.Sprintf("%s/api/auth/oauth/%s/callback", s.config.RedirectBaseURL, provider)

	switch provider {
	case ProviderGoogle:
		return s.exchangeGoogleCode(ctx, code, redirectURI)
	case ProviderGitHub:
		return s.exchangeGitHubCode(ctx, code, redirectURI)
	case ProviderApple:
		return s.exchangeAppleCode(ctx, code, redirectURI)
	case ProviderFacebook:
		return s.exchangeFacebookCode(ctx, code, redirectURI)
	default:
		return nil, ErrOAuthProviderNotSupported
	}
}

func (s *OAuthService) exchangeGoogleCode(ctx context.Context, code, redirectURI string) (*OAuthUserInfo, error) {
	// Exchange code for token
	tokenURL := "https://oauth2.googleapis.com/token"
	data := url.Values{
		"client_id":     {s.config.GoogleClientID},
		"client_secret": {s.config.GoogleClientSecret},
		"code":          {code},
		"grant_type":    {"authorization_code"},
		"redirect_uri":  {redirectURI},
	}

	resp, err := http.PostForm(tokenURL, data)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOAuthCodeExchange, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("%w: status %d, body: %s", ErrOAuthCodeExchange, resp.StatusCode, string(body))
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("%w: failed to decode token response: %v", ErrOAuthCodeExchange, err)
	}

	// Get user info
	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOAuthUserInfo, err)
	}
	req.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)

	client := &http.Client{Timeout: 10 * time.Second}
	userResp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOAuthUserInfo, err)
	}
	defer userResp.Body.Close()

	var userInfo struct {
		ID            string `json:"id"`
		Email         string `json:"email"`
		VerifiedEmail bool   `json:"verified_email"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := json.NewDecoder(userResp.Body).Decode(&userInfo); err != nil {
		return nil, fmt.Errorf("%w: failed to decode user info: %v", ErrOAuthUserInfo, err)
	}

	return &OAuthUserInfo{
		ID:        userInfo.ID,
		Email:     userInfo.Email,
		Name:      userInfo.Name,
		AvatarURL: userInfo.Picture,
	}, nil
}

func (s *OAuthService) exchangeGitHubCode(ctx context.Context, code, redirectURI string) (*OAuthUserInfo, error) {
	// Exchange code for token
	tokenURL := "https://github.com/login/oauth/access_token"
	data := url.Values{
		"client_id":     {s.config.GitHubClientID},
		"client_secret": {s.config.GitHubClientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
	}

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOAuthCodeExchange, err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOAuthCodeExchange, err)
	}
	defer resp.Body.Close()

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Scope       string `json:"scope"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("%w: failed to decode token response: %v", ErrOAuthCodeExchange, err)
	}
	if tokenResp.Error != "" {
		return nil, fmt.Errorf("%w: %s", ErrOAuthCodeExchange, tokenResp.Error)
	}

	// Get user info
	userReq, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user", nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOAuthUserInfo, err)
	}
	userReq.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)
	userReq.Header.Set("Accept", "application/vnd.github.v3+json")

	userResp, err := client.Do(userReq)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOAuthUserInfo, err)
	}
	defer userResp.Body.Close()

	var userInfo struct {
		ID        int64  `json:"id"`
		Login     string `json:"login"`
		Name      string `json:"name"`
		Email     string `json:"email"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := json.NewDecoder(userResp.Body).Decode(&userInfo); err != nil {
		return nil, fmt.Errorf("%w: failed to decode user info: %v", ErrOAuthUserInfo, err)
	}

	// If email is private, fetch from emails endpoint
	email := userInfo.Email
	if email == "" {
		emailReq, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user/emails", nil)
		if err == nil {
			emailReq.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)
			emailReq.Header.Set("Accept", "application/vnd.github.v3+json")
			emailResp, err := client.Do(emailReq)
			if err == nil {
				defer emailResp.Body.Close()
				var emails []struct {
					Email    string `json:"email"`
					Primary  bool   `json:"primary"`
					Verified bool   `json:"verified"`
				}
				if json.NewDecoder(emailResp.Body).Decode(&emails) == nil {
					for _, e := range emails {
						if e.Primary && e.Verified {
							email = e.Email
							break
						}
					}
				}
			}
		}
	}

	name := userInfo.Name
	if name == "" {
		name = userInfo.Login
	}

	return &OAuthUserInfo{
		ID:        fmt.Sprintf("%d", userInfo.ID),
		Email:     email,
		Name:      name,
		AvatarURL: userInfo.AvatarURL,
	}, nil
}

func (s *OAuthService) exchangeAppleCode(ctx context.Context, code, redirectURI string) (*OAuthUserInfo, error) {
	// Apple Sign In requires generating a client secret JWT
	// For now, return a placeholder - full implementation requires Apple-specific JWT signing
	// This would need the Apple private key file and proper JWT generation

	// Exchange code for token
	tokenURL := "https://appleid.apple.com/auth/token"
	data := url.Values{
		"client_id":     {s.config.AppleClientID},
		"client_secret": {s.config.AppleClientSecret}, // This should be a generated JWT
		"code":          {code},
		"grant_type":    {"authorization_code"},
		"redirect_uri":  {redirectURI},
	}

	resp, err := http.PostForm(tokenURL, data)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOAuthCodeExchange, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("%w: status %d, body: %s", ErrOAuthCodeExchange, resp.StatusCode, string(body))
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int    `json:"expires_in"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("%w: failed to decode token response: %v", ErrOAuthCodeExchange, err)
	}

	// Parse ID token to get user info (Apple includes user info in the JWT)
	// For simplicity, we'll decode the JWT payload without verification
	// In production, you should verify the JWT signature
	parts := strings.Split(tokenResp.IDToken, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("%w: invalid ID token format", ErrOAuthUserInfo)
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("%w: failed to decode ID token payload: %v", ErrOAuthUserInfo, err)
	}

	var claims struct {
		Sub   string `json:"sub"`
		Email string `json:"email"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("%w: failed to parse ID token claims: %v", ErrOAuthUserInfo, err)
	}

	return &OAuthUserInfo{
		ID:    claims.Sub,
		Email: claims.Email,
		Name:  "", // Apple doesn't always provide name in the token
	}, nil
}

func (s *OAuthService) exchangeFacebookCode(ctx context.Context, code, redirectURI string) (*OAuthUserInfo, error) {
	// Exchange code for token
	tokenURL := "https://graph.facebook.com/v18.0/oauth/access_token"
	params := url.Values{
		"client_id":     {s.config.FacebookClientID},
		"client_secret": {s.config.FacebookClientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
	}

	resp, err := http.Get(tokenURL + "?" + params.Encode())
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOAuthCodeExchange, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("%w: status %d, body: %s", ErrOAuthCodeExchange, resp.StatusCode, string(body))
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("%w: failed to decode token response: %v", ErrOAuthCodeExchange, err)
	}

	// Get user info from Facebook Graph API
	userURL := "https://graph.facebook.com/v18.0/me?fields=id,name,email,picture.type(large)"
	req, err := http.NewRequestWithContext(ctx, "GET", userURL, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOAuthUserInfo, err)
	}
	req.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)

	client := &http.Client{Timeout: 10 * time.Second}
	userResp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrOAuthUserInfo, err)
	}
	defer userResp.Body.Close()

	var userInfo struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Email   string `json:"email"`
		Picture struct {
			Data struct {
				URL string `json:"url"`
			} `json:"data"`
		} `json:"picture"`
	}
	if err := json.NewDecoder(userResp.Body).Decode(&userInfo); err != nil {
		return nil, fmt.Errorf("%w: failed to decode user info: %v", ErrOAuthUserInfo, err)
	}

	return &OAuthUserInfo{
		ID:        userInfo.ID,
		Email:     userInfo.Email,
		Name:      userInfo.Name,
		AvatarURL: userInfo.Picture.Data.URL,
	}, nil
}

// FindOrCreateUser finds an existing user by OAuth account or creates a new one
func (s *OAuthService) FindOrCreateUser(ctx context.Context, provider OAuthProvider, userInfo *OAuthUserInfo) (*models.User, error) {
	// First, check if we have an existing OAuth account
	var userID uuid.UUID
	err := s.db.QueryRowContext(ctx, `
		SELECT user_id FROM oauth_accounts
		WHERE provider = $1 AND provider_user_id = $2
	`, provider, userInfo.ID).Scan(&userID)

	if err == nil {
		// Found existing OAuth account, get the user
		var user models.User
		err = s.db.QueryRowContext(ctx, `
			SELECT id, username, email, display_name, wallet_address, avatar_url,
			       is_anonymous, created_at, updated_at, last_seen_at
			FROM users WHERE id = $1
		`, userID).Scan(
			&user.ID, &user.Username, &user.Email, &user.DisplayName,
			&user.WalletAddress, &user.AvatarURL, &user.IsAnonymous,
			&user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to get user: %w", err)
		}
		return &user, nil
	}

	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to check OAuth account: %w", err)
	}

	// Check if a user with this email already exists
	if userInfo.Email != "" {
		var existingUser models.User
		err = s.db.QueryRowContext(ctx, `
			SELECT id, username, email, display_name, wallet_address, avatar_url,
			       is_anonymous, created_at, updated_at, last_seen_at
			FROM users WHERE email = $1
		`, userInfo.Email).Scan(
			&existingUser.ID, &existingUser.Username, &existingUser.Email, &existingUser.DisplayName,
			&existingUser.WalletAddress, &existingUser.AvatarURL, &existingUser.IsAnonymous,
			&existingUser.CreatedAt, &existingUser.UpdatedAt, &existingUser.LastSeenAt,
		)
		if err == nil {
			// Link OAuth account to existing user
			_, err = s.db.ExecContext(ctx, `
				INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, email, name, avatar_url)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, uuid.New(), existingUser.ID, provider, userInfo.ID, userInfo.Email, userInfo.Name, userInfo.AvatarURL)
			if err != nil {
				return nil, fmt.Errorf("failed to link OAuth account: %w", err)
			}
			return &existingUser, nil
		}
		if err != sql.ErrNoRows {
			return nil, fmt.Errorf("failed to check existing user: %w", err)
		}
	}

	// Create new user
	username := generateUsername(userInfo.Name, string(provider))
	displayName := userInfo.Name
	if displayName == "" {
		displayName = username
	}

	user := &models.User{
		ID:          uuid.New(),
		Username:    username,
		DisplayName: displayName,
		IsAnonymous: false,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		LastSeenAt:  time.Now(),
	}
	if userInfo.Email != "" {
		user.Email = &userInfo.Email
	}
	if userInfo.AvatarURL != "" {
		user.AvatarURL = &userInfo.AvatarURL
	}

	// Start transaction
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Insert user
	_, err = tx.ExecContext(ctx, `
		INSERT INTO users (id, username, email, display_name, avatar_url, is_anonymous, created_at, updated_at, last_seen_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, user.ID, user.Username, user.Email, user.DisplayName, user.AvatarURL,
		user.IsAnonymous, user.CreatedAt, user.UpdatedAt, user.LastSeenAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Insert OAuth account
	_, err = tx.ExecContext(ctx, `
		INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, email, name, avatar_url)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, uuid.New(), user.ID, provider, userInfo.ID, userInfo.Email, userInfo.Name, userInfo.AvatarURL)
	if err != nil {
		return nil, fmt.Errorf("failed to create OAuth account: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return user, nil
}

// generateUsername creates a unique username from the user's name
func generateUsername(name, provider string) string {
	// Remove spaces and special characters, convert to lowercase
	base := strings.ToLower(strings.ReplaceAll(name, " ", "_"))
	if base == "" {
		base = provider
	}
	// Keep only alphanumeric and underscore
	var cleaned strings.Builder
	for _, r := range base {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			cleaned.WriteRune(r)
		}
	}
	result := cleaned.String()
	if result == "" {
		result = provider
	}

	// Add random suffix for uniqueness
	suffix := make([]byte, 4)
	rand.Read(suffix)
	return fmt.Sprintf("%s_%s", result, base64.URLEncoding.EncodeToString(suffix)[:6])
}
