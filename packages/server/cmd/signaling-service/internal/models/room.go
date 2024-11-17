package models

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"runtime/debug"
	"runtime/pprof"
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

type Room struct {
	ID                   string           `json:"id"`
	Name                 string           `json:"name"`
	CreatedBy            string           `json:"created_by"`
	Clients              map[*Client]bool `json:"-"`
	Mu                   sync.RWMutex     `json:"-"`
	Initiator            *Client          `json:"-"`
	State                string           `json:"state"`
	OfferCreated         bool             `json:"offer_created"`
	AllReadyMessageSent  bool             `json:"all_ready_message_sent"`
	LastBroadcastTime    time.Time        `json:"last_broadcast_time"`
	LastBroadcastedCount int              `json:"last_broadcasted_count"`
	clientReady          map[*Client]bool `json:"-"`
	LastActivity         time.Time        `json:"last_activity"`
	IsActive             bool             `json:"is_active"`
	MeetingStarted       bool             `json:"meeting_started"`
	AnswersReceived      map[string]bool  `json:"-"`
}

func NewRoom(id, name, createdBy string) *Room {
	return &Room{
		ID:              id,
		Name:            name,
		CreatedBy:       createdBy,
		Clients:         make(map[*Client]bool),
		clientReady:     make(map[*Client]bool),
		Mu:              sync.RWMutex{},
		LastActivity:    time.Now(),
		IsActive:        true,
		AnswersReceived: make(map[string]bool),
	}
}

func GenerateUniqueID() string {
	return uuid.New().String()
}

func dumpGoroutinesWithTimeout(timeout time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	done := make(chan bool)
	go func() {
		var buf bytes.Buffer
		pprof.Lookup("goroutine").WriteTo(&buf, 1)
		log.Printf("Goroutine dump:\n%s", buf.String())
		done <- true
	}()

	select {
	case <-ctx.Done():
		log.Println("Goroutine dump timed out")
	case <-done:
		log.Println("Goroutine dump completed")
	}
}

func checkForDeadlock() {
	debug.SetTraceback("all")
	log.Println("Triggering goroutine dump")
	debug.PrintStack()
}

func (r *Room) Save(ctx context.Context, rdb *redis.Client) error {
	data, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return rdb.Set(ctx, "room:"+r.ID, data, 0).Err()
}

func (r *Room) AddClient(conn *websocket.Conn, userID string) *Client {
	lockAcquired := make(chan bool, 1)

	go func() {
		r.Mu.Lock()
		lockAcquired <- true
	}()

	select {
	case <-lockAcquired:

		defer r.Mu.Unlock()
		log.Printf("Locked room %s to add client %s", r.ID, userID)

		client := &Client{
			Conn:   conn,
			UserID: userID,
			Room:   r,
			Send:   make(chan []byte, 1024),
		}

		r.Clients[client] = true
		r.clientReady[client] = false
		log.Printf("Client %s added to room %s", userID, r.ID)
		return client

	case <-time.After(5 * time.Second):
		log.Printf("Lock acquisition timed out for room %s while adding client %s", r.ID, userID)
		return nil
	}
}

func (r *Room) RemoveClient(client *Client) {
	r.Mu.Lock()
	defer r.Mu.Unlock()

	if _, ok := r.Clients[client]; ok {
		delete(r.Clients, client)
		delete(r.clientReady, client)
		close(client.Send)
		log.Printf("Closed Send channel for client %s", client.UserID)

		if r.Initiator == client {
			log.Printf("Initiator removed from room %s, reassigning initiator", r.ID)
			r.reassignInitiator()
		}
	}
	log.Printf("Removed client %s from room %s", client.UserID, r.ID)
}

func (r *Room) SetClientReady(client *Client, ready bool) {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	r.clientReady[client] = ready
}

func (r *Room) AllClientsReady() bool {
	r.Mu.RLock()
	defer r.Mu.RUnlock()

	for client, ready := range r.clientReady {
		if !ready {
			log.Printf("Client %s is not ready in room %s", client.UserID, r.ID)
			return false
		}
	}
	log.Printf("All clients are ready in room %s", r.ID)
	return true
}

func (r *Room) GetTotalClientsCount() int {
	log.Printf("Attempting to acquire read lock for room %s", r.ID)

	lockAcquired := make(chan bool, 1)
	go func() {
		r.Mu.RLock()
		lockAcquired <- true
	}()

	select {
	case <-lockAcquired:
		defer r.Mu.RUnlock()
		log.Printf("Read lock acquired for room %s, counting clients", r.ID)
		clientCount := len(r.Clients)
		log.Printf("Found %d clients in room %s", clientCount, r.ID)
		return clientCount
	case <-time.After(5 * time.Second):
		log.Printf("Lock acquisition timed out for room %s, dumping goroutines", r.ID)
		dumpGoroutinesWithTimeout(10 * time.Second)
		return -1
	}
}

func (r *Room) GetReadyClientsCount() int {
	r.Mu.RLock()
	defer r.Mu.RUnlock()
	readyCount := 0
	for client := range r.Clients {
		if client.Ready {
			readyCount++
		}
	}
	return readyCount
}

func (r *Room) Broadcast(message []byte, excludeClient *Client) {
	log.Printf("DEBUG: Entered Broadcast method")
	r.Mu.RLock()
	log.Printf("[Broadcast] Starting broadcast to %d clients in room %s", len(r.Clients), r.ID)
	log.Printf("[Broadcast] Message content: %s", string(message))

	clients := make([]*Client, 0, len(r.Clients))
	for client := range r.Clients {
		if client != excludeClient {
			clients = append(clients, client)
			log.Printf("[Broadcast] Added client %s to broadcast list", client.UserID)
		}
	}
	r.Mu.RUnlock()

	log.Printf("[Broadcast] Found %d clients to broadcast to", len(clients))

	for _, client := range clients {
		log.Printf("[Broadcast] Sending to client %s", client.UserID)
		if client.Send == nil {
			log.Printf("[Broadcast] ERROR: Send channel is nil for client %s", client.UserID)
			continue
		}

		select {
		case client.Send <- message:
			log.Printf("[Broadcast] Successfully queued message for client %s", client.UserID)
		case <-time.After(time.Second):
			log.Printf("[Broadcast] ERROR: Timeout sending to client %s", client.UserID)
		}
	}
	log.Printf("[Broadcast] Broadcast complete")
}

func (r *Room) GetUserIDs() []string {
	r.Mu.RLock()
	defer r.Mu.RUnlock()
	userIDs := make([]string, 0, len(r.Clients))
	for client := range r.Clients {
		userIDs = append(userIDs, client.UserID)
	}
	return userIDs
}

func (r *Room) reassignInitiator() {
	if len(r.Clients) > 0 {

		for client := range r.Clients {
			r.Initiator = client
			log.Printf("New initiator assigned in room %s: %s", r.ID, client.UserID)

			initiatorMsg := Message{
				Type:    "initiatorStatus",
				RoomID:  r.ID,
				Content: "true",
			}
			msgBytes, _ := json.Marshal(initiatorMsg)
			select {
			case client.Send <- msgBytes:
				log.Printf("Notified new initiator %s in room %s", client.UserID, r.ID)
			default:
				log.Printf("Failed to notify new initiator %s, channel full", client.UserID)
			}

			r.broadcastNewInitiator(client)
			return
		}
	} else {
		r.Initiator = nil
		log.Printf("No clients left in room %s, initiator set to nil", r.ID)
	}
}

func (r *Room) broadcastNewInitiator(newInitiator *Client) {
	msg := Message{
		Type:    "newInitiator",
		RoomID:  r.ID,
		Content: newInitiator.UserID,
	}
	msgBytes, _ := json.Marshal(msg)
	r.Mu.RLock()
	defer r.Mu.RUnlock()
	for client := range r.Clients {
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

type roomManagerImpl struct {
	rooms map[string]*Room
	mu    sync.RWMutex
	rdb   *redis.Client
}

func (rm *roomManagerImpl) SetRedisClient(client *redis.Client) {
	rm.rdb = client
}

func (rm *roomManagerImpl) GetRoom(roomID string) (*Room, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return nil, errors.New("room not found")
	}
	return room, nil
}

func (rm *roomManagerImpl) GetAllRooms() []*Room {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	rooms := make([]*Room, 0, len(rm.rooms))
	for _, room := range rm.rooms {
		rooms = append(rooms, room)
	}
	return rooms
}

func NewRoomManager() RoomManager {
	return &roomManagerImpl{
		rooms: make(map[string]*Room),
	}
}

var (
	roomManagerInstance RoomManager
	once                sync.Once
)

func GetRoomManager() RoomManager {
	once.Do(func() {
		roomManagerInstance = NewRoomManager()
	})
	return roomManagerInstance
}

func (rm *roomManagerImpl) CreateRoom(id, name, createdBy string) (*Room, error) {
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

func (rm *roomManagerImpl) GetOrCreateRoom(id string) (*Room, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if room, exists := rm.rooms[id]; exists {
		return room, nil
	}

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

func (rm *roomManagerImpl) RemoveRoom(roomID string) error {
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

func (r *Room) RecordAnswer(clientID string) {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	r.AnswersReceived[clientID] = true
}

func (r *Room) AllAnswersReceived() bool {
	r.Mu.RLock()
	defer r.Mu.RUnlock()

	expectedAnswers := len(r.Clients) - 1 // All clients except initiator
	receivedAnswers := 0
	for clientID := range r.AnswersReceived {
		if clientID != r.Initiator.UserID {
			receivedAnswers++
		}
	}
	return receivedAnswers >= expectedAnswers
}
