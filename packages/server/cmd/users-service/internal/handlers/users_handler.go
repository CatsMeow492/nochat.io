package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

type User struct {
	ID            string `json:"id"`
	Email         string `json:"email,omitempty"`
	Name          string `json:"name"`
	WalletAddress string `json:"wallet_address,omitempty"`
}

type UsersHandler struct {
	db *sql.DB
}

func NewUsersHandler(db *sql.DB) *UsersHandler {
	return &UsersHandler{db: db}
}

// GetUser retrieves a user by ID
func (h *UsersHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract user ID from path
	userID := strings.TrimPrefix(r.URL.Path, "/api/users/")
	if userID == "" {
		http.Error(w, "User ID is required", http.StatusBadRequest)
		return
	}

	var user User
	err := h.db.QueryRow(`
		SELECT id, COALESCE(email, '') as email, name, COALESCE(wallet_address, '') as wallet_address
		FROM users
		WHERE id = $1
	`, userID).Scan(&user.ID, &user.Email, &user.Name, &user.WalletAddress)

	if err == sql.ErrNoRows {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// GetUserByEmail retrieves a user by email
func (h *UsersHandler) GetUserByEmail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	email := r.URL.Query().Get("email")
	if email == "" {
		http.Error(w, "Email parameter is required", http.StatusBadRequest)
		return
	}

	var user User
	err := h.db.QueryRow(`
		SELECT id, email, name
		FROM users
		WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.Name)

	if err == sql.ErrNoRows {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// GetUserByWallet retrieves a user by wallet address
func (h *UsersHandler) GetUserByWallet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var wallet string
	if r.Method == http.MethodGet {
		wallet = r.URL.Query().Get("wallet")
	} else {
		// Parse JSON body for POST requests
		var body struct {
			WalletAddress string `json:"walletAddress"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		wallet = body.WalletAddress
	}

	if wallet == "" {
		http.Error(w, "Wallet address is required", http.StatusBadRequest)
		return
	}

	var user User
	err := h.db.QueryRow(`
		SELECT id, wallet_address, name
		FROM users
		WHERE wallet_address = $1
	`, wallet).Scan(&user.ID, &user.WalletAddress, &user.Name)

	if err == sql.ErrNoRows {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// CheckWallet checks if a wallet address exists
func (h *UsersHandler) CheckWallet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	wallet := r.URL.Query().Get("wallet")
	if wallet == "" {
		http.Error(w, "Wallet parameter is required", http.StatusBadRequest)
		return
	}

	var exists bool
	err := h.db.QueryRow(`
		SELECT EXISTS(SELECT 1 FROM users WHERE wallet_address = $1)
	`, wallet).Scan(&exists)

	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"exists": exists})
}

// UpdateProfile updates a user's profile information
func (h *UsersHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get user ID from context (set by auth middleware)
	userID, ok := r.Context().Value("userID").(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse request body
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate name
	if body.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	// Start a transaction
	tx, err := h.db.Begin()
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Update user
	var user User
	if body.Email != "" {
		// If email is being updated, check if it's already in use
		var exists bool
		err = tx.QueryRow(`
			SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 AND id != $2)
		`, body.Email, userID).Scan(&exists)
		if err != nil {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
		if exists {
			http.Error(w, "Email already in use", http.StatusConflict)
			return
		}

		// Update name and email
		err = tx.QueryRow(`
			UPDATE users
			SET name = $1, email = $2
			WHERE id = $3
			RETURNING id, COALESCE(email, '') as email, name, COALESCE(wallet_address, '') as wallet_address
		`, body.Name, body.Email, userID).Scan(&user.ID, &user.Email, &user.Name, &user.WalletAddress)
	} else {
		// Update name only
		err = tx.QueryRow(`
			UPDATE users
			SET name = $1
			WHERE id = $2
			RETURNING id, COALESCE(email, '') as email, name, COALESCE(wallet_address, '') as wallet_address
		`, body.Name, userID).Scan(&user.ID, &user.Email, &user.Name, &user.WalletAddress)
	}

	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}
