package models

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

// Constants related to WebSocket settings
const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512
)

var (
	newline = []byte{'\n'}
	space   = []byte{' '}
)

// Message represents a message exchanged in the chat.
type Message struct {
	Type    string `json:"type"`
	RoomID  string `json:"room_id"`
	Content string `json:"content"`
}

// Room represents a chat room.
type Room struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	CreatedBy string           `json:"created_by"`
	Clients   map[*Client]bool `json:"-"`
	Mu        sync.Mutex       `json:"-"`
	Members   map[string]bool  `json:"members"`
}

// NewRoom creates a new Room instance.
func NewRoom(id, name, createdBy string) *Room {
	return &Room{
		ID:        id,
		Name:      name,
		CreatedBy: createdBy,
		Clients:   make(map[*Client]bool),
		Members:   make(map[string]bool),
	}
}

// GenerateUniqueID generates a unique identifier.
func GenerateUniqueID() string {
	return uuid.New().String()
}

// Save persists the room to Redis.
func (r *Room) Save(ctx context.Context, rdb *redis.Client) error {
	data, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return rdb.Set(ctx, "room:"+r.ID, data, 0).Err()
}

// AddClient adds a client to the room.
func (r *Room) AddClient(client *Client) {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	r.Clients[client] = true
	r.Members[client.UserID] = true
	client.Room = r
}

// RemoveClient removes a client from the room.
func (r *Room) RemoveClient(client *Client) {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	delete(r.Clients, client)
	delete(r.Members, client.UserID)
	client.Room = nil

	// Notify other clients that the user has left
	message := Message{
		Type:    "userLeft",
		Content: client.UserID,
		RoomID:  r.ID,
	}
	log.Printf("Broadcasting userLeft message to room %s", r.ID)
	broadcastMessage, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling userLeft message: %v", err)
		return
	}
	r.Broadcast(broadcastMessage, client)
}

// Broadcast sends a message to all clients in the room except the sender.
func (r *Room) Broadcast(message []byte, sender *Client) {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	for client := range r.Clients {
		if client != sender {
			select {
			case client.Send <- message:
			default:
				close(client.Send)
				delete(r.Clients, client)
			}
		}
	}
}

// GetMembers returns the members of the room.
func (r *Room) GetMembers() []string {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	members := make([]string, 0, len(r.Members))
	for member := range r.Members {
		members = append(members, member)
	}
	return members
}

// Client represents a WebSocket client.
type Client struct {
	Conn   *websocket.Conn
	Room   *Room
	Send   chan []byte
	UserID string
}

// RoomManager defines the interface for managing rooms.
type RoomManager interface {
	GetRoom(roomID string) (*Room, error)
	CreateRoom(id, name, createdBy string) (*Room, error)
	GetOrCreateRoom(id string) (*Room, error)
}

// roomManagerImpl is the concrete implementation of RoomManager.
type roomManagerImpl struct {
	rooms map[string]*Room
	mu    sync.RWMutex
}

// GetRoom retrieves a room by its ID.
func (rm *roomManagerImpl) GetRoom(roomID string) (*Room, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return nil, errors.New("room not found")
	}
	return room, nil
}

// NewRoomManager creates a new instance of RoomManager.
func NewRoomManager() RoomManager {
	return &roomManagerImpl{
		rooms: make(map[string]*Room),
	}
}

// Singleton instance management
var (
	roomManagerInstance RoomManager
	once                sync.Once
)

// GetRoomManager returns the singleton instance of RoomManager.
func GetRoomManager() RoomManager {
	once.Do(func() {
		roomManagerInstance = NewRoomManager()
	})
	return roomManagerInstance
}

// Update the CreateRoom method
func (rm *roomManagerImpl) CreateRoom(id, name, createdBy string) (*Room, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if _, exists := rm.rooms[id]; exists {
		return nil, errors.New("room with given ID already exists")
	}

	newRoom := NewRoom(id, name, createdBy)
	rm.rooms[id] = newRoom
	return newRoom, nil
}

// Update the GetOrCreateRoom method
func (rm *roomManagerImpl) GetOrCreateRoom(id string) (*Room, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if room, exists := rm.rooms[id]; exists {
		return room, nil
	}

	// Create a new room with a default name if room doesn't exist
	defaultName := "Default Room"
	createdBy := "system"
	newRoom := NewRoom(id, defaultName, createdBy)
	rm.rooms[id] = newRoom
	return newRoom, nil
}

func (r *Room) HasClient(client *Client) bool {
	r.Mu.Lock()
	defer r.Mu.Unlock()
	_, exists := r.Clients[client]
	return exists
}
