package signaling

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"gitlab.com/secp/services/backend/internal/models"
)

// Client represents a WebSocket client
type Client struct {
	ID     string
	UserID uuid.UUID
	Conn   *websocket.Conn
	Send   chan []byte
	Room   *Room
	mu     sync.Mutex
}

// Room represents a signaling room for WebRTC
type Room struct {
	ID              string
	Clients         map[string]*Client
	mu              sync.RWMutex
	Initiator       *Client
	signalingStates map[string]map[string]*SignalingState
	queuedCandidates []QueuedICECandidate
}

type SignalingState struct {
	PeerID    string
	FromID    string
	Type      string
	Content   map[string]interface{}
	Timestamp time.Time
}

type QueuedICECandidate struct {
	FromPeerID string
	ToPeerID   string
	Content    map[string]interface{}
}

type Service struct {
	rooms      map[string]*Room
	roomsMu    sync.RWMutex
	redis      *redis.Client
	ctx        context.Context
}

func NewService(redis *redis.Client) *Service {
	return &Service{
		rooms: make(map[string]*Room),
		redis: redis,
		ctx:   context.Background(),
	}
}

// GetOrCreateRoom gets or creates a room
func (s *Service) GetOrCreateRoom(roomID string) *Room {
	s.roomsMu.Lock()
	defer s.roomsMu.Unlock()

	if room, exists := s.rooms[roomID]; exists {
		return room
	}

	room := &Room{
		ID:               roomID,
		Clients:          make(map[string]*Client),
		signalingStates:  make(map[string]map[string]*SignalingState),
		queuedCandidates: make([]QueuedICECandidate, 0),
	}

	s.rooms[roomID] = room
	log.Printf("[Signaling] Created room: %s", roomID)

	return room
}

// AddClient adds a client to a room
func (s *Service) AddClient(roomID string, userID uuid.UUID, conn *websocket.Conn) *Client {
	room := s.GetOrCreateRoom(roomID)

	client := &Client{
		ID:     uuid.New().String(),
		UserID: userID,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		Room:   room,
	}

	room.mu.Lock()
	room.Clients[client.ID] = client

	// Set first client as initiator
	if len(room.Clients) == 1 {
		room.Initiator = client
		log.Printf("[Signaling] Set %s as initiator in room %s", client.ID[:8], roomID)
	}
	room.mu.Unlock()

	// Send initial messages
	s.sendInitialState(client, room)

	// Broadcast user list
	s.broadcastUserList(room)

	return client
}

// RemoveClient removes a client from a room
func (s *Service) RemoveClient(client *Client) {
	if client.Room == nil {
		return
	}

	room := client.Room
	room.mu.Lock()

	wasInitiator := room.Initiator == client
	delete(room.Clients, client.ID)

	// Reassign initiator if needed
	if wasInitiator && len(room.Clients) > 0 {
		for _, c := range room.Clients {
			room.Initiator = c
			s.sendMessage(c, models.WSMessage{
				Type:    "initiatorStatus",
				RoomID:  room.ID,
				Content: true,
			})
			break
		}
	}

	room.mu.Unlock()

	close(client.Send)

	// Broadcast updated user list
	s.broadcastUserList(room)

	// Clean up empty rooms
	s.cleanupEmptyRoom(room.ID)

	log.Printf("[Signaling] Client %s removed from room %s", client.ID[:8], room.ID)
}

// HandleMessage processes WebSocket messages
func (s *Service) HandleMessage(client *Client, message []byte) {
	var msg models.WSMessage
	if err := json.Unmarshal(message, &msg); err != nil {
		log.Printf("[Signaling] Failed to unmarshal message: %v", err)
		return
	}

	log.Printf("[Signaling] Received message type: %s from client: %s", msg.Type, client.ID[:8])

	switch msg.Type {
	case "joinRoom":
		// Already handled in AddClient

	case "startMeeting":
		s.handleStartMeeting(client, msg)

	case "offer":
		s.handleOffer(client, msg)

	case "answer":
		s.handleAnswer(client, msg)

	case "iceCandidate":
		s.handleICECandidate(client, msg)

	case "chatMessage":
		s.handleChatMessage(client, msg)

	// E2EE / PQC Key Exchange Messages
	case "keyExchange":
		s.handleKeyExchange(client, msg)

	case "encryptedMessage":
		s.handleEncryptedMessage(client, msg)

	case "keyExchangeAck":
		s.handleKeyExchangeAck(client, msg)

	default:
		log.Printf("[Signaling] Unknown message type: %s", msg.Type)
	}
}

func (s *Service) handleStartMeeting(client *Client, msg models.WSMessage) {
	room := client.Room

	// Broadcast meeting started
	s.broadcastToRoom(room, models.WSMessage{
		Type:    "startMeeting",
		RoomID:  room.ID,
		Content: true,
	}, nil)

	// Tell clients to create offers based on sorted IDs
	room.mu.RLock()
	clients := make([]*Client, 0, len(room.Clients))
	for _, c := range room.Clients {
		clients = append(clients, c)
	}
	room.mu.RUnlock()

	for _, c := range clients {
		peers := s.getTargetPeers(room, c.ID)
		if len(peers) > 0 {
			s.sendMessage(c, models.WSMessage{
				Type:   "createOffer",
				RoomID: room.ID,
				Content: map[string]interface{}{
					"peers": peers,
				},
			})
		}
	}
}

func (s *Service) handleOffer(client *Client, msg models.WSMessage) {
	content, ok := msg.Content.(map[string]interface{})
	if !ok {
		log.Printf("[Signaling] Invalid offer content")
		return
	}

	targetPeerID := s.extractTargetPeerID(content)
	if targetPeerID == "" {
		log.Printf("[Signaling] No target peer in offer")
		return
	}

	content["fromPeerID"] = client.ID

	// Store signaling state
	s.storeSignalingState(client.Room, targetPeerID, client.ID, "offer", content)

	// Forward offer to target peer
	s.forwardToPeer(client.Room, targetPeerID, models.WSMessage{
		Type:    "offer",
		RoomID:  client.Room.ID,
		Content: content,
	})

	// Send any queued ICE candidates
	s.sendQueuedCandidates(client.Room, targetPeerID, client.ID)
}

func (s *Service) handleAnswer(client *Client, msg models.WSMessage) {
	content, ok := msg.Content.(map[string]interface{})
	if !ok {
		log.Printf("[Signaling] Invalid answer content")
		return
	}

	targetPeerID := s.extractTargetPeerID(content)
	if targetPeerID == "" {
		log.Printf("[Signaling] No target peer in answer")
		return
	}

	content["fromPeerId"] = client.ID

	// Forward answer to target peer
	s.forwardToPeer(client.Room, targetPeerID, models.WSMessage{
		Type:    "answer",
		RoomID:  client.Room.ID,
		Content: content,
	})
}

func (s *Service) handleICECandidate(client *Client, msg models.WSMessage) {
	content, ok := msg.Content.(map[string]interface{})
	if !ok {
		log.Printf("[Signaling] Invalid ICE candidate content")
		return
	}

	targetPeerID := s.extractTargetPeerID(content)
	if targetPeerID == "" {
		log.Printf("[Signaling] No target peer in ICE candidate")
		return
	}

	// Prevent self-targeting
	if targetPeerID == client.ID {
		return
	}

	content["fromPeerId"] = client.ID

	// Check if we have a pending offer
	room := client.Room
	if !s.hasPendingOffer(room, targetPeerID, client.ID) {
		log.Printf("[Signaling] No pending offer, queueing ICE candidate")
		s.queueICECandidate(room, targetPeerID, client.ID, content)
		return
	}

	// Forward ICE candidate
	s.forwardToPeer(room, targetPeerID, models.WSMessage{
		Type:    "iceCandidate",
		RoomID:  room.ID,
		Content: content,
	})
}

func (s *Service) handleChatMessage(client *Client, msg models.WSMessage) {
	// Broadcast chat message to all clients in room
	s.broadcastToRoom(client.Room, models.WSMessage{
		Type:    "chatMessage",
		RoomID:  client.Room.ID,
		Content: msg.Content,
	}, nil)
}

// Helper functions

func (s *Service) sendInitialState(client *Client, room *Room) {
	// Send user ID
	s.sendMessage(client, models.WSMessage{
		Type:    "userID",
		RoomID:  room.ID,
		Content: client.UserID.String(),
	})

	// Send initiator status
	isInitiator := room.Initiator == client
	s.sendMessage(client, models.WSMessage{
		Type:    "initiatorStatus",
		RoomID:  room.ID,
		Content: isInitiator,
	})

	// Send user count
	room.mu.RLock()
	count := len(room.Clients)
	room.mu.RUnlock()

	s.sendMessage(client, models.WSMessage{
		Type:    "userCount",
		RoomID:  room.ID,
		Content: count,
	})
}

func (s *Service) sendMessage(client *Client, msg models.WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[Signaling] Failed to marshal message: %v", err)
		return
	}

	select {
	case client.Send <- data:
	default:
		log.Printf("[Signaling] Client send channel full: %s", client.ID[:8])
	}
}

func (s *Service) broadcastToRoom(room *Room, msg models.WSMessage, exclude *Client) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[Signaling] Failed to marshal broadcast: %v", err)
		return
	}

	room.mu.RLock()
	clients := make([]*Client, 0, len(room.Clients))
	for _, c := range room.Clients {
		if c != exclude {
			clients = append(clients, c)
		}
	}
	room.mu.RUnlock()

	for _, c := range clients {
		select {
		case c.Send <- data:
		default:
			log.Printf("[Signaling] Broadcast failed for client: %s", c.ID[:8])
		}
	}
}

func (s *Service) forwardToPeer(room *Room, peerID string, msg models.WSMessage) {
	room.mu.RLock()
	peer, exists := room.Clients[peerID]
	room.mu.RUnlock()

	if !exists {
		log.Printf("[Signaling] Peer not found: %s", peerID[:8])
		return
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[Signaling] Failed to marshal forward: %v", err)
		return
	}

	select {
	case peer.Send <- data:
	default:
		log.Printf("[Signaling] Forward failed for peer: %s", peerID[:8])
	}
}

func (s *Service) broadcastUserList(room *Room) {
	room.mu.RLock()
	userIDs := make([]string, 0, len(room.Clients))
	for _, c := range room.Clients {
		userIDs = append(userIDs, c.UserID.String())
	}
	room.mu.RUnlock()

	s.broadcastToRoom(room, models.WSMessage{
		Type:   "userList",
		RoomID: room.ID,
		Content: map[string]interface{}{
			"users": userIDs,
		},
	}, nil)
}

func (s *Service) extractTargetPeerID(content map[string]interface{}) string {
	// Try various field names
	if id, ok := content["targetPeerID"].(string); ok {
		return id
	}
	if id, ok := content["targetPeerId"].(string); ok {
		return id
	}
	if id, ok := content["targetPeer"].(string); ok {
		return id
	}
	return ""
}

func (s *Service) getTargetPeers(room *Room, clientID string) []string {
	room.mu.RLock()
	defer room.mu.RUnlock()

	var peers []string
	for id := range room.Clients {
		if id > clientID {
			peers = append(peers, id)
		}
	}
	return peers
}

func (s *Service) storeSignalingState(room *Room, targetID, fromID, msgType string, content map[string]interface{}) {
	room.mu.Lock()
	defer room.mu.Unlock()

	if room.signalingStates[targetID] == nil {
		room.signalingStates[targetID] = make(map[string]*SignalingState)
	}

	room.signalingStates[targetID][fromID] = &SignalingState{
		PeerID:    targetID,
		FromID:    fromID,
		Type:      msgType,
		Content:   content,
		Timestamp: time.Now(),
	}
}

func (s *Service) hasPendingOffer(room *Room, targetID, fromID string) bool {
	room.mu.RLock()
	defer room.mu.RUnlock()

	if states, ok := room.signalingStates[targetID]; ok {
		if _, ok := states[fromID]; ok {
			return true
		}
	}
	return false
}

func (s *Service) queueICECandidate(room *Room, toID, fromID string, content map[string]interface{}) {
	room.mu.Lock()
	defer room.mu.Unlock()

	room.queuedCandidates = append(room.queuedCandidates, QueuedICECandidate{
		FromPeerID: fromID,
		ToPeerID:   toID,
		Content:    content,
	})
}

func (s *Service) sendQueuedCandidates(room *Room, toID, fromID string) {
	room.mu.Lock()
	var candidates []map[string]interface{}
	var remaining []QueuedICECandidate

	for _, c := range room.queuedCandidates {
		if c.ToPeerID == toID && c.FromPeerID == fromID {
			candidates = append(candidates, c.Content)
		} else {
			remaining = append(remaining, c)
		}
	}

	room.queuedCandidates = remaining
	room.mu.Unlock()

	// Send all queued candidates
	for _, content := range candidates {
		s.forwardToPeer(room, toID, models.WSMessage{
			Type:    "iceCandidate",
			RoomID:  room.ID,
			Content: content,
		})
	}

	if len(candidates) > 0 {
		log.Printf("[Signaling] Sent %d queued ICE candidates", len(candidates))
	}
}

func (s *Service) cleanupEmptyRoom(roomID string) {
	s.roomsMu.Lock()
	defer s.roomsMu.Unlock()

	if room, exists := s.rooms[roomID]; exists {
		room.mu.RLock()
		isEmpty := len(room.Clients) == 0
		room.mu.RUnlock()

		if isEmpty {
			delete(s.rooms, roomID)
			log.Printf("[Signaling] Cleaned up empty room: %s", roomID)
		}
	}
}

// WritePump handles writing messages to the WebSocket
func (s *Service) WritePump(client *Client) {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		client.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-client.Send:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := client.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ReadPump handles reading messages from the WebSocket
func (s *Service) ReadPump(client *Client) {
	defer func() {
		s.RemoveClient(client)
		client.Conn.Close()
	}()

	client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	client.Conn.SetPongHandler(func(string) error {
		client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[Signaling] WebSocket error: %v", err)
			}
			break
		}

		s.HandleMessage(client, message)
	}
}

// E2EE / PQC Key Exchange Handlers
// These handlers facilitate the "Quantum Handshake" between peers
// The server NEVER sees plaintext - only forwards opaque encrypted blobs

// handleKeyExchange handles PQC key exchange initiation/response
// Message format:
// {
//   "type": "keyExchange",
//   "content": {
//     "exchange_type": "initiate" | "response" | "ratchet",
//     "target_peer_id": "peer-uuid",
//     "ephemeral_public_key": "base64-kyber-pub-key",
//     "ciphertext": "base64-kyber-ciphertext", // KEM result (for response)
//     "signature": "base64-dilithium-signature",
//     "one_time_prekey_id": "uuid" // optional, if consuming OTK
//   }
// }
func (s *Service) handleKeyExchange(client *Client, msg models.WSMessage) {
	content, ok := msg.Content.(map[string]interface{})
	if !ok {
		log.Printf("[Signaling] Invalid key exchange content")
		return
	}

	targetPeerID := s.extractTargetPeerID(content)
	if targetPeerID == "" {
		log.Printf("[Signaling] No target peer in key exchange")
		return
	}

	// Add sender information
	content["from_peer_id"] = client.ID
	content["from_user_id"] = client.UserID.String()

	// Log the key exchange (without revealing key material)
	exchangeType, _ := content["exchange_type"].(string)
	log.Printf("[Signaling] Key exchange (%s) from %s to %s", exchangeType, client.ID[:8], targetPeerID[:8])

	// Forward to target peer - server NEVER inspects the cryptographic content
	s.forwardToPeer(client.Room, targetPeerID, models.WSMessage{
		Type:    "keyExchange",
		RoomID:  client.Room.ID,
		Content: content,
	})
}

// handleKeyExchangeAck handles acknowledgment of key exchange
// This confirms that the peer received and processed the key exchange
func (s *Service) handleKeyExchangeAck(client *Client, msg models.WSMessage) {
	content, ok := msg.Content.(map[string]interface{})
	if !ok {
		log.Printf("[Signaling] Invalid key exchange ack content")
		return
	}

	targetPeerID := s.extractTargetPeerID(content)
	if targetPeerID == "" {
		log.Printf("[Signaling] No target peer in key exchange ack")
		return
	}

	content["from_peer_id"] = client.ID

	log.Printf("[Signaling] Key exchange ACK from %s to %s", client.ID[:8], targetPeerID[:8])

	s.forwardToPeer(client.Room, targetPeerID, models.WSMessage{
		Type:    "keyExchangeAck",
		RoomID:  client.Room.ID,
		Content: content,
	})
}

// handleEncryptedMessage handles E2EE encrypted chat messages
// The server only sees opaque ciphertext blobs - it CANNOT read the content
// Message format:
// {
//   "type": "encryptedMessage",
//   "content": {
//     "target_peer_id": "peer-uuid" | null (broadcast to room),
//     "ciphertext": "base64-encrypted-content",
//     "nonce": "base64-nonce",
//     "ephemeral_key": "base64-kyber-ephemeral-pub", // For PFS
//     "signature": "base64-dilithium-signature",
//     "algorithm": "aes-256-gcm" | "xchacha20-poly1305",
//     "sender_key_id": 123,
//     "chain_index": 456
//   }
// }
func (s *Service) handleEncryptedMessage(client *Client, msg models.WSMessage) {
	content, ok := msg.Content.(map[string]interface{})
	if !ok {
		log.Printf("[Signaling] Invalid encrypted message content")
		return
	}

	// Add sender info
	content["sender_id"] = client.ID
	content["sender_user_id"] = client.UserID.String()
	content["timestamp"] = time.Now().UnixMilli()

	// Check if this is a targeted message or broadcast
	targetPeerID := s.extractTargetPeerID(content)

	if targetPeerID != "" {
		// Forward to specific peer (direct message)
		log.Printf("[Signaling] E2EE message from %s to %s (direct)", client.ID[:8], targetPeerID[:8])
		s.forwardToPeer(client.Room, targetPeerID, models.WSMessage{
			Type:    "encryptedMessage",
			RoomID:  client.Room.ID,
			Content: content,
		})
	} else {
		// Broadcast to all peers in room (group message)
		// Each peer will decrypt with their own session key
		log.Printf("[Signaling] E2EE message from %s (broadcast)", client.ID[:8])
		s.broadcastToRoom(client.Room, models.WSMessage{
			Type:    "encryptedMessage",
			RoomID:  client.Room.ID,
			Content: content,
		}, client)
	}
}

// BroadcastKeyBundle sends a key bundle notification to all peers in a room
// This is used when a user needs to notify others of key updates
func (s *Service) BroadcastKeyBundle(roomID string, userID string, keyFingerprint string) {
	s.roomsMu.RLock()
	room, exists := s.rooms[roomID]
	s.roomsMu.RUnlock()

	if !exists {
		return
	}

	s.broadcastToRoom(room, models.WSMessage{
		Type:   "keyBundleUpdate",
		RoomID: roomID,
		Content: map[string]interface{}{
			"user_id":         userID,
			"key_fingerprint": keyFingerprint,
			"timestamp":       time.Now().UnixMilli(),
		},
	}, nil)
}

// NotifyLowPreKeys notifies a client that their one-time prekey count is low
func (s *Service) NotifyLowPreKeys(client *Client, count int) {
	s.sendMessage(client, models.WSMessage{
		Type:   "lowPreKeys",
		RoomID: client.Room.ID,
		Content: map[string]interface{}{
			"remaining_count": count,
			"recommended":     100, // Recommended to upload 100 new prekeys
		},
	})
}
