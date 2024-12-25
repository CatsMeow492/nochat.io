package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	_ "github.com/lib/pq"
)

type UsersHandler struct {
	db *sql.DB
}

type User struct {
	ID            string `json:"id"`
	Email         string `json:"email,omitempty"`
	Name          string `json:"name"`
	WalletAddress string `json:"wallet_address,omitempty"`
}

type SignupRequest struct {
	Email         string `json:"email,omitempty"`
	Name          string `json:"name"`
	WalletAddress string `json:"wallet_address,omitempty"`
}

type EmailCheckResponse struct {
	Exists bool `json:"exists"`
}

type WalletCheckResponse struct {
	Exists bool `json:"exists"`
}

func NewUsersHandler(db *sql.DB) *UsersHandler {
	return &UsersHandler{db: db}
}

func (h *UsersHandler) Signup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SignupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Validate inputs
	if req.Email == "" && req.WalletAddress == "" {
		http.Error(w, "Either email or wallet address is required", http.StatusBadRequest)
		return
	}
	if req.Email != "" && !strings.Contains(req.Email, "@") {
		http.Error(w, "Invalid email", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	// Check if email or wallet already exists
	var exists bool
	if req.Email != "" {
		err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)", req.Email).Scan(&exists)
		if err != nil {
			log.Printf("Error checking email existence: %v", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
		if exists {
			http.Error(w, "Email already exists", http.StatusConflict)
			return
		}
	} else {
		err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE wallet_address = $1)", req.WalletAddress).Scan(&exists)
		if err != nil {
			log.Printf("Error checking wallet existence: %v", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
		if exists {
			http.Error(w, "Wallet address already exists", http.StatusConflict)
			return
		}
	}

	// Create the user
	var user User
	if req.Email != "" {
		err := h.db.QueryRow(`
			INSERT INTO users (email, name)
			VALUES ($1, $2)
			RETURNING id, email, name
		`, req.Email, req.Name).Scan(&user.ID, &user.Email, &user.Name)
		if err != nil {
			log.Printf("Error creating user: %v", err)
			http.Error(w, "Error creating user", http.StatusInternalServerError)
			return
		}
	} else {
		err := h.db.QueryRow(`
			INSERT INTO users (wallet_address, name)
			VALUES ($1, $2)
			RETURNING id, wallet_address, name
		`, req.WalletAddress, req.Name).Scan(&user.ID, &user.WalletAddress, &user.Name)
		if err != nil {
			log.Printf("Error creating user: %v", err)
			http.Error(w, "Error creating user", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(user)
}

func (h *UsersHandler) CheckEmail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	email := r.URL.Query().Get("email")
	if email == "" {
		http.Error(w, "Email parameter is required", http.StatusBadRequest)
		return
	}

	var exists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)", email).Scan(&exists)
	if err != nil {
		log.Printf("Error checking email existence: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(EmailCheckResponse{Exists: exists})
}

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
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE wallet_address = $1)", wallet).Scan(&exists)
	if err != nil {
		log.Printf("Error checking wallet existence: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(WalletCheckResponse{Exists: exists})
}

func (h *UsersHandler) GetUserByWallet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	wallet := r.URL.Query().Get("wallet")
	if wallet == "" {
		http.Error(w, "Wallet parameter is required", http.StatusBadRequest)
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
		log.Printf("Error getting user by wallet: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (h *UsersHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

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
		log.Printf("Error getting user: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

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
		log.Printf("Error getting user by email: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func main() {
	log.Printf("[DEBUG] Starting users service...")

	// Get database connection details from environment variables
	dbHost := os.Getenv("DB_HOST")
	dbName := os.Getenv("DB_NAME")
	dbUser := os.Getenv("DB_USER")
	dbPassword := os.Getenv("DB_PASSWORD")

	// Connect to the database
	connStr := fmt.Sprintf("host=%s dbname=%s user=%s password=%s sslmode=disable",
		dbHost, dbName, dbUser, dbPassword)

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		log.Fatalf("[ERROR] Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Test the connection
	if err := db.Ping(); err != nil {
		log.Fatalf("[ERROR] Failed to ping database: %v", err)
	}
	log.Printf("[DEBUG] Successfully connected to database")

	// Create handlers
	usersHandler := NewUsersHandler(db)

	// Add CORS middleware
	corsMiddleware := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next(w, r)
		}
	}

	// Register routes
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	http.HandleFunc("/api/users/signup", corsMiddleware(usersHandler.Signup))
	http.HandleFunc("/api/users/check-email", corsMiddleware(usersHandler.CheckEmail))
	http.HandleFunc("/api/users/check-wallet", corsMiddleware(usersHandler.CheckWallet))
	http.HandleFunc("/api/users/by-email", corsMiddleware(usersHandler.GetUserByEmail))
	http.HandleFunc("/api/users/by-wallet", corsMiddleware(usersHandler.GetUserByWallet))
	http.HandleFunc("/api/users/", corsMiddleware(usersHandler.GetUser))

	// Start the server
	port := "8083"
	log.Printf("[DEBUG] Starting server on :%s...", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("[ERROR] Failed to start server: %v", err)
	}
}
