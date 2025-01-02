package models

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"runtime/debug"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512
)

type InitialState struct {
	UserID      string `json:"user_id"`
	IsInitiator bool   `json:"is_initiator"`
	UserCount   int    `json:"user_count"`
}

type Message struct {
	Type    string      `json:"type"`
	RoomID  string      `json:"room_id"`
	Content interface{} `json:"content"`
}

type ChatMessage struct {
	Content    string `json:"content"`
	Sender     string `json:"sender"`
	SenderName string `json:"sender_name"`
	Timestamp  string `json:"timestamp"`
	RoomID     string `json:"room_id"`
}

type Client struct {
	Conn   *websocket.Conn
	Send   chan []byte
	UserID string
	Room   *Room
	Ready  bool
	Done   chan struct{}
}

type SignalingState struct {
	OfferTimestamp int64
	PeerID         string
	FromID         string
	Type           string
	Content        map[string]interface{}
	Timestamp      time.Time
}

// QueuedICECandidate represents a queued ICE candidate
type QueuedICECandidate struct {
	FromPeerID string
	ToPeerID   string
	Content    map[string]interface{}
}

type Room struct {
	ID                   string                                `json:"id"`
	Name                 string                                `json:"name"`
	CreatedBy            string                                `json:"created_by"`
	Clients              map[string]*Client                    `json:"-"`
	Mu                   sync.RWMutex                          `json:"-"`
	Initiator            *Client                               `json:"-"`
	State                string                                `json:"state"`
	OfferCreated         bool                                  `json:"offer_created"`
	AllReadyMessageSent  bool                                  `json:"all_ready_message_sent"`
	LastBroadcastTime    time.Time                             `json:"last_broadcast_time"`
	LastBroadcastedCount int                                   `json:"last_broadcasted_count"`
	LastActivity         time.Time                             `json:"last_activity"`
	IsActive             bool                                  `json:"is_active"`
	MeetingStarted       bool                                  `json:"meeting_started"`
	signalingStates      map[string]map[string]*SignalingState // targetPeerID -> fromPeerID -> state
	queuedAnswers        map[string]map[string][]map[string]interface{}
	activeConnections    map[string]map[string]bool // fromID -> targetID -> active
	queuedCandidates     []QueuedICECandidate
}

func NewRoom(id, name, createdBy string) *Room {
	return &Room{
		ID:                id,
		Name:              name,
		CreatedBy:         createdBy,
		Clients:           make(map[string]*Client),
		Mu:                sync.RWMutex{},
		LastActivity:      time.Now(),
		IsActive:          true,
		MeetingStarted:    false,
		State:             "waiting",
		signalingStates:   make(map[string]map[string]*SignalingState),
		queuedAnswers:     make(map[string]map[string][]map[string]interface{}),
		activeConnections: make(map[string]map[string]bool),
		queuedCandidates:  make([]QueuedICECandidate, 0),
	}
}

func GenerateUniqueID() string {
	return uuid.New().String()
}

func checkForDeadlock() {
	debug.SetTraceback("all")
	log.Println("Triggering goroutine dump")
	debug.PrintStack()
}

func (r *Room) Save(ctx context.Context, rdb *redis.Client) error {
	r.Mu.RLock()
	defer r.Mu.RUnlock()

	// Create a copy of the room with only the fields we want to persist
	persistedRoom := struct {
		ID             string    `json:"id"`
		Name           string    `json:"name"`
		CreatedBy      string    `json:"created_by"`
		State          string    `json:"state"`
		MeetingStarted bool      `json:"meeting_started"`
		LastActivity   time.Time `json:"last_activity"`
		IsActive       bool      `json:"is_active"`
	}{
		ID:             r.ID,
		Name:           r.Name,
		CreatedBy:      r.CreatedBy,
		State:          r.State,
		MeetingStarted: r.MeetingStarted,
		LastActivity:   r.LastActivity,
		IsActive:       r.IsActive,
	}

	data, err := json.Marshal(persistedRoom)
	if err != nil {
		return err
	}
	return rdb.Set(ctx, "room:"+r.ID, data, 0).Err()
}

func (r *Room) AddClient(conn *websocket.Conn, userID string) *Client {
	r.Mu.Lock()
	defer r.Mu.Unlock()

	// Check if client already exists
	if existingClient, exists := r.Clients[userID]; exists {
		log.Printf("[DEBUG] Client %s already exists in room %s, updating connection", userID, r.ID)
		existingClient.Conn = conn
		return existingClient
	}

	client := &Client{
		UserID: userID,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		Room:   r,
		Done:   make(chan struct{}),
	}

	r.Clients[userID] = client
	log.Printf("[DEBUG] Added new client %s to room %s. Total clients: %d", userID, r.ID, len(r.Clients))

	// Set initiator if this is the first client
	if len(r.Clients) == 1 {
		r.Initiator = client
		log.Printf("[DEBUG] Set client %s as initiator for room %s (first client)", userID, r.ID)
	}

	return client
}

func (r *Room) RemoveClient(client *Client) {
	r.Mu.Lock()
	wasInitiator := r.Initiator == client
	delete(r.Clients, client.UserID)

	if wasInitiator && len(r.Clients) > 0 {
		for _, c := range r.Clients {
			r.Initiator = c
			go func(newInitiator *Client) {
				initiatorMsg := Message{
					Type:    "initiatorStatus",
					RoomID:  r.ID,
					Content: true,
				}
				msgBytes, _ := json.Marshal(initiatorMsg)
				newInitiator.Send <- msgBytes
			}(r.Initiator)
			break
		}
	} else if len(r.Clients) == 0 {
		r.Initiator = nil
	}
	r.Mu.Unlock()

	close(client.Send)
	log.Printf("Removed client %s from room %s", client.UserID, r.ID)
}

func (r *Room) SetClientReady(client *Client, ready bool) {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	client.Ready = ready
	log.Printf("Client %s ready state set to %v in room %s", client.UserID, ready, r.ID)
}

func (r *Room) AllClientsReady() bool {
	r.Mu.RLock()
	defer r.Mu.RUnlock()

	for _, client := range r.Clients {
		if !client.Ready {
			log.Printf("Client %s is not ready in room %s", client.UserID, r.ID)
			return false
		}
	}
	log.Printf("All clients are ready in room %s", r.ID)
	return true
}

func (r *Room) GetTotalClientsCount() int {
	r.Mu.RLock()
	defer r.Mu.RUnlock()
	count := len(r.Clients)
	log.Printf("Getting total clients count for room %s: %d", r.ID, count)
	return count
}

func (r *Room) GetReadyClientsCount() int {
	r.Mu.RLock()
	defer r.Mu.RUnlock()
	readyCount := 0
	for _, client := range r.Clients {
		if client.Ready {
			readyCount++
		}
	}
	return readyCount
}

func (r *Room) Broadcast(message []byte, excludeClient *Client) {
	r.Mu.Lock()
	clients := make([]*Client, 0, len(r.Clients))
	for _, client := range r.Clients {
		if client != excludeClient {
			clients = append(clients, client)
		}
	}
	r.Mu.Unlock()

	for _, client := range clients {
		select {
		case client.Send <- message:
		default:
			log.Printf("Warning: Unable to send message to client %s, channel full", client.UserID)
		}
	}
}

func (r *Room) GetUserIDs() []string {
	r.Mu.RLock()
	defer r.Mu.RUnlock()
	userIDs := make([]string, 0, len(r.Clients))
	for _, client := range r.Clients {
		userIDs = append(userIDs, client.UserID)
	}
	return userIDs
}

func (r *Room) reassignInitiator() {
	if len(r.Clients) > 0 {
		for _, client := range r.Clients {
			r.Initiator = client
			log.Printf("Reassigned initiator to client %s in room %s", client.UserID, r.ID)

			initiatorMsg := Message{
				Type:    "initiatorStatus",
				RoomID:  r.ID,
				Content: true,
			}
			msgBytes, _ := json.Marshal(initiatorMsg)
			client.Send <- msgBytes
			return
		}
	} else {
		r.Initiator = nil
		log.Printf("No clients left in room %s, initiator set to nil", r.ID)
	}
}

func (r *Room) broadcastNewInitiator(newInitiator *Client) {
	msg := Message{
		Type:   "newInitiator",
		RoomID: r.ID,

		Content: newInitiator.UserID,
	}
	msgBytes, _ := json.Marshal(msg)
	r.Mu.RLock()
	defer r.Mu.RUnlock()
	for _, client := range r.Clients {
		if client != newInitiator {
			select {
			case client.Send <- msgBytes:
				log.Printf("Notified client %s about new initiator in room %s", client.UserID, r.ID)
			default:
				log.Printf("Failed to notify client %s, channel full", client.UserID)
			}
		}
	}
}

type RoomManager interface {
	GetRoom(roomID string) (*Room, error)
	CreateRoom(id, name, createdBy string) (*Room, error)
	GetOrCreateRoom(id string) (*Room, error)
	GetAllRooms() []*Room
	SetRedisClient(client *redis.Client)
	RemoveRoom(roomID string) error
}

type RoomManagerImpl struct {
	rooms map[string]*Room
	mu    sync.RWMutex
	rdb   *redis.Client
}

func (rm *RoomManagerImpl) SetRedisClient(client *redis.Client) {
	rm.rdb = client
}

func (rm *RoomManagerImpl) GetRoom(roomID string) (*Room, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return nil, errors.New("room not found")
	}
	return room, nil
}

func (rm *RoomManagerImpl) GetAllRooms() []*Room {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	rooms := make([]*Room, 0, len(rm.rooms))
	for _, room := range rm.rooms {
		rooms = append(rooms, room)
	}
	return rooms
}

func NewRoomManager() *RoomManagerImpl {
	return &RoomManagerImpl{
		rooms: make(map[string]*Room),
	}
}

var (
	roomManagerInstance *RoomManagerImpl
	once                sync.Once
)

func GetRoomManager() *RoomManagerImpl {
	once.Do(func() {
		roomManagerInstance = NewRoomManager()
	})
	return roomManagerInstance
}

func (rm *RoomManagerImpl) CreateRoom(id, name, createdBy string) (*Room, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if _, exists := rm.rooms[id]; exists {
		return nil, errors.New("room with given ID already exists")
	}

	newRoom := NewRoom(id, name, createdBy)
	rm.rooms[id] = newRoom

	if rm.rdb != nil {
		ctx := context.Background()
		if err := newRoom.Save(ctx, rm.rdb); err != nil {
			log.Printf("Failed to save room to Redis: %v", err)
		}
	}

	return newRoom, nil
}

func (rm *RoomManagerImpl) GetOrCreateRoom(id string) (*Room, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if room, exists := rm.rooms[id]; exists {
		return room, nil
	}

	// Try to load from Redis first
	if rm.rdb != nil {
		ctx := context.Background()
		data, err := rm.rdb.Get(ctx, "room:"+id).Bytes()
		if err == nil {
			var persistedRoom struct {
				ID             string    `json:"id"`
				Name           string    `json:"name"`
				CreatedBy      string    `json:"created_by"`
				State          string    `json:"state"`
				MeetingStarted bool      `json:"meeting_started"`
				LastActivity   time.Time `json:"last_activity"`
				IsActive       bool      `json:"is_active"`
			}
			if err := json.Unmarshal(data, &persistedRoom); err == nil {
				room := NewRoom(id, persistedRoom.Name, persistedRoom.CreatedBy)
				room.State = persistedRoom.State
				room.MeetingStarted = persistedRoom.MeetingStarted
				room.LastActivity = persistedRoom.LastActivity
				room.IsActive = persistedRoom.IsActive
				rm.rooms[id] = room
				return room, nil
			}
		}
	}

	// If not found in Redis or error occurred, create new room
	newRoom := NewRoom(id, "Default Room", "system")
	rm.rooms[id] = newRoom
	log.Printf("Created new room %s", id)
	return newRoom, nil
}

func (r *Room) UpdateActivity() {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	r.LastActivity = time.Now()
}

func (rm *RoomManagerImpl) RemoveRoom(roomID string) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		log.Printf("Attempted to remove non-existent room: %s", roomID)
		return errors.New("room not found")
	}

	log.Printf("Removing room %s - Clients: %d, Last Activity: %v",
		roomID,
		len(room.Clients),
		room.LastActivity)

	if rm.rdb != nil {
		ctx := context.Background()
		if err := rm.rdb.Del(ctx, "room:"+roomID).Err(); err != nil {
			log.Printf("Error removing room %s from Redis: %v", roomID, err)
		} else {
			log.Printf("Successfully removed room %s from Redis", roomID)
		}
	}

	delete(rm.rooms, roomID)
	log.Printf("Successfully removed room %s from memory", roomID)
	return nil
}

func MarshalMessage(messageType string, roomID string, content interface{}) []byte {
	msg := Message{
		Type:    messageType,
		RoomID:  roomID,
		Content: content,
	}
	msgBytes, _ := json.Marshal(msg)
	return msgBytes
}

func (r *Room) GetUserList() []string {
	r.Mu.RLock()
	defer r.Mu.RUnlock()

	users := make([]string, 0, len(r.Clients))
	for userID := range r.Clients {
		users = append(users, userID)
	}
	log.Printf("Getting user list for room %s: %v", r.ID, users)
	return users
}

func (r *Room) GetOtherClientIDs(clientID string) []string {
	r.Mu.RLock()
	defer r.Mu.RUnlock()

	var otherIDs []string
	for id := range r.Clients {
		if id != clientID {
			otherIDs = append(otherIDs, id)
		}
	}
	return otherIDs
}

func (r *Room) GetTargetPeerIDs(clientID string) []string {
	r.Mu.RLock()
	defer r.Mu.RUnlock()

	var targetPeers []string
	for peerID := range r.Clients {
		if peerID > clientID {
			targetPeers = append(targetPeers, peerID)
		}
	}

	if len(targetPeers) > 0 {
		log.Printf("Client %s will create offers for peers: %v", clientID[:4], targetPeers)
	}
	return targetPeers
}

func (r *Room) StoreSignalingState(targetPeerID, fromPeerID string, messageType string, content map[string]interface{}) {
	r.Mu.Lock()
	defer r.Mu.Unlock()

	if r.signalingStates[targetPeerID] == nil {
		r.signalingStates[targetPeerID] = make(map[string]*SignalingState)
	}
	if r.signalingStates[fromPeerID] == nil {
		r.signalingStates[fromPeerID] = make(map[string]*SignalingState)
	}

	state := &SignalingState{
		OfferTimestamp: time.Now().UnixNano() / int64(time.Millisecond),
		PeerID:         targetPeerID,
		FromID:         fromPeerID,
		Type:           messageType,
		Content:        content,
		Timestamp:      time.Now(),
	}

	r.signalingStates[targetPeerID][fromPeerID] = state
	r.signalingStates[fromPeerID][targetPeerID] = state

	log.Printf("Stored bidirectional signaling state for %s <-> %s: %s",
		fromPeerID[:6], targetPeerID[:6], messageType)
}

func (r *Room) HasPendingOffer(targetPeerID, fromPeerID string) bool {
	r.Mu.RLock()
	defer r.Mu.RUnlock()

	if states, ok := r.signalingStates[targetPeerID]; ok {
		if state, ok := states[fromPeerID]; ok {
			return state != nil
		}
	}
	return false
}

func (r *Room) QueueAnswer(targetPeerID, fromPeerID string, content map[string]interface{}) {
	r.Mu.Lock()
	defer r.Mu.Unlock()

	if r.queuedAnswers[targetPeerID] == nil {
		r.queuedAnswers[targetPeerID] = make(map[string][]map[string]interface{})
	}

	r.queuedAnswers[targetPeerID][fromPeerID] = append(
		r.queuedAnswers[targetPeerID][fromPeerID],
		content,
	)

	log.Printf("Queued answer from %s for %s", fromPeerID, targetPeerID)
}

func (r *Room) GetAndClearQueuedAnswers(targetPeerID, fromPeerID string) []map[string]interface{} {
	r.Mu.Lock()
	defer r.Mu.Unlock()

	if answers, ok := r.queuedAnswers[targetPeerID][fromPeerID]; ok {
		delete(r.queuedAnswers[targetPeerID], fromPeerID)
		if len(r.queuedAnswers[targetPeerID]) == 0 {
			delete(r.queuedAnswers, targetPeerID)
		}
		return answers
	}
	return nil
}

func (r *Room) ClearSignalingState(targetPeerID, fromPeerID string) {
	r.Mu.Lock()
	defer r.Mu.Unlock()

	if states, ok := r.signalingStates[targetPeerID]; ok {
		delete(states, fromPeerID)
		if len(states) == 0 {
			delete(r.signalingStates, targetPeerID)
		}
	}

	log.Printf("Cleared signaling state for %s -> %s", fromPeerID, targetPeerID)
}

func (r *Room) IsMeetingStarted() bool {
	r.Mu.RLock()
	defer r.Mu.RUnlock()
	return r.MeetingStarted
}

func (r *Room) ValidateMessageRoute(fromID, targetID string) bool {
	// Don't allow self-messaging
	if fromID == targetID {
		return false
	}

	// Verify both peers exist in the room
	r.Mu.RLock()
	defer r.Mu.RUnlock()

	_, fromExists := r.Clients[fromID]
	_, targetExists := r.Clients[targetID]

	return fromExists && targetExists
}

func (r *Room) GetSortedClients() []*Client {
	r.Mu.RLock()
	defer r.Mu.RUnlock()

	clients := make([]*Client, 0, len(r.Clients))
	for _, client := range r.Clients {
		clients = append(clients, client)
	}

	// Sort clients by UserID to ensure consistent ordering
	sort.Slice(clients, func(i, j int) bool {
		return clients[i].UserID < clients[j].UserID
	})

	return clients
}

func (r *Room) GetAllPeerIDs(excludeID string) []string {
	var peerIDs []string
	for clientID := range r.Clients {
		if clientID != excludeID {
			peerIDs = append(peerIDs, clientID)
		}
	}
	return peerIDs
}

func (r *Room) GetSignalingStates(userID string) []*SignalingState {
	r.Mu.RLock()
	defer r.Mu.RUnlock()

	var states []*SignalingState
	for _, peerStates := range r.signalingStates {
		if state, exists := peerStates[userID]; exists {
			states = append(states, state)
		}
	}
	return states
}

// QueueICECandidate queues an ICE candidate for later delivery
func (r *Room) QueueICECandidate(toPeerID, fromPeerID string, content map[string]interface{}) {
	r.Mu.Lock()
	defer r.Mu.Unlock()

	r.queuedCandidates = append(r.queuedCandidates, QueuedICECandidate{
		FromPeerID: fromPeerID,
		ToPeerID:   toPeerID,
		Content:    content,
	})
}

// GetQueuedCandidates returns and clears all queued candidates for a specific peer pair
func (r *Room) GetQueuedCandidates(toPeerID, fromPeerID string) []map[string]interface{} {
	r.Mu.Lock()
	defer r.Mu.Unlock()

	var candidates []map[string]interface{}
	var remainingCandidates []QueuedICECandidate

	for _, candidate := range r.queuedCandidates {
		if candidate.ToPeerID == toPeerID && candidate.FromPeerID == fromPeerID {
			candidates = append(candidates, candidate.Content)
		} else {
			remainingCandidates = append(remainingCandidates, candidate)
		}
	}

	r.queuedCandidates = remainingCandidates
	return candidates
}
