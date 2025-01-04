package main

import (
	"log"
	"net/http"
	"os"

	"github.com/CatsMeow492/nochat.io/packages/server/pkg/handlers"
)

func main() {
	log.Printf("[DEBUG] Starting ICE service...")

	// Get Twilio credentials from environment variables
	accountSid := os.Getenv("TWILIO_ACCOUNT_SID")
	authToken := os.Getenv("TWILIO_AUTH_TOKEN")

	if accountSid == "" || authToken == "" {
		log.Fatal("[ERROR] Missing Twilio credentials. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN")
	}

	// Initialize ICE handler with credentials
	log.Printf("[DEBUG] Initializing ICE handler with account SID: %s", accountSid[:8]+"...")
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

	// ICE servers endpoint with CORS and logging
	mux.HandleFunc("/api/ice-servers", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[DEBUG] Handling ice-servers request from %s", r.RemoteAddr)
		if r.Method != http.MethodGet {
			log.Printf("[DEBUG] Method not allowed: %s", r.Method)
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		iceHandler.GetIceServers(w, r)
	}))

	// Log configuration details
	log.Printf("[INFO] Environment variables:")
	log.Printf("  - TWILIO_ACCOUNT_SID: %s...", accountSid[:8])
	log.Printf("[INFO] Registered endpoints:")
	log.Printf("  - /health")
	log.Printf("  - /api/ice-servers")

	// Start the server
	port := ":8081"
	log.Printf("[INFO] Starting server on %s...", port)
	if err := http.ListenAndServe(port, mux); err != nil {
		log.Fatalf("[ERROR] Failed to start server: %v", err)
	}
}
