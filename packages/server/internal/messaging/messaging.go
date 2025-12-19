package messaging

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gitlab.com/secp/services/backend/internal/models"
)

type Service struct {
	db    *sql.DB
	redis *redis.Client
}

func NewService(db *sql.DB, redis *redis.Client) *Service {
	return &Service{
		db:    db,
		redis: redis,
	}
}

// CreateConversation creates a new conversation (direct, group, or channel)
func (s *Service) CreateConversation(ctx context.Context, convType, name, description string, createdBy uuid.UUID) (*models.Conversation, error) {
	conv := &models.Conversation{
		ID:          uuid.New(),
		Type:        convType,
		CreatedBy:   &createdBy,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		IsActive:    true,
	}

	if name != "" {
		conv.Name = &name
	}
	if description != "" {
		conv.Description = &description
	}

	query := `
		INSERT INTO conversations (id, type, name, description, created_by, created_at, updated_at, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, type, name, description, created_by, created_at, updated_at, is_active
	`

	err := s.db.QueryRowContext(ctx, query,
		conv.ID, conv.Type, conv.Name, conv.Description, conv.CreatedBy,
		conv.CreatedAt, conv.UpdatedAt, conv.IsActive,
	).Scan(&conv.ID, &conv.Type, &conv.Name, &conv.Description, &conv.CreatedBy,
		&conv.CreatedAt, &conv.UpdatedAt, &conv.IsActive)

	if err != nil {
		return nil, fmt.Errorf("failed to create conversation: %w", err)
	}

	// Add creator as participant with owner role
	if err := s.AddParticipant(ctx, conv.ID, createdBy, "owner"); err != nil {
		return nil, fmt.Errorf("failed to add creator as participant: %w", err)
	}

	return conv, nil
}

// CreateDirectConversation creates a direct message conversation between two users
func (s *Service) CreateDirectConversation(ctx context.Context, user1ID, user2ID uuid.UUID) (*models.Conversation, error) {
	// Check if direct conversation already exists
	existing, err := s.GetDirectConversation(ctx, user1ID, user2ID)
	if err == nil && existing != nil {
		return existing, nil
	}

	// Create new direct conversation
	conv, err := s.CreateConversation(ctx, "direct", "", "", user1ID)
	if err != nil {
		return nil, err
	}

	// Add second participant
	if err := s.AddParticipant(ctx, conv.ID, user2ID, "member"); err != nil {
		return nil, fmt.Errorf("failed to add second participant: %w", err)
	}

	return conv, nil
}

// GetDirectConversation finds an existing direct conversation between two users
func (s *Service) GetDirectConversation(ctx context.Context, user1ID, user2ID uuid.UUID) (*models.Conversation, error) {
	query := `
		SELECT DISTINCT c.id, c.type, c.name, c.description, c.created_by,
		       c.created_at, c.updated_at, c.last_message_at, c.is_active
		FROM conversations c
		INNER JOIN participants p1 ON c.id = p1.conversation_id AND p1.user_id = $1
		INNER JOIN participants p2 ON c.id = p2.conversation_id AND p2.user_id = $2
		WHERE c.type = 'direct'
		LIMIT 1
	`

	var conv models.Conversation
	err := s.db.QueryRowContext(ctx, query, user1ID, user2ID).Scan(
		&conv.ID, &conv.Type, &conv.Name, &conv.Description, &conv.CreatedBy,
		&conv.CreatedAt, &conv.UpdatedAt, &conv.LastMessageAt, &conv.IsActive,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query direct conversation: %w", err)
	}

	return &conv, nil
}

// AddParticipant adds a user to a conversation
func (s *Service) AddParticipant(ctx context.Context, conversationID, userID uuid.UUID, role string) error {
	query := `
		INSERT INTO participants (id, conversation_id, user_id, role, joined_at, last_read_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (conversation_id, user_id) DO NOTHING
	`

	_, err := s.db.ExecContext(ctx, query,
		uuid.New(), conversationID, userID, role, time.Now(), time.Now())

	return err
}

// CreateMessage creates a new message in a conversation
func (s *Service) CreateMessage(ctx context.Context, conversationID, senderID uuid.UUID, encryptedContent []byte, messageType string, replyToID *uuid.UUID) (*models.Message, error) {
	msg := &models.Message{
		ID:               uuid.New(),
		ConversationID:   conversationID,
		SenderID:         senderID,
		EncryptedContent: encryptedContent,
		MessageType:      messageType,
		ReplyToID:        replyToID,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
		IsEdited:         false,
	}

	query := `
		INSERT INTO messages (id, conversation_id, sender_id, encrypted_content, message_type, reply_to_id, created_at, updated_at, is_edited)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, conversation_id, sender_id, encrypted_content, message_type, reply_to_id, created_at, updated_at, is_edited
	`

	err := s.db.QueryRowContext(ctx, query,
		msg.ID, msg.ConversationID, msg.SenderID, msg.EncryptedContent, msg.MessageType,
		msg.ReplyToID, msg.CreatedAt, msg.UpdatedAt, msg.IsEdited,
	).Scan(&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.EncryptedContent, &msg.MessageType,
		&msg.ReplyToID, &msg.CreatedAt, &msg.UpdatedAt, &msg.IsEdited)

	if err != nil {
		return nil, fmt.Errorf("failed to create message: %w", err)
	}

	// Update conversation's last_message_at
	_, err = s.db.ExecContext(ctx,
		"UPDATE conversations SET last_message_at = $1 WHERE id = $2",
		msg.CreatedAt, conversationID)
	if err != nil {
		// Log but don't fail the message creation
		fmt.Printf("failed to update conversation last_message_at: %v\n", err)
	}

	// Publish to Redis for real-time delivery
	if s.redis != nil {
		s.publishMessage(ctx, msg)
	}

	return msg, nil
}

// GetMessages retrieves messages from a conversation with pagination
func (s *Service) GetMessages(ctx context.Context, conversationID uuid.UUID, limit, offset int) ([]*models.Message, error) {
	query := `
		SELECT id, conversation_id, sender_id, encrypted_content, message_type,
		       reply_to_id, created_at, updated_at, deleted_at, is_edited
		FROM messages
		WHERE conversation_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := s.db.QueryContext(ctx, query, conversationID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query messages: %w", err)
	}
	defer rows.Close()

	var messages []*models.Message
	for rows.Next() {
		var msg models.Message
		err := rows.Scan(&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.EncryptedContent,
			&msg.MessageType, &msg.ReplyToID, &msg.CreatedAt, &msg.UpdatedAt, &msg.DeletedAt, &msg.IsEdited)
		if err != nil {
			return nil, fmt.Errorf("failed to scan message: %w", err)
		}
		messages = append(messages, &msg)
	}

	return messages, nil
}

// GetUserConversations retrieves all conversations for a user
func (s *Service) GetUserConversations(ctx context.Context, userID uuid.UUID) ([]*models.Conversation, error) {
	query := `
		SELECT c.id, c.type, c.name, c.description, c.created_by,
		       c.created_at, c.updated_at, c.last_message_at, c.is_active
		FROM conversations c
		INNER JOIN participants p ON c.id = p.conversation_id
		WHERE p.user_id = $1 AND c.is_active = true
		ORDER BY c.last_message_at DESC NULLS LAST
	`

	rows, err := s.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query conversations: %w", err)
	}
	defer rows.Close()

	var conversations []*models.Conversation
	for rows.Next() {
		var conv models.Conversation
		err := rows.Scan(&conv.ID, &conv.Type, &conv.Name, &conv.Description, &conv.CreatedBy,
			&conv.CreatedAt, &conv.UpdatedAt, &conv.LastMessageAt, &conv.IsActive)
		if err != nil {
			return nil, fmt.Errorf("failed to scan conversation: %w", err)
		}
		conversations = append(conversations, &conv)
	}

	return conversations, nil
}

// UpdateLastRead updates the last read timestamp for a participant
func (s *Service) UpdateLastRead(ctx context.Context, conversationID, userID uuid.UUID) error {
	query := `
		UPDATE participants
		SET last_read_at = $1
		WHERE conversation_id = $2 AND user_id = $3
	`

	_, err := s.db.ExecContext(ctx, query, time.Now(), conversationID, userID)
	return err
}

// Presence Management (using Redis)

// SetPresence sets a user's presence status
func (s *Service) SetPresence(ctx context.Context, userID uuid.UUID, status string) error {
	if s.redis == nil {
		return nil
	}

	key := fmt.Sprintf("presence:%s", userID.String())
	data := map[string]interface{}{
		"status":       status,
		"last_seen_at": time.Now().Unix(),
	}

	return s.redis.HSet(ctx, key, data).Err()
}

// GetPresence gets a user's presence status
func (s *Service) GetPresence(ctx context.Context, userID uuid.UUID) (*models.Presence, error) {
	if s.redis == nil {
		return nil, fmt.Errorf("redis not available")
	}

	key := fmt.Sprintf("presence:%s", userID.String())
	result, err := s.redis.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	if len(result) == 0 {
		return nil, fmt.Errorf("presence not found")
	}

	presence := &models.Presence{
		UserID: userID,
		Status: result["status"],
	}

	return presence, nil
}

// SetTyping sets a typing indicator
func (s *Service) SetTyping(ctx context.Context, conversationID, userID uuid.UUID, isTyping bool) error {
	if s.redis == nil {
		return nil
	}

	key := fmt.Sprintf("typing:%s:%s", conversationID.String(), userID.String())

	if isTyping {
		// Set with TTL of 5 seconds
		return s.redis.Set(ctx, key, "1", 5*time.Second).Err()
	}

	// Remove typing indicator
	return s.redis.Del(ctx, key).Err()
}

// GetTypingUsers gets all users currently typing in a conversation
func (s *Service) GetTypingUsers(ctx context.Context, conversationID uuid.UUID) ([]uuid.UUID, error) {
	if s.redis == nil {
		return []uuid.UUID{}, nil
	}

	pattern := fmt.Sprintf("typing:%s:*", conversationID.String())
	keys, err := s.redis.Keys(ctx, pattern).Result()
	if err != nil {
		return nil, err
	}

	var userIDs []uuid.UUID
	for _, key := range keys {
		// Extract user ID from key
		// key format: "typing:conversationID:userID"
		var convID, userID uuid.UUID
		_, err := fmt.Sscanf(key, "typing:%s:%s", &convID, &userID)
		if err == nil {
			userIDs = append(userIDs, userID)
		}
	}

	return userIDs, nil
}

// publishMessage publishes a message to Redis for real-time delivery
func (s *Service) publishMessage(ctx context.Context, msg *models.Message) {
	channel := fmt.Sprintf("messages:%s", msg.ConversationID.String())

	// Don't publish the encrypted content in pub/sub (security)
	// Clients should fetch full message from API
	notification := map[string]interface{}{
		"message_id":      msg.ID.String(),
		"conversation_id": msg.ConversationID.String(),
		"sender_id":       msg.SenderID.String(),
		"message_type":    msg.MessageType,
		"created_at":      msg.CreatedAt.Unix(),
	}

	s.redis.Publish(ctx, channel, notification)
}

// SubscribeToConversation subscribes to real-time messages for a conversation
func (s *Service) SubscribeToConversation(ctx context.Context, conversationID uuid.UUID) *redis.PubSub {
	if s.redis == nil {
		return nil
	}

	channel := fmt.Sprintf("messages:%s", conversationID.String())
	return s.redis.Subscribe(ctx, channel)
}
