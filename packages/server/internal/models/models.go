package models

import (
	"time"

	"github.com/google/uuid"
)

// User represents a user in the system
type User struct {
	ID            uuid.UUID  `json:"id"`
	Username      string     `json:"username"`
	Email         *string    `json:"email,omitempty"`
	PasswordHash  *string    `json:"-"` // Never serialize
	WalletAddress *string    `json:"wallet_address,omitempty"`
	DisplayName   string     `json:"display_name"`
	AvatarURL     *string    `json:"avatar_url,omitempty"`
	IsAnonymous   bool       `json:"is_anonymous"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	LastSeenAt    time.Time  `json:"last_seen_at"`
}

// Conversation represents a chat room, group, or channel
type Conversation struct {
	ID            uuid.UUID  `json:"id"`
	Type          string     `json:"type"` // direct, group, channel
	Name          *string    `json:"name,omitempty"`
	Description   *string    `json:"description,omitempty"`
	AvatarURL     *string    `json:"avatar_url,omitempty"`
	CreatedBy     *uuid.UUID `json:"created_by,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	LastMessageAt *time.Time `json:"last_message_at,omitempty"`
	IsActive      bool       `json:"is_active"`
}

// Participant represents a user's membership in a conversation
type Participant struct {
	ID             uuid.UUID `json:"id"`
	ConversationID uuid.UUID `json:"conversation_id"`
	UserID         uuid.UUID `json:"user_id"`
	Role           string    `json:"role"` // owner, admin, member
	JoinedAt       time.Time `json:"joined_at"`
	LastReadAt     time.Time `json:"last_read_at"`
	IsMuted        bool      `json:"is_muted"`
}

// Message represents a message in a conversation
type Message struct {
	ID                uuid.UUID  `json:"id"`
	ConversationID    uuid.UUID  `json:"conversation_id"`
	SenderID          uuid.UUID  `json:"sender_id"`
	EncryptedContent  []byte     `json:"encrypted_content"` // Client-side encrypted
	MessageType       string     `json:"message_type"`      // text, image, file, video, audio, system
	ReplyToID         *uuid.UUID `json:"reply_to_id,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	DeletedAt         *time.Time `json:"deleted_at,omitempty"`
	IsEdited          bool       `json:"is_edited"`
	// E2EE fields
	EncryptionVersion int        `json:"encryption_version,omitempty"` // 1 = AES-GCM, 2 = XChaCha20
	SenderKeyID       *int       `json:"sender_key_id,omitempty"`      // Which key was used to encrypt
	EphemeralKey      []byte     `json:"ephemeral_key,omitempty"`      // Kyber ephemeral key for this message
	Signature         []byte     `json:"signature,omitempty"`          // Dilithium signature of ciphertext
	OneTimePreKeyID   *uuid.UUID `json:"one_time_prekey_id,omitempty"` // If a one-time prekey was used
}

// Attachment represents a file attachment reference
type Attachment struct {
	ID                uuid.UUID `json:"id"`
	MessageID         uuid.UUID `json:"message_id"`
	StorageKey        string    `json:"storage_key"` // S3 object key
	FileName          string    `json:"file_name"`
	FileSize          int64     `json:"file_size"`
	MimeType          string    `json:"mime_type"`
	ThumbnailKey      *string   `json:"thumbnail_key,omitempty"`
	EncryptedMetadata *string   `json:"encrypted_metadata,omitempty"` // JSON encrypted metadata
	CreatedAt         time.Time `json:"created_at"`
	// E2EE fields - File key is encrypted with the message key
	EncryptedFileKey  []byte    `json:"encrypted_file_key,omitempty"`  // File encryption key, encrypted with message key
	FileKeyNonce      []byte    `json:"file_key_nonce,omitempty"`      // Nonce used for file key encryption
	FileKeyAlgorithm  string    `json:"file_key_algorithm,omitempty"`  // Algorithm used (aes-256-gcm/xchacha20)
	ChecksumSHA256    string    `json:"checksum_sha256,omitempty"`     // SHA-256 of encrypted file for integrity
}

// Contact represents a friend/contact relationship
type Contact struct {
	ID            uuid.UUID `json:"id"`
	UserID        uuid.UUID `json:"user_id"`
	ContactUserID uuid.UUID `json:"contact_user_id"`
	Status        string    `json:"status"` // pending, accepted, blocked
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// Call represents a WebRTC call session
type Call struct {
	ID             uuid.UUID  `json:"id"`
	ConversationID uuid.UUID  `json:"conversation_id"`
	InitiatorID    uuid.UUID  `json:"initiator_id"`
	CallType       string     `json:"call_type"` // audio, video
	StartedAt      time.Time  `json:"started_at"`
	EndedAt        *time.Time `json:"ended_at,omitempty"`
	DurationSecs   *int       `json:"duration_seconds,omitempty"`
	Status         string     `json:"status"` // initiated, ringing, active, ended, missed, declined
}

// CallParticipant represents a participant in a call
type CallParticipant struct {
	ID       uuid.UUID  `json:"id"`
	CallID   uuid.UUID  `json:"call_id"`
	UserID   uuid.UUID  `json:"user_id"`
	JoinedAt time.Time  `json:"joined_at"`
	LeftAt   *time.Time `json:"left_at,omitempty"`
}

// WebSocket message types
type WSMessage struct {
	Type    string      `json:"type"`
	RoomID  string      `json:"room_id,omitempty"`
	Content interface{} `json:"content"`
}

// Signaling message types (WebRTC)
type SignalingMessage struct {
	Type         string                 `json:"type"` // offer, answer, iceCandidate
	FromPeerID   string                 `json:"fromPeerId,omitempty"`
	TargetPeerID string                 `json:"targetPeerId,omitempty"`
	SDP          map[string]interface{} `json:"sdp,omitempty"`
	Candidate    map[string]interface{} `json:"candidate,omitempty"`
}

// Chat message for real-time messaging
type ChatMessage struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	Sender         string    `json:"sender"`
	SenderName     string    `json:"sender_name"`
	Content        string    `json:"content"` // This will be encrypted content for persistence
	Timestamp      time.Time `json:"timestamp"`
	MessageType    string    `json:"message_type"`
}

// Presence status
type Presence struct {
	UserID     uuid.UUID `json:"user_id"`
	Status     string    `json:"status"` // online, offline, away, busy
	LastSeenAt time.Time `json:"last_seen_at"`
}

// Typing indicator
type TypingIndicator struct {
	ConversationID uuid.UUID `json:"conversation_id"`
	UserID         uuid.UUID `json:"user_id"`
	IsTyping       bool      `json:"is_typing"`
	Timestamp      time.Time `json:"timestamp"`
}

// Upload request/response
type UploadRequest struct {
	FileName        string `json:"file_name"`
	FileSize        int64  `json:"file_size"`
	MimeType        string `json:"mime_type"`
	ConversationID  string `json:"conversation_id"`
}

type UploadResponse struct {
	UploadURL   string    `json:"upload_url"`   // Pre-signed S3 URL
	StorageKey  string    `json:"storage_key"`  // S3 object key for later reference
	ExpiresAt   time.Time `json:"expires_at"`   // URL expiration
}

type DownloadRequest struct {
	StorageKey string `json:"storage_key"`
}

type DownloadResponse struct {
	DownloadURL string    `json:"download_url"` // Pre-signed S3 URL
	ExpiresAt   time.Time `json:"expires_at"`
}

// E2EE Types for Zero-Trust Messaging

// EncryptedChatMessage represents an E2EE encrypted message over WebSocket
type EncryptedChatMessage struct {
	ID               string `json:"id"`
	ConversationID   string `json:"conversation_id"`
	Sender           string `json:"sender"`
	SenderName       string `json:"sender_name"`
	Ciphertext       string `json:"ciphertext"`        // Base64 encoded encrypted content
	Nonce            string `json:"nonce"`             // Base64 encoded nonce/IV
	EphemeralKey     string `json:"ephemeral_key"`     // Base64 encoded Kyber ephemeral public key
	Signature        string `json:"signature"`         // Base64 encoded Dilithium signature
	Algorithm        string `json:"algorithm"`         // "aes-256-gcm" or "xchacha20-poly1305"
	SenderKeyID      int    `json:"sender_key_id"`     // Sender's key ID for session lookup
	ChainIndex       int    `json:"chain_index"`       // Ratchet chain index
	OneTimePreKeyID  string `json:"one_time_prekey_id,omitempty"` // If a one-time prekey was consumed
	Timestamp        int64  `json:"timestamp"`
	RoomID           string `json:"room_id"`
}

// KeyExchangeMessage represents a PQC key exchange message
type KeyExchangeMessage struct {
	Type               string `json:"type"` // "initiate", "response", "ratchet"
	FromUserID         string `json:"from_user_id"`
	ToUserID           string `json:"to_user_id"`
	EphemeralPublicKey string `json:"ephemeral_public_key"` // Base64 encoded Kyber public key
	Ciphertext         string `json:"ciphertext"`           // Base64 encoded Kyber ciphertext (KEM result)
	Signature          string `json:"signature"`            // Base64 encoded Dilithium signature
	OneTimePreKeyID    string `json:"one_time_prekey_id,omitempty"`
	ChainIndex         int    `json:"chain_index"`
	Timestamp          int64  `json:"timestamp"`
}

// EncryptedFileInfo represents metadata for an encrypted file
type EncryptedFileInfo struct {
	StorageKey        string `json:"storage_key"`
	EncryptedFileKey  string `json:"encrypted_file_key"` // Base64 encoded, encrypted with message key
	FileKeyNonce      string `json:"file_key_nonce"`     // Base64 encoded nonce for file key decryption
	Algorithm         string `json:"algorithm"`          // "aes-256-gcm" or "xchacha20-poly1305"
	OriginalFileName  string `json:"original_file_name,omitempty"`
	MimeType          string `json:"mime_type,omitempty"`
	FileSize          int64  `json:"file_size,omitempty"`
	ChecksumSHA256    string `json:"checksum_sha256,omitempty"` // SHA-256 of encrypted file
}

// E2EESession represents an E2EE session between two users (server sees only opaque blobs)
type E2EESession struct {
	ID                     uuid.UUID `json:"id"`
	ConversationID         uuid.UUID `json:"conversation_id"`
	OwnerUserID            uuid.UUID `json:"owner_user_id"`
	PeerUserID             uuid.UUID `json:"peer_user_id"`
	EncryptedSessionState  []byte    `json:"encrypted_session_state"` // Encrypted by owner's device key
	SendChainIndex         int       `json:"send_chain_index"`
	ReceiveChainIndex      int       `json:"receive_chain_index"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}

// UserDevice represents a user's device for multi-device E2EE
type UserDevice struct {
	ID              uuid.UUID  `json:"id"`
	UserID          uuid.UUID  `json:"user_id"`
	DeviceID        string     `json:"device_id"`
	DeviceName      string     `json:"device_name,omitempty"`
	DevicePublicKey []byte     `json:"device_public_key"` // Kyber public key for encrypting session states
	Status          string     `json:"status"`            // active, revoked
	LastActiveAt    time.Time  `json:"last_active_at"`
	CreatedAt       time.Time  `json:"created_at"`
	RevokedAt       *time.Time `json:"revoked_at,omitempty"`
}
