package main

import (
	"log"
	"net/http"
	"os"

	"gitlab.com/secp/services/backend/pkg/handlers"
)

func main() {
	log.Printf("[DEBUG] Starting ICE service...")

	// Initialize ICE handler
	accountSid := os.Getenv("TWILIO_ACCOUNT_SID")
	authToken := os.Getenv("TWILIO_AUTH_TOKEN")

	log.Printf("[DEBUG] Initializing ICE handler with account SID: %s", accountSid)
	iceHandler := handlers.NewIceHandler(accountSid, authToken)

	// Create a new router
	mux := http.NewServeMux()

	// Add CORS middleware
	corsMiddleware := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			log.Printf("[DEBUG] Received request: %s %s", r.Method, r.URL.Path)
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next(w, r)
		}
	}

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[DEBUG] Health check request received")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// ICE servers endpoint
	mux.HandleFunc("/api/ice-servers", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[DEBUG] Handling ice-servers request from %s", r.RemoteAddr)
		if r.Method != http.MethodGet {
			log.Printf("[DEBUG] Method not allowed: %s", r.Method)
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		iceHandler.GetIceServers(w, r)
	}))

	log.Printf("[DEBUG] Environment variables: TWILIO_ACCOUNT_SID=%s", accountSid)
	log.Printf("[DEBUG] Registered endpoints: /health, /api/ice-servers")
	log.Printf("[DEBUG] Starting server on :8081...")
	if err := http.ListenAndServe(":8081", mux); err != nil {
		log.Fatalf("[ERROR] Failed to start server: %v", err)
	}
}
