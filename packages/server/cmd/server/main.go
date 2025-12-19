package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"gitlab.com/secp/services/backend/internal/auth"
	"gitlab.com/secp/services/backend/internal/crypto"
	"gitlab.com/secp/services/backend/internal/db"
	"gitlab.com/secp/services/backend/internal/messaging"
	"gitlab.com/secp/services/backend/internal/models"
	"gitlab.com/secp/services/backend/internal/signaling"
	"gitlab.com/secp/services/backend/internal/storage"
	"gitlab.com/secp/services/backend/pkg/handlers"
)

var (
	upgrader = websocket.Upgrader{
		ReadBufferSize:  128 * 1024,
		WriteBufferSize: 128 * 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow all origins (configure appropriately for production)
		},
	}
)

type Server struct {
	db               *db.DB
	authService      *auth.Service
	signalingService *signaling.Service
	messagingService *messaging.Service
	storageService   *storage.Service
	cryptoService    *crypto.Service
	iceHandler       *handlers.IceHandler
}

func main() {
	log.Println("[Server] Starting nochat.io monolith...")

	// Initialize database
	database, err := db.NewDB()
	if err != nil {
		log.Fatalf("[Server] Failed to connect to database: %v", err)
	}
	defer database.Close()

	// Run migrations
	if err := database.RunMigrations("migrations"); err != nil {
		log.Fatalf("[Server] Failed to run migrations: %v", err)
	}

	// Initialize services
	authService := auth.NewService(database.Postgres)
	signalingService := signaling.NewService(database.Redis)
	messagingService := messaging.NewService(database.Postgres, database.Redis)
	storageService, err := storage.NewService(database.Postgres)
	if err != nil {
		log.Printf("[WARN] Failed to initialize storage service: %v (file uploads disabled)", err)
		storageService = nil
	}
	cryptoService := crypto.NewService(database.Postgres)

	// Initialize ICE handler (Twilio)
	accountSid := os.Getenv("TWILIO_ACCOUNT_SID")
	authToken := os.Getenv("TWILIO_AUTH_TOKEN")
	iceHandler := handlers.NewIceHandler(accountSid, authToken)

	server := &Server{
		db:               database,
		authService:      authService,
		signalingService: signalingService,
		messagingService: messagingService,
		storageService:   storageService,
		cryptoService:    cryptoService,
		iceHandler:       iceHandler,
	}

	// Setup router
	router := server.setupRouter()

	// Start HTTP server
	httpServer := &http.Server{
		Addr:         ":8080",
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Printf("[Server] HTTP server listening on %s", httpServer.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Server] Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[Server] Shutting down server...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Fatalf("[Server] Server forced to shutdown: %v", err)
	}

	log.Println("[Server] Server exited gracefully")
}

func (s *Server) setupRouter() *mux.Router {
	router := mux.NewRouter()

	// CORS middleware
	router.Use(corsMiddleware)

	// Handle OPTIONS preflight requests for all routes
	router.Methods("OPTIONS").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Health check
	router.HandleFunc("/health", s.handleHealth).Methods("GET")

	// Auth routes
	router.HandleFunc("/api/auth/signup", s.handleSignup).Methods("POST")
	router.HandleFunc("/api/auth/signin", s.handleSignin).Methods("POST")
	router.HandleFunc("/api/auth/anonymous", s.handleAnonymous).Methods("POST")
	router.HandleFunc("/api/auth/wallet", s.handleWalletAuth).Methods("POST")

	// User routes (protected)
	router.HandleFunc("/api/users/me", s.authMiddleware(s.handleGetCurrentUser)).Methods("GET")
	router.HandleFunc("/api/users/{id}", s.authMiddleware(s.handleGetUser)).Methods("GET")

	// ICE servers (for WebRTC)
	router.HandleFunc("/api/ice-servers", s.handleICEServers).Methods("GET")

	// Signaling WebSocket (for WebRTC calls)
	router.HandleFunc("/api/signaling", s.handleSignalingWebSocket).Methods("GET")

	// Messaging routes (protected)
	router.HandleFunc("/api/conversations", s.authMiddleware(s.handleCreateConversation)).Methods("POST")
	router.HandleFunc("/api/conversations", s.authMiddleware(s.handleGetConversations)).Methods("GET")
	router.HandleFunc("/api/conversations/{id}/messages", s.authMiddleware(s.handleGetMessages)).Methods("GET")
	router.HandleFunc("/api/conversations/{id}/messages", s.authMiddleware(s.handleSendMessage)).Methods("POST")

	// Storage routes (protected)
	router.HandleFunc("/api/storage/upload", s.authMiddleware(s.handleRequestUpload)).Methods("POST")
	router.HandleFunc("/api/storage/download", s.authMiddleware(s.handleRequestDownload)).Methods("POST")
	router.HandleFunc("/api/storage/attachments/{id}", s.authMiddleware(s.handleGetAttachment)).Methods("GET")

	// Contacts routes (protected)
	router.HandleFunc("/api/contacts", s.authMiddleware(s.handleGetContacts)).Methods("GET")
	router.HandleFunc("/api/contacts", s.authMiddleware(s.handleAddContact)).Methods("POST")

	// Crypto/E2EE routes (protected)
	router.HandleFunc("/api/crypto/keys/identity", s.authMiddleware(s.handleUploadIdentityKey)).Methods("POST")
	router.HandleFunc("/api/crypto/keys/identity", s.authMiddleware(s.handleGetMyIdentityKey)).Methods("GET")
	router.HandleFunc("/api/crypto/keys/prekey", s.authMiddleware(s.handleUploadSignedPreKey)).Methods("POST")
	router.HandleFunc("/api/crypto/keys/prekeys", s.authMiddleware(s.handleUploadOneTimePreKeys)).Methods("POST")
	router.HandleFunc("/api/crypto/keys/prekeys/count", s.authMiddleware(s.handleGetPreKeyCount)).Methods("GET")
	router.HandleFunc("/api/crypto/bundles/{user_id}", s.authMiddleware(s.handleGetPreKeyBundle)).Methods("GET")
	router.HandleFunc("/api/crypto/keys/status", s.authMiddleware(s.handleGetKeyStatus)).Methods("GET")

	return router
}

// Middleware

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Authorization header required", http.StatusUnauthorized)
			return
		}

		// Extract token (format: "Bearer <token>")
		token := authHeader
		if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			token = authHeader[7:]
		}

		// Validate token and get user ID
		userID, err := s.authService.ValidateSessionToken(token)
		if err != nil {
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}

		// Add user ID to context
		ctx := context.WithValue(r.Context(), "userID", userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

// Handlers

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	if err := s.db.Health(ctx); err != nil {
		http.Error(w, "Database unhealthy", http.StatusServiceUnavailable)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// Auth Handlers

func (s *Server) handleSignup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	user, err := s.authService.CreateUser(r.Context(), req.Username, req.Email, req.Password)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create user: %v", err), http.StatusInternalServerError)
		return
	}

	token, err := s.authService.GenerateSessionToken(user.ID)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"user":  user,
		"token": token,
	})
}

func (s *Server) handleSignin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	user, err := s.authService.AuthenticateByEmail(r.Context(), req.Email, req.Password)
	if err != nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	token, err := s.authService.GenerateSessionToken(user.ID)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"user":  user,
		"token": token,
	})
}

func (s *Server) handleAnonymous(w http.ResponseWriter, r *http.Request) {
	user, err := s.authService.CreateAnonymousUser(r.Context())
	if err != nil {
		http.Error(w, "Failed to create anonymous user", http.StatusInternalServerError)
		return
	}

	token, err := s.authService.GenerateSessionToken(user.ID)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"user":  user,
		"token": token,
	})
}

func (s *Server) handleWalletAuth(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WalletAddress string `json:"wallet_address"`
		Signature     string `json:"signature"` // TODO: Verify signature
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Check if user already exists
	user, err := s.authService.GetUserByWallet(r.Context(), req.WalletAddress)
	if err != nil {
		// Create new wallet user
		user, err = s.authService.CreateWalletUser(r.Context(), req.WalletAddress)
		if err != nil {
			http.Error(w, "Failed to create user", http.StatusInternalServerError)
			return
		}
	}

	token, err := s.authService.GenerateSessionToken(user.ID)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"user":  user,
		"token": token,
	})
}

func (s *Server) handleGetCurrentUser(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	user, err := s.authService.GetUserByID(r.Context(), userID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"user": user,
	})
}

func (s *Server) handleGetUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	user, err := s.authService.GetUserByID(r.Context(), userID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(user)
}

// ICE Servers Handler

func (s *Server) handleICEServers(w http.ResponseWriter, r *http.Request) {
	s.iceHandler.GetIceServers(w, r)
}

// Signaling WebSocket Handler

func (s *Server) handleSignalingWebSocket(w http.ResponseWriter, r *http.Request) {
	// Get user_id and room_id from query params
	userIDStr := r.URL.Query().Get("user_id")
	roomID := r.URL.Query().Get("room_id")

	if userIDStr == "" || roomID == "" {
		http.Error(w, "user_id and room_id required", http.StatusBadRequest)
		return
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		http.Error(w, "Invalid user_id", http.StatusBadRequest)
		return
	}

	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Server] Failed to upgrade to WebSocket: %v", err)
		return
	}

	// Add client to signaling service
	client := s.signalingService.AddClient(roomID, userID, conn)

	// Start read/write pumps
	go s.signalingService.WritePump(client)
	go s.signalingService.ReadPump(client)
}

// Messaging Handlers

func (s *Server) handleCreateConversation(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		Type        string `json:"type"` // direct, group, channel
		Name        string `json:"name"`
		Description string `json:"description"`
		Participants []string `json:"participants"` // User IDs to add
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	conv, err := s.messagingService.CreateConversation(r.Context(), req.Type, req.Name, req.Description, userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create conversation: %v", err), http.StatusInternalServerError)
		return
	}

	// Add participants
	for _, pIDStr := range req.Participants {
		pID, err := uuid.Parse(pIDStr)
		if err != nil {
			continue
		}
		s.messagingService.AddParticipant(r.Context(), conv.ID, pID, "member")
	}

	json.NewEncoder(w).Encode(conv)
}

func (s *Server) handleGetConversations(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	conversations, err := s.messagingService.GetUserConversations(r.Context(), userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get conversations: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"conversations": conversations,
	})
}

func (s *Server) handleGetMessages(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	convID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid conversation ID", http.StatusBadRequest)
		return
	}

	messages, err := s.messagingService.GetMessages(r.Context(), convID, 50, 0)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get messages: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"messages": messages,
	})
}

func (s *Server) handleSendMessage(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)
	vars := mux.Vars(r)
	convID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid conversation ID", http.StatusBadRequest)
		return
	}

	var req struct {
		EncryptedContent string  `json:"encrypted_content"` // Base64 encoded
		MessageType      string  `json:"message_type"`
		ReplyToID        *string `json:"reply_to_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	var replyToID *uuid.UUID
	if req.ReplyToID != nil {
		id, err := uuid.Parse(*req.ReplyToID)
		if err == nil {
			replyToID = &id
		}
	}

	message, err := s.messagingService.CreateMessage(r.Context(), convID, userID, []byte(req.EncryptedContent), req.MessageType, replyToID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to send message: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(message)
}

// Storage Handlers

func (s *Server) handleRequestUpload(w http.ResponseWriter, r *http.Request) {
	var req models.UploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	resp, err := s.storageService.GenerateUploadURL(r.Context(), req)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate upload URL: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleRequestDownload(w http.ResponseWriter, r *http.Request) {
	var req models.DownloadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	resp, err := s.storageService.GenerateDownloadURL(r.Context(), req.StorageKey)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate download URL: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleGetAttachment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	attID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid attachment ID", http.StatusBadRequest)
		return
	}

	attachment, err := s.storageService.GetAttachment(r.Context(), attID)
	if err != nil {
		http.Error(w, "Attachment not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(attachment)
}

// Contacts Handlers (placeholder)

func (s *Server) handleGetContacts(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement contacts listing
	json.NewEncoder(w).Encode([]interface{}{})
}

func (s *Server) handleAddContact(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement add contact
	w.WriteHeader(http.StatusNotImplemented)
}

// Crypto Handlers - PQC Key Management for E2EE

// handleUploadIdentityKey uploads a user's Dilithium identity public key
func (s *Server) handleUploadIdentityKey(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		PublicKey string `json:"public_key"` // Base64 encoded Dilithium3 public key
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Decode base64 public key
	publicKey, err := base64Decode(req.PublicKey)
	if err != nil {
		http.Error(w, "Invalid base64 encoding for public key", http.StatusBadRequest)
		return
	}

	// Validate key size
	if len(publicKey) != crypto.Dilithium3PublicKeySize {
		http.Error(w, fmt.Sprintf("Invalid public key size: expected %d, got %d", crypto.Dilithium3PublicKeySize, len(publicKey)), http.StatusBadRequest)
		return
	}

	// Store the identity key
	key, err := s.cryptoService.StoreIdentityKey(r.Context(), userID, publicKey)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to store identity key: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":              key.ID,
		"fingerprint":     key.KeyFingerprint,
		"version":         key.KeyVersion,
		"created_at":      key.CreatedAt,
	})
}

// handleGetMyIdentityKey retrieves the current user's identity key
func (s *Server) handleGetMyIdentityKey(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	key, err := s.cryptoService.GetIdentityKey(r.Context(), userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get identity key: %v", err), http.StatusInternalServerError)
		return
	}

	if key == nil {
		http.Error(w, "No identity key found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":              key.ID,
		"public_key":      base64Encode(key.PublicKey),
		"fingerprint":     key.KeyFingerprint,
		"version":         key.KeyVersion,
		"created_at":      key.CreatedAt,
	})
}

// handleUploadSignedPreKey uploads a user's signed Kyber prekey
func (s *Server) handleUploadSignedPreKey(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		KeyID          int    `json:"key_id"`
		KyberPublicKey string `json:"kyber_public_key"` // Base64 encoded
		Signature      string `json:"signature"`        // Base64 encoded Dilithium signature
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	kyberPublicKey, err := base64Decode(req.KyberPublicKey)
	if err != nil {
		http.Error(w, "Invalid base64 encoding for Kyber public key", http.StatusBadRequest)
		return
	}

	signature, err := base64Decode(req.Signature)
	if err != nil {
		http.Error(w, "Invalid base64 encoding for signature", http.StatusBadRequest)
		return
	}

	// Verify the signature against the user's identity key
	identityKey, err := s.cryptoService.GetIdentityKey(r.Context(), userID)
	if err != nil || identityKey == nil {
		http.Error(w, "Must upload identity key before signed prekey", http.StatusBadRequest)
		return
	}

	valid, err := crypto.Verify(identityKey.PublicKey, kyberPublicKey, signature)
	if err != nil || !valid {
		http.Error(w, "Invalid signature - prekey must be signed by identity key", http.StatusBadRequest)
		return
	}

	// Store the signed prekey
	prekey, err := s.cryptoService.StoreSignedPreKey(r.Context(), userID, req.KeyID, kyberPublicKey, signature)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to store signed prekey: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":          prekey.ID,
		"key_id":      prekey.KeyID,
		"fingerprint": prekey.KeyFingerprint,
		"expires_at":  prekey.ExpiresAt,
		"created_at":  prekey.CreatedAt,
	})
}

// handleUploadOneTimePreKeys uploads a batch of one-time prekeys
func (s *Server) handleUploadOneTimePreKeys(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		PreKeys []struct {
			KeyID          int    `json:"key_id"`
			KyberPublicKey string `json:"kyber_public_key"` // Base64 encoded
		} `json:"prekeys"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.PreKeys) == 0 {
		http.Error(w, "No prekeys provided", http.StatusBadRequest)
		return
	}

	if len(req.PreKeys) > 100 {
		http.Error(w, "Maximum 100 prekeys per upload", http.StatusBadRequest)
		return
	}

	// Convert to internal format
	prekeys := make([]crypto.OneTimePreKeyInput, len(req.PreKeys))
	for i, pk := range req.PreKeys {
		kyberPublicKey, err := base64Decode(pk.KyberPublicKey)
		if err != nil {
			http.Error(w, fmt.Sprintf("Invalid base64 encoding for prekey %d", pk.KeyID), http.StatusBadRequest)
			return
		}

		if len(kyberPublicKey) != crypto.Kyber1024PublicKeySize {
			http.Error(w, fmt.Sprintf("Invalid Kyber public key size for prekey %d", pk.KeyID), http.StatusBadRequest)
			return
		}

		prekeys[i] = crypto.OneTimePreKeyInput{
			KeyID:          pk.KeyID,
			KyberPublicKey: kyberPublicKey,
		}
	}

	// Store the prekeys
	if err := s.cryptoService.StoreOneTimePreKeys(r.Context(), userID, prekeys); err != nil {
		http.Error(w, fmt.Sprintf("Failed to store one-time prekeys: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"stored": len(prekeys),
	})
}

// handleGetPreKeyCount returns the count of available one-time prekeys
func (s *Server) handleGetPreKeyCount(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	count, err := s.cryptoService.GetAvailableOneTimePreKeyCount(r.Context(), userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get prekey count: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"count": count,
	})
}

// handleGetPreKeyBundle retrieves a user's prekey bundle for key exchange
func (s *Server) handleGetPreKeyBundle(w http.ResponseWriter, r *http.Request) {
	requestingUserID := r.Context().Value("userID").(uuid.UUID)
	vars := mux.Vars(r)

	targetUserID, err := uuid.Parse(vars["user_id"])
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	// Get the prekey bundle (this will atomically claim a one-time prekey if available)
	bundle, err := s.cryptoService.GetPreKeyBundle(r.Context(), targetUserID, requestingUserID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get prekey bundle: %v", err), http.StatusNotFound)
		return
	}

	// Serialize the bundle for response
	response := map[string]interface{}{
		"user_id":        bundle.UserID,
		"bundle_version": bundle.BundleVersion,
		"generated_at":   bundle.GeneratedAt,
		"identity_key": map[string]interface{}{
			"public_key":  base64Encode(bundle.IdentityKey.PublicKey),
			"fingerprint": bundle.IdentityKey.KeyFingerprint,
			"version":     bundle.IdentityKey.KeyVersion,
		},
		"signed_prekey": map[string]interface{}{
			"key_id":           bundle.SignedPreKey.KeyID,
			"kyber_public_key": base64Encode(bundle.SignedPreKey.KyberPublicKey),
			"signature":        base64Encode(bundle.SignedPreKey.Signature),
			"fingerprint":      bundle.SignedPreKey.KeyFingerprint,
		},
	}

	// Include one-time prekey if available
	if bundle.OneTimePreKey != nil {
		response["one_time_prekey"] = map[string]interface{}{
			"id":               bundle.OneTimePreKey.ID,
			"key_id":           bundle.OneTimePreKey.KeyID,
			"kyber_public_key": base64Encode(bundle.OneTimePreKey.KyberPublicKey),
		}
	}

	json.NewEncoder(w).Encode(response)
}

// handleGetKeyStatus returns the E2EE key status for the current user
func (s *Server) handleGetKeyStatus(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	identityKey, _ := s.cryptoService.GetIdentityKey(r.Context(), userID)
	signedPreKey, _ := s.cryptoService.GetSignedPreKey(r.Context(), userID)
	otkCount, _ := s.cryptoService.GetAvailableOneTimePreKeyCount(r.Context(), userID)

	hasIdentityKey := identityKey != nil
	hasSignedPreKey := signedPreKey != nil
	hasOneTimePreKeys := otkCount > 0

	// Determine if E2EE is fully set up
	e2eeReady := hasIdentityKey && hasSignedPreKey && hasOneTimePreKeys

	response := map[string]interface{}{
		"e2ee_ready":         e2eeReady,
		"has_identity_key":   hasIdentityKey,
		"has_signed_prekey":  hasSignedPreKey,
		"one_time_prekey_count": otkCount,
	}

	if identityKey != nil {
		response["identity_key_fingerprint"] = identityKey.KeyFingerprint
		response["identity_key_version"] = identityKey.KeyVersion
	}

	if signedPreKey != nil {
		response["signed_prekey_id"] = signedPreKey.KeyID
		response["signed_prekey_expires_at"] = signedPreKey.ExpiresAt
	}

	json.NewEncoder(w).Encode(response)
}

// Helper functions for base64 encoding/decoding
func base64Encode(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

func base64Decode(s string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(s)
}
