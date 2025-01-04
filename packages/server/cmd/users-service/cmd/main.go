package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/CatsMeow492/nochat.io/packages/server/cmd/users-service/internal/auth"
	"github.com/CatsMeow492/nochat.io/packages/server/cmd/users-service/internal/handlers"
	_ "github.com/lib/pq"
)

// corsMiddleware adds CORS headers to responses
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowedOrigins := map[string]bool{
			"https://localhost:3000": true,
			"https://nochat.io":      true,
		}

		// Always set CORS headers
		if allowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "86400")

		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
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

	// Initialize services and handlers
	authService := auth.NewAuthService(db)
	authHandler := handlers.NewAuthHandler(authService)
	usersHandler := handlers.NewUsersHandler(db)

	// Health check endpoint
	http.HandleFunc("/health", handlers.HealthCheck)

	// Protected routes (require authentication)
	protectedMux := http.NewServeMux()
	protectedMux.HandleFunc("/api/users/by-email", usersHandler.GetUserByEmail)
	protectedMux.HandleFunc("/api/users/update-profile", usersHandler.UpdateProfile)
	protectedMux.HandleFunc("/api/users/", usersHandler.GetUser)

	// Public routes (no authentication required)
	http.HandleFunc("/api/users/signup", corsMiddleware(authHandler.Register))
	http.HandleFunc("/api/users/login", corsMiddleware(authHandler.Login))
	http.HandleFunc("/api/users/verify-email", corsMiddleware(authHandler.VerifyEmail))
	http.HandleFunc("/api/users/request-password-reset", corsMiddleware(authHandler.RequestPasswordReset))
	http.HandleFunc("/api/users/reset-password", corsMiddleware(authHandler.ResetPassword))
	http.HandleFunc("/api/users/logout", corsMiddleware(authHandler.Logout))
	http.HandleFunc("/api/users/check-wallet", corsMiddleware(usersHandler.CheckWallet))
	http.HandleFunc("/api/users/by-wallet", corsMiddleware(usersHandler.GetUserByWallet))

	// Apply authentication middleware to protected routes
	http.Handle("/api/users/by-", corsMiddleware(authHandler.AuthMiddleware(protectedMux).ServeHTTP))
	http.Handle("/api/users/check-", corsMiddleware(authHandler.AuthMiddleware(protectedMux).ServeHTTP))

	// Start the server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}

	log.Printf("[INFO] Starting server on port %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("[ERROR] Failed to start server: %v", err)
	}
}
