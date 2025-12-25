package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"gitlab.com/secp/services/backend/internal/auth"
	"gitlab.com/secp/services/backend/internal/contacts"
	"gitlab.com/secp/services/backend/internal/crypto"
	"gitlab.com/secp/services/backend/internal/db"
	"gitlab.com/secp/services/backend/internal/discovery"
	"gitlab.com/secp/services/backend/internal/messaging"
	"gitlab.com/secp/services/backend/internal/models"
	"gitlab.com/secp/services/backend/internal/ratelimit"
	"gitlab.com/secp/services/backend/internal/signaling"
	"gitlab.com/secp/services/backend/internal/storage"
	"gitlab.com/secp/services/backend/internal/transparency"
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
	db                   *db.DB
	authService          *auth.Service
	oauthService         *auth.OAuthService
	signalingService     *signaling.Service
	messagingService     *messaging.Service
	storageService       *storage.Service
	cryptoService        *crypto.Service
	transparencyService  *transparency.Service
	contactsService      *contacts.Service
	discoveryService     *discovery.Service
	rateLimiter          *ratelimit.Limiter
	iceHandler           *handlers.IceHandler
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

	// Initialize OAuth service
	oauthConfig := auth.OAuthConfig{
		GoogleClientID:       os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:   os.Getenv("GOOGLE_CLIENT_SECRET"),
		GitHubClientID:       os.Getenv("GITHUB_CLIENT_ID"),
		GitHubClientSecret:   os.Getenv("GITHUB_CLIENT_SECRET"),
		AppleClientID:        os.Getenv("APPLE_CLIENT_ID"),
		AppleClientSecret:    os.Getenv("APPLE_CLIENT_SECRET"),
		AppleTeamID:          os.Getenv("APPLE_TEAM_ID"),
		AppleKeyID:           os.Getenv("APPLE_KEY_ID"),
		FacebookClientID:     os.Getenv("FACEBOOK_CLIENT_ID"),
		FacebookClientSecret: os.Getenv("FACEBOOK_CLIENT_SECRET"),
		RedirectBaseURL:      getEnvOrDefault("OAUTH_REDIRECT_BASE_URL", "http://localhost:8080"),
		FrontendURL:          getEnvOrDefault("FRONTEND_URL", "http://localhost:3000"),
	}
	oauthService := auth.NewOAuthService(database.Postgres, oauthConfig)
	signalingService := signaling.NewService(database.Redis)
	messagingService := messaging.NewService(database.Postgres, database.Redis)
	storageService, err := storage.NewService(database.Postgres)
	if err != nil {
		log.Printf("[WARN] Failed to initialize storage service: %v (file uploads disabled)", err)
		storageService = nil
	}
	cryptoService := crypto.NewService(database.Postgres)
	contactsService := contacts.NewService(database.Postgres)
	discoveryService := discovery.NewService(database.Postgres)

	// Initialize transparency service (for key transparency / auditable key directory)
	transparencyService, err := transparency.NewService(database.Postgres, database.Redis)
	if err != nil {
		log.Printf("[WARN] Failed to initialize transparency service: %v (key transparency disabled)", err)
		transparencyService = nil
	}

	// Wire up transparency service to crypto service
	if transparencyService != nil {
		cryptoService.SetTransparencyService(&transparencyQueuerAdapter{transparencyService})
	}

	// Initialize rate limiter
	rateLimiter := ratelimit.NewLimiter(database.Redis)

	// Initialize ICE handler (Twilio)
	accountSid := os.Getenv("TWILIO_ACCOUNT_SID")
	authToken := os.Getenv("TWILIO_AUTH_TOKEN")
	iceHandler := handlers.NewIceHandler(accountSid, authToken)

	server := &Server{
		db:                   database,
		authService:          authService,
		oauthService:         oauthService,
		signalingService:     signalingService,
		messagingService:     messagingService,
		storageService:       storageService,
		cryptoService:        cryptoService,
		transparencyService:  transparencyService,
		contactsService:      contactsService,
		discoveryService:     discoveryService,
		rateLimiter:          rateLimiter,
		iceHandler:           iceHandler,
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

	// OAuth routes
	router.HandleFunc("/api/auth/oauth/{provider}", s.handleOAuthInitiate).Methods("GET")
	router.HandleFunc("/api/auth/oauth/{provider}/callback", s.handleOAuthCallback).Methods("GET", "POST")

	// Phone auth routes (passwordless SMS OTP)
	router.HandleFunc("/api/auth/phone/send-code", s.handlePhoneAuthSendCode).Methods("POST")
	router.HandleFunc("/api/auth/phone/verify", s.handlePhoneAuthVerify).Methods("POST")

	// User routes (protected)
	router.HandleFunc("/api/users/me", s.authMiddleware(s.handleGetCurrentUser)).Methods("GET")
	router.HandleFunc("/api/users/search", s.authMiddleware(s.handleSearchUsers)).Methods("GET")
	router.HandleFunc("/api/users/{id}", s.authMiddleware(s.handleGetUser)).Methods("GET")

	// ICE servers (for WebRTC)
	router.HandleFunc("/api/ice-servers", s.handleICEServers).Methods("GET")

	// Signaling WebSocket (for WebRTC calls)
	router.HandleFunc("/api/signaling", s.handleSignalingWebSocket).Methods("GET")

	// Messaging routes (protected)
	router.HandleFunc("/api/conversations", s.authMiddleware(s.handleCreateConversation)).Methods("POST")
	router.HandleFunc("/api/conversations", s.authMiddleware(s.handleGetConversations)).Methods("GET")
	router.HandleFunc("/api/conversations/{id}", s.authMiddleware(s.handleDeleteConversation)).Methods("DELETE")
	router.HandleFunc("/api/conversations/{id}/participants", s.authMiddleware(s.handleGetParticipants)).Methods("GET")
	router.HandleFunc("/api/conversations/{id}/messages", s.authMiddleware(s.handleGetMessages)).Methods("GET")
	router.HandleFunc("/api/conversations/{id}/messages", s.authMiddleware(s.handleSendMessage)).Methods("POST")

	// Storage routes (protected)
	router.HandleFunc("/api/storage/upload", s.authMiddleware(s.handleRequestUpload)).Methods("POST")
	router.HandleFunc("/api/storage/download", s.authMiddleware(s.handleRequestDownload)).Methods("POST")
	router.HandleFunc("/api/storage/attachments/{id}", s.authMiddleware(s.handleGetAttachment)).Methods("GET")

	// Contacts routes (protected)
	router.HandleFunc("/api/contacts", s.authMiddleware(s.handleGetContacts)).Methods("GET")
	router.HandleFunc("/api/contacts", s.authMiddleware(s.handleSendContactRequest)).Methods("POST")
	router.HandleFunc("/api/contacts/pending", s.authMiddleware(s.handleGetPendingRequests)).Methods("GET")
	router.HandleFunc("/api/contacts/pending/count", s.authMiddleware(s.handleGetPendingCount)).Methods("GET")
	router.HandleFunc("/api/contacts/{id}", s.authMiddleware(s.handleUpdateContact)).Methods("PUT")
	router.HandleFunc("/api/contacts/{id}", s.authMiddleware(s.handleDeleteContact)).Methods("DELETE")

	// Invite routes (protected except for public info)
	router.HandleFunc("/api/contacts/invites", s.authMiddleware(s.handleCreateInvite)).Methods("POST")
	router.HandleFunc("/api/contacts/invites", s.authMiddleware(s.handleGetUserInvites)).Methods("GET")
	router.HandleFunc("/api/contacts/invites/{id}", s.authMiddleware(s.handleDeactivateInvite)).Methods("DELETE")
	router.HandleFunc("/api/contacts/invite/{code}", s.handleGetInviteInfo).Methods("GET") // Public endpoint
	router.HandleFunc("/api/contacts/invite/{code}/accept", s.authMiddleware(s.handleAcceptInvite)).Methods("POST")

	// User settings routes (protected)
	router.HandleFunc("/api/users/settings", s.authMiddleware(s.handleGetUserSettings)).Methods("GET")
	router.HandleFunc("/api/users/settings", s.authMiddleware(s.handleUpdateUserSettings)).Methods("PUT")

	// Phone verification routes (protected)
	router.HandleFunc("/api/phone/send-code", s.authMiddleware(s.handleSendPhoneCode)).Methods("POST")
	router.HandleFunc("/api/phone/verify", s.authMiddleware(s.handleVerifyPhoneCode)).Methods("POST")
	router.HandleFunc("/api/phone", s.authMiddleware(s.handleRemovePhone)).Methods("DELETE")
	router.HandleFunc("/api/phone/status", s.authMiddleware(s.handleGetPhoneStatus)).Methods("GET")

	// Contact discovery routes (protected)
	router.HandleFunc("/api/contacts/sync", s.authMiddleware(s.handleSyncContacts)).Methods("POST")
	router.HandleFunc("/api/contacts/discovered", s.authMiddleware(s.handleGetDiscoveredContacts)).Methods("GET")
	router.HandleFunc("/api/contacts/hashes", s.authMiddleware(s.handleClearContactHashes)).Methods("DELETE")
	router.HandleFunc("/api/notifications/discovery", s.authMiddleware(s.handleGetDiscoveryNotifications)).Methods("GET")
	router.HandleFunc("/api/notifications/discovery/read", s.authMiddleware(s.handleMarkDiscoveryRead)).Methods("POST")

	// Crypto/E2EE routes (protected)
	router.HandleFunc("/api/crypto/keys/identity", s.authMiddleware(s.handleUploadIdentityKey)).Methods("POST")
	router.HandleFunc("/api/crypto/keys/identity", s.authMiddleware(s.handleGetMyIdentityKey)).Methods("GET")
	router.HandleFunc("/api/crypto/keys/prekey", s.authMiddleware(s.handleUploadSignedPreKey)).Methods("POST")
	router.HandleFunc("/api/crypto/keys/prekeys", s.authMiddleware(s.handleUploadOneTimePreKeys)).Methods("POST")
	router.HandleFunc("/api/crypto/keys/prekeys/count", s.authMiddleware(s.handleGetPreKeyCount)).Methods("GET")
	router.HandleFunc("/api/crypto/bundles/{user_id}", s.authMiddleware(s.handleGetPreKeyBundle)).Methods("GET")
	router.HandleFunc("/api/crypto/keys/status", s.authMiddleware(s.handleGetKeyStatus)).Methods("GET")

	// Sealed Sender routes (protected)
	router.HandleFunc("/api/crypto/keys/sealed-sender", s.authMiddleware(s.handleUploadSealedSenderKey)).Methods("POST")
	router.HandleFunc("/api/crypto/keys/sealed-sender", s.authMiddleware(s.handleGetMySealedSenderKey)).Methods("GET")
	router.HandleFunc("/api/crypto/keys/sealed-sender/status", s.authMiddleware(s.handleGetSealedSenderStatus)).Methods("GET")
	router.HandleFunc("/api/crypto/settings/sealed-sender", s.authMiddleware(s.handleSetSealedSenderEnabled)).Methods("POST")
	router.HandleFunc("/api/crypto/bundles/{user_id}/sealed", s.authMiddleware(s.handleGetPreKeyBundleWithSealedSender)).Methods("GET")

	// Key Transparency routes (public - for auditors)
	router.HandleFunc("/api/transparency/root", s.handleGetTransparencyRoot).Methods("GET")
	router.HandleFunc("/api/transparency/consistency", s.handleGetConsistencyProof).Methods("GET")
	router.HandleFunc("/api/transparency/audit-log", s.handleGetAuditLog).Methods("GET")
	router.HandleFunc("/api/transparency/signing-keys", s.handleGetSigningKeys).Methods("GET")

	// Key Transparency routes (protected)
	router.HandleFunc("/api/transparency/inclusion", s.authMiddleware(s.handleGetInclusionProof)).Methods("GET")
	router.HandleFunc("/api/transparency/client-state", s.authMiddleware(s.handleUpdateClientState)).Methods("POST")
	router.HandleFunc("/api/transparency/client-state", s.authMiddleware(s.handleGetClientState)).Methods("GET")

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

func (s *Server) handleSearchUsers(w http.ResponseWriter, r *http.Request) {
	currentUserID := r.Context().Value("userID").(uuid.UUID)

	query := r.URL.Query().Get("q")
	if query == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"users": []interface{}{},
		})
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 10
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 && parsed <= 20 {
			limit = parsed
		}
	}

	users, err := s.authService.SearchUsers(r.Context(), query, currentUserID, limit)
	if err != nil {
		log.Printf("[Server] Failed to search users: %v", err)
		http.Error(w, "Failed to search users", http.StatusInternalServerError)
		return
	}

	// Sanitize response (don't expose sensitive fields)
	sanitized := make([]map[string]interface{}, len(users))
	for i, u := range users {
		sanitized[i] = map[string]interface{}{
			"id":           u.ID,
			"username":     u.Username,
			"display_name": u.DisplayName,
			"avatar_url":   u.AvatarURL,
		}
		// Only include email if it exists (for display purposes)
		if u.Email != nil {
			sanitized[i]["email"] = *u.Email
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"users": sanitized,
	})
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

func (s *Server) handleDeleteConversation(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	vars := mux.Vars(r)
	convID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid conversation ID", http.StatusBadRequest)
		return
	}

	if err := s.messagingService.DeleteConversation(r.Context(), convID, userID); err != nil {
		log.Printf("[Server] Failed to delete conversation: %v", err)
		http.Error(w, "Failed to delete conversation", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (s *Server) handleGetParticipants(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	convID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid conversation ID", http.StatusBadRequest)
		return
	}

	participants, err := s.messagingService.GetParticipants(r.Context(), convID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get participants: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"participants": participants,
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

// Contacts Handlers

func (s *Server) handleGetContacts(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)
	status := r.URL.Query().Get("status") // Optional: pending, accepted, blocked

	contacts, err := s.contactsService.GetContacts(r.Context(), userID, status)
	if err != nil {
		log.Printf("[Contacts] Failed to get contacts: %v", err)
		http.Error(w, "Failed to get contacts", http.StatusInternalServerError)
		return
	}

	if contacts == nil {
		contacts = []models.ContactWithUser{}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"contacts": contacts,
	})
}

func (s *Server) handleSendContactRequest(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		UserID string `json:"user_id"` // Target user ID
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	targetUserID, err := uuid.Parse(req.UserID)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	contact, err := s.contactsService.SendRequest(r.Context(), userID, targetUserID)
	if err != nil {
		switch err {
		case contacts.ErrCannotAddSelf:
			http.Error(w, "Cannot add yourself as a contact", http.StatusBadRequest)
		case contacts.ErrContactExists:
			http.Error(w, "Contact already exists", http.StatusConflict)
		default:
			log.Printf("[Contacts] Failed to send request: %v", err)
			http.Error(w, "Failed to send contact request", http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(contact)
}

func (s *Server) handleGetPendingRequests(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	requests, err := s.contactsService.GetPendingRequests(r.Context(), userID)
	if err != nil {
		log.Printf("[Contacts] Failed to get pending requests: %v", err)
		http.Error(w, "Failed to get pending requests", http.StatusInternalServerError)
		return
	}

	if requests == nil {
		requests = []models.ContactWithUser{}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"requests": requests,
	})
}

func (s *Server) handleGetPendingCount(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	count, err := s.contactsService.GetPendingCount(r.Context(), userID)
	if err != nil {
		log.Printf("[Contacts] Failed to get pending count: %v", err)
		http.Error(w, "Failed to get pending count", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"count": count,
	})
}

func (s *Server) handleUpdateContact(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)
	vars := mux.Vars(r)

	contactID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid contact ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Status string `json:"status"` // accepted, blocked
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Status != "accepted" && req.Status != "blocked" {
		http.Error(w, "Status must be 'accepted' or 'blocked'", http.StatusBadRequest)
		return
	}

	if err := s.contactsService.UpdateStatus(r.Context(), contactID, userID, req.Status); err != nil {
		switch err {
		case contacts.ErrContactNotFound:
			http.Error(w, "Contact not found", http.StatusNotFound)
		case contacts.ErrUnauthorized:
			http.Error(w, "Unauthorized", http.StatusForbidden)
		default:
			log.Printf("[Contacts] Failed to update contact: %v", err)
			http.Error(w, "Failed to update contact", http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (s *Server) handleDeleteContact(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)
	vars := mux.Vars(r)

	contactID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid contact ID", http.StatusBadRequest)
		return
	}

	if err := s.contactsService.Delete(r.Context(), contactID, userID); err != nil {
		switch err {
		case contacts.ErrContactNotFound:
			http.Error(w, "Contact not found", http.StatusNotFound)
		case contacts.ErrUnauthorized:
			http.Error(w, "Unauthorized", http.StatusForbidden)
		default:
			log.Printf("[Contacts] Failed to delete contact: %v", err)
			http.Error(w, "Failed to delete contact", http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// Invite Handlers

func (s *Server) handleCreateInvite(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		MaxUses   *int   `json:"max_uses,omitempty"`
		ExpiresIn *int64 `json:"expires_in,omitempty"` // Duration in seconds
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	var expiresIn *time.Duration
	if req.ExpiresIn != nil {
		d := time.Duration(*req.ExpiresIn) * time.Second
		expiresIn = &d
	}

	invite, err := s.contactsService.CreateInvite(r.Context(), userID, req.MaxUses, expiresIn)
	if err != nil {
		log.Printf("[Contacts] Failed to create invite: %v", err)
		http.Error(w, "Failed to create invite", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(invite)
}

func (s *Server) handleGetUserInvites(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	invites, err := s.contactsService.GetUserInvites(r.Context(), userID)
	if err != nil {
		log.Printf("[Contacts] Failed to get invites: %v", err)
		http.Error(w, "Failed to get invites", http.StatusInternalServerError)
		return
	}

	if invites == nil {
		invites = []models.InviteCode{}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"invites": invites,
	})
}

func (s *Server) handleDeactivateInvite(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)
	vars := mux.Vars(r)

	inviteID, err := uuid.Parse(vars["id"])
	if err != nil {
		http.Error(w, "Invalid invite ID", http.StatusBadRequest)
		return
	}

	if err := s.contactsService.DeactivateInvite(r.Context(), inviteID, userID); err != nil {
		if err == contacts.ErrInviteNotFound {
			http.Error(w, "Invite not found", http.StatusNotFound)
		} else {
			log.Printf("[Contacts] Failed to deactivate invite: %v", err)
			http.Error(w, "Failed to deactivate invite", http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (s *Server) handleGetInviteInfo(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	code := vars["code"]

	info, err := s.contactsService.GetInviteInfo(r.Context(), code)
	if err != nil {
		if err == contacts.ErrInviteNotFound {
			http.Error(w, "Invite not found", http.StatusNotFound)
		} else {
			log.Printf("[Contacts] Failed to get invite info: %v", err)
			http.Error(w, "Failed to get invite info", http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(info)
}

func (s *Server) handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)
	vars := mux.Vars(r)
	code := vars["code"]

	contact, err := s.contactsService.AcceptInvite(r.Context(), code, userID)
	if err != nil {
		switch err {
		case contacts.ErrInviteNotFound:
			http.Error(w, "Invite not found", http.StatusNotFound)
		case contacts.ErrInviteExpired:
			http.Error(w, "Invite has expired", http.StatusGone)
		case contacts.ErrInviteMaxUses:
			http.Error(w, "Invite has reached maximum uses", http.StatusGone)
		case contacts.ErrCannotAddSelf:
			http.Error(w, "Cannot add yourself as a contact", http.StatusBadRequest)
		default:
			log.Printf("[Contacts] Failed to accept invite: %v", err)
			http.Error(w, "Failed to accept invite", http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(contact)
}

// User Settings Handlers

func (s *Server) handleGetUserSettings(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	settings, err := s.contactsService.GetSettings(r.Context(), userID)
	if err != nil {
		log.Printf("[Settings] Failed to get settings: %v", err)
		http.Error(w, "Failed to get settings", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(settings)
}

func (s *Server) handleUpdateUserSettings(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		RequireContactApproval *bool `json:"require_contact_approval,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Get current settings
	currentSettings, err := s.contactsService.GetSettings(r.Context(), userID)
	if err != nil {
		log.Printf("[Settings] Failed to get current settings: %v", err)
		http.Error(w, "Failed to update settings", http.StatusInternalServerError)
		return
	}

	// Apply updates
	requireApproval := currentSettings.RequireContactApproval
	if req.RequireContactApproval != nil {
		requireApproval = *req.RequireContactApproval
	}

	settings, err := s.contactsService.UpdateSettings(r.Context(), userID, requireApproval)
	if err != nil {
		log.Printf("[Settings] Failed to update settings: %v", err)
		http.Error(w, "Failed to update settings", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(settings)
}

// ============================================================================
// Phone Verification Handlers
// ============================================================================

// handleSendPhoneCode sends an SMS verification code to the given phone number
func (s *Server) handleSendPhoneCode(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		PhoneNumber string `json:"phone_number"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.PhoneNumber == "" {
		http.Error(w, "Phone number is required", http.StatusBadRequest)
		return
	}

	verification, err := s.discoveryService.SendVerificationCode(r.Context(), userID, req.PhoneNumber)
	if err != nil {
		switch err {
		case discovery.ErrPhoneInUse:
			http.Error(w, "Phone number already in use", http.StatusConflict)
		case discovery.ErrRateLimitExceeded:
			http.Error(w, "Too many verification attempts, try again later", http.StatusTooManyRequests)
		default:
			log.Printf("[Phone] Failed to send verification: %v", err)
			http.Error(w, "Failed to send verification code", http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"expires_at": verification.ExpiresAt,
	})
}

// handleVerifyPhoneCode verifies the SMS code
func (s *Server) handleVerifyPhoneCode(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		Code string `json:"code"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Code == "" {
		http.Error(w, "Verification code is required", http.StatusBadRequest)
		return
	}

	err := s.discoveryService.VerifyCode(r.Context(), userID, req.Code)
	if err != nil {
		switch err {
		case discovery.ErrVerificationNotFound:
			http.Error(w, "No pending verification found", http.StatusNotFound)
		case discovery.ErrVerificationExpired:
			http.Error(w, "Verification code expired", http.StatusGone)
		case discovery.ErrInvalidCode:
			http.Error(w, "Invalid verification code", http.StatusBadRequest)
		case discovery.ErrTooManyAttempts:
			http.Error(w, "Too many attempts, request a new code", http.StatusTooManyRequests)
		default:
			log.Printf("[Phone] Failed to verify code: %v", err)
			http.Error(w, "Failed to verify code", http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"phone_verified": true,
	})
}

// handleRemovePhone removes the phone number from the user's account
func (s *Server) handleRemovePhone(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	if err := s.discoveryService.RemovePhoneNumber(r.Context(), userID); err != nil {
		log.Printf("[Phone] Failed to remove phone: %v", err)
		http.Error(w, "Failed to remove phone number", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// handleGetPhoneStatus returns the phone verification status
func (s *Server) handleGetPhoneStatus(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	status, err := s.discoveryService.GetPhoneStatus(r.Context(), userID)
	if err != nil {
		log.Printf("[Phone] Failed to get status: %v", err)
		http.Error(w, "Failed to get phone status", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(status)
}

// ============================================================================
// Contact Discovery Handlers
// ============================================================================

// handleSyncContacts uploads hashed contacts and returns matches
func (s *Server) handleSyncContacts(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		PhoneHashes []string `json:"phone_hashes"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.PhoneHashes) == 0 {
		http.Error(w, "Phone hashes are required", http.StatusBadRequest)
		return
	}

	result, err := s.discoveryService.SyncContacts(r.Context(), userID, req.PhoneHashes)
	if err != nil {
		switch err {
		case discovery.ErrTooManyHashes:
			http.Error(w, "Too many contact hashes (max 100 per sync)", http.StatusBadRequest)
		default:
			log.Printf("[Discovery] Failed to sync contacts: %v", err)
			http.Error(w, "Failed to sync contacts", http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(result)
}

// handleGetDiscoveredContacts returns all discovered contacts
func (s *Server) handleGetDiscoveredContacts(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	contacts, err := s.discoveryService.GetDiscoveredContacts(r.Context(), userID)
	if err != nil {
		log.Printf("[Discovery] Failed to get discovered contacts: %v", err)
		http.Error(w, "Failed to get discovered contacts", http.StatusInternalServerError)
		return
	}

	if contacts == nil {
		contacts = []models.DiscoveredContact{}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"discovered": contacts,
	})
}

// handleClearContactHashes removes all uploaded contact hashes
func (s *Server) handleClearContactHashes(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	if err := s.discoveryService.ClearUploadedContacts(r.Context(), userID); err != nil {
		log.Printf("[Discovery] Failed to clear hashes: %v", err)
		http.Error(w, "Failed to clear contact hashes", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// handleGetDiscoveryNotifications returns pending discovery notifications
func (s *Server) handleGetDiscoveryNotifications(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	notifications, err := s.discoveryService.GetPendingNotifications(r.Context(), userID)
	if err != nil {
		log.Printf("[Discovery] Failed to get notifications: %v", err)
		http.Error(w, "Failed to get notifications", http.StatusInternalServerError)
		return
	}

	if notifications == nil {
		notifications = []models.DiscoveredContact{}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"notifications": notifications,
	})
}

// handleMarkDiscoveryRead marks discovery notifications as read
func (s *Server) handleMarkDiscoveryRead(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		NotificationIDs []string `json:"notification_ids"` // Empty = mark all as read
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var ids []uuid.UUID
	for _, idStr := range req.NotificationIDs {
		id, err := uuid.Parse(idStr)
		if err != nil {
			continue
		}
		ids = append(ids, id)
	}

	if err := s.discoveryService.MarkNotificationsRead(r.Context(), userID, ids); err != nil {
		log.Printf("[Discovery] Failed to mark notifications: %v", err)
		http.Error(w, "Failed to mark notifications as read", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// Crypto Handlers - PQC Key Management for E2EE

// handleUploadIdentityKey uploads a user's identity public key
// Accepts both P-256 (Web Crypto API) and Dilithium3 (PQC) keys
func (s *Server) handleUploadIdentityKey(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		PublicKey string `json:"public_key"` // Base64 encoded public key (P-256 or Dilithium3)
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

	// Validate key size - accept both P-256 and Dilithium3
	if !crypto.IsValidIdentityKeySize(publicKey) {
		http.Error(w, fmt.Sprintf("Invalid public key size: got %d bytes, expected %d (P-256) or %d (Dilithium3)",
			len(publicKey), crypto.P256PublicKeySize, crypto.Dilithium3PublicKeySize), http.StatusBadRequest)
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

// handleUploadSignedPreKey uploads a user's signed prekey
// Accepts both P-256 (Web Crypto API) and Kyber1024 (PQC) keys
func (s *Server) handleUploadSignedPreKey(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		KeyID          int    `json:"key_id"`
		KyberPublicKey string `json:"kyber_public_key"` // Base64 encoded (P-256 or Kyber)
		Signature      string `json:"signature"`        // Base64 encoded signature
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	preKeyPublicKey, err := base64Decode(req.KyberPublicKey)
	if err != nil {
		http.Error(w, "Invalid base64 encoding for public key", http.StatusBadRequest)
		return
	}

	signature, err := base64Decode(req.Signature)
	if err != nil {
		http.Error(w, "Invalid base64 encoding for signature", http.StatusBadRequest)
		return
	}

	// Validate prekey size - accept both P-256 and Kyber1024
	if !crypto.IsValidPreKeySize(preKeyPublicKey) {
		http.Error(w, fmt.Sprintf("Invalid public key size: got %d bytes, expected %d (P-256) or %d (Kyber1024)",
			len(preKeyPublicKey), crypto.P256PublicKeySize, crypto.Kyber1024PublicKeySize), http.StatusBadRequest)
		return
	}

	// Validate signature size
	if !crypto.IsValidSignatureSize(signature) {
		http.Error(w, fmt.Sprintf("Invalid signature size: got %d bytes", len(signature)), http.StatusBadRequest)
		return
	}

	// Verify the signature against the user's identity key
	identityKey, err := s.cryptoService.GetIdentityKey(r.Context(), userID)
	if err != nil || identityKey == nil {
		http.Error(w, "Must upload identity key before signed prekey", http.StatusBadRequest)
		return
	}

	// Use the appropriate verification based on key type
	valid, err := crypto.VerifyAnySignature(identityKey.PublicKey, preKeyPublicKey, signature)
	if err != nil || !valid {
		http.Error(w, "Invalid signature - prekey must be signed by identity key", http.StatusBadRequest)
		return
	}

	// Store the signed prekey
	prekey, err := s.cryptoService.StoreSignedPreKey(r.Context(), userID, req.KeyID, preKeyPublicKey, signature)
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
// Accepts both P-256 (Web Crypto API) and Kyber1024 (PQC) keys
func (s *Server) handleUploadOneTimePreKeys(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		PreKeys []struct {
			KeyID          int    `json:"key_id"`
			KyberPublicKey string `json:"kyber_public_key"` // Base64 encoded (P-256 or Kyber)
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
		publicKey, err := base64Decode(pk.KyberPublicKey)
		if err != nil {
			http.Error(w, fmt.Sprintf("Invalid base64 encoding for prekey %d", pk.KeyID), http.StatusBadRequest)
			return
		}

		// Accept both P-256 and Kyber1024 keys
		if !crypto.IsValidPreKeySize(publicKey) {
			http.Error(w, fmt.Sprintf("Invalid public key size for prekey %d: got %d bytes", pk.KeyID, len(publicKey)), http.StatusBadRequest)
			return
		}

		prekeys[i] = crypto.OneTimePreKeyInput{
			KeyID:          pk.KeyID,
			KyberPublicKey: publicKey,
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

	// Rate limit check to prevent prekey exhaustion attacks
	// Each bundle fetch claims a one-time prekey, so we must limit this
	clientIP := r.Header.Get("X-Forwarded-For")
	if clientIP == "" {
		clientIP = r.RemoteAddr
	}
	if err := s.rateLimiter.CheckBundleFetch(r.Context(), requestingUserID.String(), targetUserID.String(), clientIP); err != nil {
		if err == ratelimit.ErrTargetedAttack {
			http.Error(w, "Too many requests for this user's keys", http.StatusTooManyRequests)
		} else {
			http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
		}
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

// ============================================================================
// Sealed Sender Handlers
// ============================================================================

// handleUploadSealedSenderKey stores a user's sealed sender public key
func (s *Server) handleUploadSealedSenderKey(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req models.SealedSenderKeyUpload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Decode base64 public key
	publicKey, err := base64Decode(req.KyberPublicKey)
	if err != nil {
		http.Error(w, "Invalid base64 encoding for public key", http.StatusBadRequest)
		return
	}

	// Validate Kyber1024 key size
	if len(publicKey) != crypto.Kyber1024PublicKeySize {
		http.Error(w, fmt.Sprintf("Invalid public key size: got %d bytes, expected %d (Kyber1024)",
			len(publicKey), crypto.Kyber1024PublicKeySize), http.StatusBadRequest)
		return
	}

	// Store the sealed sender key
	key, err := s.cryptoService.StoreSealedSenderKey(r.Context(), userID, publicKey)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to store sealed sender key: %v", err), http.StatusInternalServerError)
		return
	}

	response := models.SealedSenderKeyResponse{
		KeyFingerprint: key.KeyFingerprint,
		KeyVersion:     key.KeyVersion,
		CreatedAt:      key.CreatedAt,
		ExpiresAt:      *key.ExpiresAt,
	}

	json.NewEncoder(w).Encode(response)
}

// handleGetMySealedSenderKey returns the current user's sealed sender key
func (s *Server) handleGetMySealedSenderKey(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	key, err := s.cryptoService.GetSealedSenderKey(r.Context(), userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get sealed sender key: %v", err), http.StatusInternalServerError)
		return
	}

	if key == nil {
		http.Error(w, "No sealed sender key found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":               key.ID,
		"kyber_public_key": base64Encode(key.KyberPublicKey),
		"fingerprint":      key.KeyFingerprint,
		"version":          key.KeyVersion,
		"created_at":       key.CreatedAt,
		"expires_at":       key.ExpiresAt,
	})
}

// handleGetSealedSenderStatus returns the sealed sender status for the current user
func (s *Server) handleGetSealedSenderStatus(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	status, err := s.cryptoService.GetSealedSenderStatus(r.Context(), userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get sealed sender status: %v", err), http.StatusInternalServerError)
		return
	}

	response := models.SealedSenderStatusResponse{
		Enabled:          status.Enabled,
		HasSealedKey:     status.HasSealedKey,
		HasDeliveryToken: status.HasDeliveryToken,
		KeyFingerprint:   status.KeyFingerprint,
		KeyVersion:       status.KeyVersion,
	}

	json.NewEncoder(w).Encode(response)
}

// handleSetSealedSenderEnabled enables or disables sealed sender for the current user
func (s *Server) handleSetSealedSenderEnabled(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := s.cryptoService.SetSealedSenderEnabled(r.Context(), userID, req.Enabled); err != nil {
		http.Error(w, fmt.Sprintf("Failed to update sealed sender setting: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"enabled": req.Enabled,
	})
}

// handleGetPreKeyBundleWithSealedSender returns a complete prekey bundle including sealed sender key
func (s *Server) handleGetPreKeyBundleWithSealedSender(w http.ResponseWriter, r *http.Request) {
	requestingUserID := r.Context().Value("userID").(uuid.UUID)

	vars := mux.Vars(r)
	targetUserIDStr := vars["user_id"]

	targetUserID, err := uuid.Parse(targetUserIDStr)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	// Rate limit prekey bundle fetches
	clientIP := r.Header.Get("X-Forwarded-For")
	if clientIP == "" {
		clientIP = r.RemoteAddr
	}
	if err := s.rateLimiter.CheckBundleFetch(r.Context(), requestingUserID.String(), targetUserID.String(), clientIP); err != nil {
		if err == ratelimit.ErrTargetedAttack {
			log.Printf("[WARN] Potential targeted prekey attack detected on user %s", targetUserID)
		}
		http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	// Try hybrid bundle first, fall back to regular bundle
	hybridBundle, err := s.cryptoService.GetHybridPreKeyBundleWithSealedSender(r.Context(), targetUserID, requestingUserID)
	if err == nil && hybridBundle != nil && hybridBundle.SignedPreKey != nil {
		// Return hybrid bundle with sealed sender
		response := map[string]interface{}{
			"user_id":        hybridBundle.UserID,
			"bundle_version": hybridBundle.BundleVersion,
			"generated_at":   hybridBundle.GeneratedAt,
		}

		if hybridBundle.IdentityKey != nil {
			response["identity_key"] = map[string]interface{}{
				"public_key":  base64Encode(hybridBundle.IdentityKey.PublicKey),
				"fingerprint": hybridBundle.IdentityKey.KeyFingerprint,
				"version":     hybridBundle.IdentityKey.KeyVersion,
			}
		}

		if hybridBundle.SignedPreKey != nil {
			response["signed_prekey"] = map[string]interface{}{
				"key_id":           hybridBundle.SignedPreKey.KeyID,
				"ec_public_key":    base64Encode(hybridBundle.SignedPreKey.ECPublicKey),
				"pq_public_key":    base64Encode(hybridBundle.SignedPreKey.PQPublicKey),
				"signature":        base64Encode(hybridBundle.SignedPreKey.Signature),
				"fingerprint":      hybridBundle.SignedPreKey.KeyFingerprint,
				"hybrid_version":   hybridBundle.SignedPreKey.HybridVersion,
			}
		}

		if hybridBundle.OneTimePreKey != nil {
			response["one_time_prekey"] = map[string]interface{}{
				"id":              hybridBundle.OneTimePreKey.ID,
				"key_id":          hybridBundle.OneTimePreKey.KeyID,
				"ec_public_key":   base64Encode(hybridBundle.OneTimePreKey.ECPublicKey),
				"pq_public_key":   base64Encode(hybridBundle.OneTimePreKey.PQPublicKey),
				"hybrid_version":  hybridBundle.OneTimePreKey.HybridVersion,
			}
		}

		// Add sealed sender key
		if hybridBundle.SealedSenderKey != nil {
			response["sealed_sender_key"] = map[string]interface{}{
				"kyber_public_key": base64Encode(hybridBundle.SealedSenderKey.KyberPublicKey),
				"fingerprint":      hybridBundle.SealedSenderKey.KeyFingerprint,
				"version":          hybridBundle.SealedSenderKey.KeyVersion,
			}
		}

		// Add delivery verifier
		if hybridBundle.DeliveryVerifier != nil {
			response["delivery_verifier"] = base64Encode(hybridBundle.DeliveryVerifier)
		}

		json.NewEncoder(w).Encode(response)
		return
	}

	// Fall back to regular bundle with sealed sender
	bundle, err := s.cryptoService.GetPreKeyBundleWithSealedSender(r.Context(), targetUserID, requestingUserID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get prekey bundle: %v", err), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"user_id":        bundle.UserID,
		"bundle_version": bundle.BundleVersion,
		"generated_at":   bundle.GeneratedAt,
	}

	if bundle.IdentityKey != nil {
		response["identity_key"] = map[string]interface{}{
			"public_key":  base64Encode(bundle.IdentityKey.PublicKey),
			"fingerprint": bundle.IdentityKey.KeyFingerprint,
			"version":     bundle.IdentityKey.KeyVersion,
		}
	}

	if bundle.SignedPreKey != nil {
		response["signed_prekey"] = map[string]interface{}{
			"key_id":           bundle.SignedPreKey.KeyID,
			"kyber_public_key": base64Encode(bundle.SignedPreKey.KyberPublicKey),
			"signature":        base64Encode(bundle.SignedPreKey.Signature),
			"fingerprint":      bundle.SignedPreKey.KeyFingerprint,
		}
	}

	if bundle.OneTimePreKey != nil {
		response["one_time_prekey"] = map[string]interface{}{
			"id":               bundle.OneTimePreKey.ID,
			"key_id":           bundle.OneTimePreKey.KeyID,
			"kyber_public_key": base64Encode(bundle.OneTimePreKey.KyberPublicKey),
		}
	}

	// Add sealed sender key
	if bundle.SealedSenderKey != nil {
		response["sealed_sender_key"] = map[string]interface{}{
			"kyber_public_key": base64Encode(bundle.SealedSenderKey.KyberPublicKey),
			"fingerprint":      bundle.SealedSenderKey.KeyFingerprint,
			"version":          bundle.SealedSenderKey.KeyVersion,
		}
	}

	// Add delivery verifier
	if bundle.DeliveryVerifier != nil {
		response["delivery_verifier"] = base64Encode(bundle.DeliveryVerifier)
	}

	json.NewEncoder(w).Encode(response)
}

// ============================================================================
// Key Transparency Handlers
// ============================================================================

// handleGetTransparencyRoot returns the current signed tree head (public endpoint)
func (s *Server) handleGetTransparencyRoot(w http.ResponseWriter, r *http.Request) {
	if s.transparencyService == nil {
		http.Error(w, "Key transparency not enabled", http.StatusServiceUnavailable)
		return
	}

	sth, err := s.transparencyService.GetSignedTreeHead(r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get tree head: %v", err), http.StatusInternalServerError)
		return
	}

	if sth == nil {
		http.Error(w, "No transparency data available yet", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(sth.ToResponse())
}

// handleGetConsistencyProof returns a consistency proof between two epochs (public endpoint)
func (s *Server) handleGetConsistencyProof(w http.ResponseWriter, r *http.Request) {
	if s.transparencyService == nil {
		http.Error(w, "Key transparency not enabled", http.StatusServiceUnavailable)
		return
	}

	fromEpochStr := r.URL.Query().Get("from")
	toEpochStr := r.URL.Query().Get("to")

	if fromEpochStr == "" || toEpochStr == "" {
		http.Error(w, "Both 'from' and 'to' epoch parameters are required", http.StatusBadRequest)
		return
	}

	fromEpoch, err := strconv.ParseInt(fromEpochStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid 'from' epoch", http.StatusBadRequest)
		return
	}

	toEpoch, err := strconv.ParseInt(toEpochStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid 'to' epoch", http.StatusBadRequest)
		return
	}

	proof, err := s.transparencyService.GetConsistencyProof(r.Context(), fromEpoch, toEpoch)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get consistency proof: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(proof.ToResponse())
}

// handleGetAuditLog returns the public audit log (public endpoint)
func (s *Server) handleGetAuditLog(w http.ResponseWriter, r *http.Request) {
	if s.transparencyService == nil {
		http.Error(w, "Key transparency not enabled", http.StatusServiceUnavailable)
		return
	}

	fromEpochStr := r.URL.Query().Get("from_epoch")
	limitStr := r.URL.Query().Get("limit")

	var fromEpoch int64 = 0
	if fromEpochStr != "" {
		parsed, err := strconv.ParseInt(fromEpochStr, 10, 64)
		if err == nil {
			fromEpoch = parsed
		}
	}

	limit := 100
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}

	entries, err := s.transparencyService.GetAuditLog(r.Context(), fromEpoch, limit)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get audit log: %v", err), http.StatusInternalServerError)
		return
	}

	// Convert to response format
	responseEntries := make([]interface{}, len(entries))
	for i, entry := range entries {
		responseEntries[i] = entry.ToResponse()
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"entries": responseEntries,
	})
}

// handleGetSigningKeys returns the transparency signing public keys (public endpoint)
func (s *Server) handleGetSigningKeys(w http.ResponseWriter, r *http.Request) {
	if s.transparencyService == nil {
		http.Error(w, "Key transparency not enabled", http.StatusServiceUnavailable)
		return
	}

	keys, err := s.transparencyService.GetSigningKeys(r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get signing keys: %v", err), http.StatusInternalServerError)
		return
	}

	// Convert to response format
	responseKeys := make([]interface{}, len(keys))
	for i, key := range keys {
		responseKeys[i] = key.ToResponse()
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"signing_keys": responseKeys,
	})
}

// handleGetInclusionProof returns an inclusion proof for a user's key (protected endpoint)
func (s *Server) handleGetInclusionProof(w http.ResponseWriter, r *http.Request) {
	if s.transparencyService == nil {
		http.Error(w, "Key transparency not enabled", http.StatusServiceUnavailable)
		return
	}

	userIDStr := r.URL.Query().Get("user_id")
	if userIDStr == "" {
		http.Error(w, "user_id parameter is required", http.StatusBadRequest)
		return
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		http.Error(w, "Invalid user_id", http.StatusBadRequest)
		return
	}

	var epoch int64 = 0
	epochStr := r.URL.Query().Get("epoch")
	if epochStr != "" {
		parsed, err := strconv.ParseInt(epochStr, 10, 64)
		if err == nil {
			epoch = parsed
		}
	}

	proof, err := s.transparencyService.GetInclusionProof(r.Context(), userID, epoch)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get inclusion proof: %v", err), http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(proof.ToResponse())
}

// handleUpdateClientState updates a client's verified epoch state (protected endpoint)
func (s *Server) handleUpdateClientState(w http.ResponseWriter, r *http.Request) {
	if s.transparencyService == nil {
		http.Error(w, "Key transparency not enabled", http.StatusServiceUnavailable)
		return
	}

	userID := r.Context().Value("userID").(uuid.UUID)

	var req struct {
		DeviceID string `json:"device_id"`
		Epoch    int64  `json:"epoch"`
		RootHash string `json:"root_hash"` // Base64 encoded
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.DeviceID == "" {
		http.Error(w, "device_id is required", http.StatusBadRequest)
		return
	}

	rootHash, err := base64Decode(req.RootHash)
	if err != nil {
		http.Error(w, "Invalid base64 encoding for root_hash", http.StatusBadRequest)
		return
	}

	err = s.transparencyService.UpdateClientState(r.Context(), userID, req.DeviceID, req.Epoch, rootHash)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to update client state: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"epoch":   req.Epoch,
	})
}

// handleGetClientState returns a client's verified epoch state (protected endpoint)
func (s *Server) handleGetClientState(w http.ResponseWriter, r *http.Request) {
	if s.transparencyService == nil {
		http.Error(w, "Key transparency not enabled", http.StatusServiceUnavailable)
		return
	}

	userID := r.Context().Value("userID").(uuid.UUID)
	deviceID := r.URL.Query().Get("device_id")

	if deviceID == "" {
		http.Error(w, "device_id parameter is required", http.StatusBadRequest)
		return
	}

	state, err := s.transparencyService.GetClientState(r.Context(), userID, deviceID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get client state: %v", err), http.StatusInternalServerError)
		return
	}

	if state == nil {
		http.Error(w, "No client state found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"user_id":               state.UserID,
		"device_id":             state.DeviceID,
		"last_verified_epoch":   state.LastVerifiedEpoch,
		"last_verified_root_hash": base64Encode(state.LastVerifiedRootHash),
		"verified_at":           state.VerifiedAt,
	})
}

// ============================================================================
// Transparency Adapter for Crypto Service
// ============================================================================

// transparencyQueuerAdapter adapts the transparency.Service to the crypto.TransparencyQueuer interface
type transparencyQueuerAdapter struct {
	service *transparency.Service
}

// QueueKeyUpdate implements crypto.TransparencyQueuer
func (a *transparencyQueuerAdapter) QueueKeyUpdate(update crypto.TransparencyKeyUpdate) {
	a.service.QueueKeyUpdate(transparency.KeyUpdate{
		UserID:                  update.UserID,
		IdentityKeyFingerprint:  update.IdentityKeyFingerprint,
		SignedPreKeyFingerprint: update.SignedPreKeyFingerprint,
		KeyVersion:              update.KeyVersion,
		UpdateType:              update.UpdateType,
	})
}

// ============================================================================
// OAuth Handlers
// ============================================================================

func (s *Server) handleOAuthInitiate(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	providerStr := vars["provider"]

	var provider auth.OAuthProvider
	switch providerStr {
	case "google":
		provider = auth.ProviderGoogle
	case "github":
		provider = auth.ProviderGitHub
	case "apple":
		provider = auth.ProviderApple
	case "facebook":
		provider = auth.ProviderFacebook
	default:
		http.Error(w, "Unsupported OAuth provider", http.StatusBadRequest)
		return
	}

	// Generate state for CSRF protection
	baseState, err := s.oauthService.GenerateState()
	if err != nil {
		http.Error(w, "Failed to generate state", http.StatusInternalServerError)
		return
	}

	// Check if this is a desktop app request and encode in state
	// State format: {random}:desktop or {random}:web
	isDesktop := r.URL.Query().Get("desktop") == "true"
	var state string
	if isDesktop {
		state = baseState + ":desktop"
	} else {
		state = baseState + ":web"
	}

	// Store state in a cookie (expires in 10 minutes)
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
		SameSite: http.SameSiteLaxMode,
	})

	// Get auth URL and redirect (pass full state including desktop flag)
	authURL, err := s.oauthService.GetAuthURL(provider, state)
	if err != nil {
		if err == auth.ErrOAuthProviderNotSupported {
			http.Error(w, fmt.Sprintf("%s OAuth is not configured", providerStr), http.StatusNotImplemented)
			return
		}
		http.Error(w, "Failed to generate auth URL", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

func (s *Server) handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	providerStr := vars["provider"]

	var provider auth.OAuthProvider
	switch providerStr {
	case "google":
		provider = auth.ProviderGoogle
	case "github":
		provider = auth.ProviderGitHub
	case "apple":
		provider = auth.ProviderApple
	case "facebook":
		provider = auth.ProviderFacebook
	default:
		http.Error(w, "Unsupported OAuth provider", http.StatusBadRequest)
		return
	}

	// Get code and state from query (GET) or form (POST for Apple)
	var code, state string
	if r.Method == "POST" {
		// Apple sends response as form POST
		if err := r.ParseForm(); err != nil {
			http.Error(w, "Failed to parse form", http.StatusBadRequest)
			return
		}
		code = r.FormValue("code")
		state = r.FormValue("state")
	} else {
		code = r.URL.Query().Get("code")
		state = r.URL.Query().Get("state")
	}

	// Parse state early to determine if this is a desktop request
	// State format: {random}:desktop or {random}:web
	isDesktop := strings.HasSuffix(state, ":desktop")

	if code == "" {
		// Check for error response
		errorMsg := r.URL.Query().Get("error")
		if errorMsg == "" {
			errorMsg = r.FormValue("error")
		}
		if errorMsg != "" {
			s.redirectToFrontendWithError(w, r, "OAuth error: "+errorMsg, isDesktop)
			return
		}
		s.redirectToFrontendWithError(w, r, "Missing authorization code", isDesktop)
		return
	}

	// Verify state from cookie
	stateCookie, err := r.Cookie("oauth_state")
	if err != nil || stateCookie.Value != state {
		s.redirectToFrontendWithError(w, r, "Invalid OAuth state", isDesktop)
		return
	}

	// Clear state cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})

	// Exchange code for user info
	userInfo, err := s.oauthService.ExchangeCode(r.Context(), provider, code)
	if err != nil {
		log.Printf("[OAuth] Failed to exchange code: %v", err)
		s.redirectToFrontendWithError(w, r, "Failed to authenticate with "+providerStr, isDesktop)
		return
	}

	// Find or create user
	user, err := s.oauthService.FindOrCreateUser(r.Context(), provider, userInfo)
	if err != nil {
		log.Printf("[OAuth] Failed to find/create user: %v", err)
		s.redirectToFrontendWithError(w, r, "Failed to create account", isDesktop)
		return
	}

	// Generate session token
	token, err := s.authService.GenerateSessionToken(user.ID)
	if err != nil {
		log.Printf("[OAuth] Failed to generate token: %v", err)
		s.redirectToFrontendWithError(w, r, "Failed to create session", isDesktop)
		return
	}

	// Redirect to frontend with token
	s.redirectToFrontendWithToken(w, r, token, isDesktop)
}

func (s *Server) redirectToFrontendWithToken(w http.ResponseWriter, r *http.Request, token string, isDesktop bool) {
	if isDesktop {
		// For desktop apps, we need to use an HTML page with JavaScript to trigger the custom URL scheme.
		// HTTP redirects to custom URL schemes don't work in browsers - they get stuck loading.
		redirectURL := fmt.Sprintf("nochat://auth/callback?token=%s", token)
		log.Printf("[OAuth] Redirecting to desktop app: %s", redirectURL)

		html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>Redirecting to NoChat...</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #0a0a0a;
            color: #fff;
        }
        .container { text-align: center; padding: 2rem; }
        h1 { margin-bottom: 1rem; }
        p { color: #888; margin-bottom: 2rem; }
        a { color: #7c3aed; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Redirecting to NoChat...</h1>
        <p>If the app doesn't open automatically, <a href="%s">click here</a>.</p>
    </div>
    <script>
        window.location.href = %q;
    </script>
</body>
</html>`, redirectURL, redirectURL)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(html))
		return
	}

	frontendURL := getEnvOrDefault("FRONTEND_URL", "http://localhost:3000")
	redirectURL := fmt.Sprintf("%s/oauth/callback?token=%s", frontendURL, token)
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

func (s *Server) redirectToFrontendWithError(w http.ResponseWriter, r *http.Request, errorMsg string, isDesktop bool) {
	if isDesktop {
		// For desktop apps, use an HTML page with JavaScript to trigger the custom URL scheme.
		redirectURL := fmt.Sprintf("nochat://auth/callback?error=%s", url.QueryEscape(errorMsg))
		log.Printf("[OAuth] Redirecting to desktop app with error: %s", errorMsg)

		html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>Redirecting to NoChat...</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #0a0a0a;
            color: #fff;
        }
        .container { text-align: center; padding: 2rem; }
        h1 { margin-bottom: 1rem; }
        p { color: #888; margin-bottom: 2rem; }
        a { color: #7c3aed; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Redirecting to NoChat...</h1>
        <p>If the app doesn't open automatically, <a href="%s">click here</a>.</p>
    </div>
    <script>
        window.location.href = %q;
    </script>
</body>
</html>`, redirectURL, redirectURL)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(html))
		return
	}

	frontendURL := getEnvOrDefault("FRONTEND_URL", "http://localhost:3000")
	redirectURL := fmt.Sprintf("%s/oauth/callback?error=%s", frontendURL, url.QueryEscape(errorMsg))
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

// ============================================================================
// Phone Auth Handlers (Passwordless SMS OTP)
// ============================================================================

func (s *Server) handlePhoneAuthSendCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PhoneNumber string `json:"phone_number"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.PhoneNumber == "" {
		http.Error(w, "Phone number is required", http.StatusBadRequest)
		return
	}

	// Use discovery service to send verification code via Twilio
	err := s.discoveryService.SendAuthCode(r.Context(), req.PhoneNumber)
	if err != nil {
		log.Printf("[PhoneAuth] Failed to send verification code: %v", err)
		http.Error(w, "Failed to send verification code", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Verification code sent",
	})
}

func (s *Server) handlePhoneAuthVerify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PhoneNumber string `json:"phone_number"`
		Code        string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.PhoneNumber == "" || req.Code == "" {
		http.Error(w, "Phone number and code are required", http.StatusBadRequest)
		return
	}

	// Verify the code using discovery service
	err := s.discoveryService.VerifyAuthCode(r.Context(), req.PhoneNumber, req.Code)
	if err != nil {
		log.Printf("[PhoneAuth] Failed to verify code: %v", err)
		http.Error(w, "Invalid or expired verification code", http.StatusUnauthorized)
		return
	}

	// Find or create user by phone number
	user, isNewUser, err := s.authService.FindOrCreatePhoneUser(r.Context(), req.PhoneNumber)
	if err != nil {
		log.Printf("[PhoneAuth] Failed to find/create user: %v", err)
		http.Error(w, "Failed to create account", http.StatusInternalServerError)
		return
	}

	// Generate session token
	token, err := s.authService.GenerateSessionToken(user.ID)
	if err != nil {
		log.Printf("[PhoneAuth] Failed to generate token: %v", err)
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user":        user,
		"token":       token,
		"is_new_user": isNewUser,
	})
}

// ============================================================================
// Helper Functions
// ============================================================================

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
