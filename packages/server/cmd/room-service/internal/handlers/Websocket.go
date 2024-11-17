package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"gitlab.com/secp/services/backend/cmd/room-service/internal/models"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  128 * 1024, // Increased buffer size
	WriteBufferSize: 128 * 1024, // Increased buffer size
	CheckOrigin: func(r *http.Request) bool {
		return true // Implement proper origin checking in production
	},
}

// ServeWs upgrades the HTTP connection to a WebSocket and initializes the Client.
func ServeWs(w http.ResponseWriter, r *http.Request) {
	manager := models.GetRoomManager()
	rdb := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		http.Error(w, "Could not open WebSocket connection", http.StatusBadRequest)
		return
	}

	// Extract room_id from query parameters
	roomID := r.URL.Query().Get("room_id")
	if roomID == "" {
		log.Println("Room ID is required")
		conn.Close()
		return
	}

	// Retrieve or create the room using RoomManager
	room, err := manager.GetOrCreateRoom(roomID)
	if err != nil {
		log.Printf("Error getting or creating room: %v", err)
		conn.Close()
		return
	}

	// Create a new Client instance
	client := &models.Client{
		Conn:   conn,
		Send:   make(chan []byte, 256),
		UserID: models.GenerateUniqueID(),
		Room:   room,
	}

	// Add the client to the room
	room.AddClient(client)

	// Notify other clients that a new user has joined
	notifyUserJoined(room, client)

	// Start the WritePump and ReadPump goroutines
	go client.WritePump()
	go client.ReadPump(rdb) // Corrected to only pass rdb
}

// notifyUserJoined sends a "userJoined" message to other clients in the room.
func notifyUserJoined(room *models.Room, client *models.Client) {
	if room == nil || client == nil {
		log.Println("Error: room or client is nil in notifyUserJoined")
		return
	}

	message := models.Message{
		Type:    "userJoined",
		Content: client.UserID,
		RoomID:  room.ID,
	}
	log.Printf("Sending message of type %s, size: %d bytes", message.Type, len(message.Content))
	broadcastMessage, err := json.Marshal(message)
	log.Printf("Broadcasted userJoined message to room %s", room.ID)
	if err != nil {
		log.Printf("Error marshaling userJoined message: %v", err)
		return
	}
	room.Broadcast(broadcastMessage, client)
}

// HandleLeave processes the departure of a client.
func HandleLeave(c *models.Client) {
	if c.Room == nil {
		return
	}

	c.Room.RemoveClient(c)

	message := models.Message{
		Type:    "userLeft",
		Content: c.UserID,
		RoomID:  c.Room.ID,
	}
	log.Printf("Sending message of type %s, size: %d bytes", message.Type, len(message.Content))
	broadcastMessage, err := json.Marshal(message)
	log.Printf("Broadcasted userLeft message to room %s", c.Room.ID)
	if err != nil {
		log.Printf("Error marshaling userLeft message: %v", err)
		return
	}
	c.Room.Broadcast(broadcastMessage, nil)
}
