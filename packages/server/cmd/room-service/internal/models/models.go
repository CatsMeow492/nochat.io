package models

import (
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

// ReadPump listens for incoming messages from the client's WebSocket connection.
func (c *Client) ReadPump(rdb *redis.Client) {
	defer func() {
		c.Room.RemoveClient(c)
		c.Conn.Close()
		HandleLeave(c)
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		var msg Message
		err := c.Conn.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket unexpected close error: %v", err)
			}
			break
		}

		log.Printf("Received message: Type=%s, Content=%s", msg.Type, msg.Content)

		switch msg.Type {
		case "ready":
			// Handle 'ready' message
			handleReadyMessage(c, rdb)

		case "chat_message":
			// Handle chat messages if applicable
			broadcastMessage, err := json.Marshal(msg)
			if err != nil {
				log.Printf("Error marshaling chat_message: %v", err)
				continue
			}
			c.Room.Broadcast(broadcastMessage, c)

		default:
			log.Printf("Received unknown message type: %s", msg.Type)
			// Optionally, send an error message back to client
			errorMessage := Message{
				Type:    "error",
				Content: "Unknown message type",
				RoomID:  c.Room.ID,
			}
			broadcastError, err := json.Marshal(errorMessage)
			if err != nil {
				log.Printf("Error marshaling error message: %v", err)
				continue
			}
			c.Send <- broadcastError
		}
	}
}

// WritePump sends messages from the Send channel to the WebSocket connection.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The channel was closed.
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued messages to the current WebSocket message.
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write(newline)
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// HandleMessage processes a "chat" message from the client.
func handleMessages(conn *websocket.Conn, client *Client) {
	defer conn.Close()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Println("Error reading message:", err)
			HandleLeave(client)
			break
		}

		// Unmarshal the message
		var msg Message
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Error unmarshaling message: %v", err)
			continue
		}

		log.Printf("Received message: Type=%s, Content=%s, RoomID=%s", msg.Type, msg.Content, msg.RoomID)

		// Process the message based on its type
		processCompleteMessage(msg.Content, msg.Type, msg.RoomID)
	}
}

// CreateRoom retrieves an existing room by ID or creates a new one if it doesn't exist.
func CreateRoom(id, name, createdBy string) (*Room, error) {
	rm := GetRoomManager().(*roomManagerImpl) // Type assertion to access mu
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// Log the room details
	log.Printf("Creating room with ID: %s, Name: %s, CreatedBy: %s", id, name, createdBy)

	if _, exists := rm.rooms[id]; exists {
		return nil, errors.New("room with given ID already exists")
	}

	newRoom := NewRoom(id, name, createdBy)
	rm.rooms[id] = newRoom
	return newRoom, nil
}

// GetOrCreateRoom retrieves an existing room by ID or creates a new one if it doesn't exist.
func GetOrCreateRoom(id string) (*Room, error) {
	rm := GetRoomManager().(*roomManagerImpl) // Type assertion to access mu
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

// HandleLeave handles the logic when a client leaves the room.
func HandleLeave(c *Client) {
	if c.Room == nil {
		log.Printf("Client %s has no associated room", c.UserID)
		return
	}

	// Log the client and room details
	log.Printf("Client %s is leaving room %s", c.UserID, c.Room.ID)

	// Check if the client is already removed
	if !c.Room.HasClient(c) {
		log.Printf("Client %s is already removed from room %s", c.UserID, c.Room.ID)
		return
	}

	log.Printf("Removing client %s from room %s", c.UserID, c.Room.ID)
	c.Room.RemoveClient(c)

	message := Message{
		Type:    "userLeft",
		Content: c.UserID,
		RoomID:  c.Room.ID,
	}
	log.Printf("Sending message of type %s, size %d to room %s", message.Type, len(message.Content), message.RoomID)
	broadcastMessage, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling userLeft message: %v", err)
		return
	}
	log.Printf("Broadcasting userLeft message to room %s", c.Room.ID)
	c.Room.Broadcast(broadcastMessage, nil)

	// Additional logging for debugging
	log.Printf("Client %s has left room %s", c.UserID, c.Room.ID)
}

// handleReadyMessage processes the 'ready' message type.
func handleReadyMessage(c *Client, rdb *redis.Client) {
	if c.UserID == "" {
		log.Printf("Received 'ready' message with empty UserID for client: %v", c)
		return
	}

	// Notify other clients that this client is ready
	message := Message{
		Type:    "userReady",
		Content: c.UserID,
		RoomID:  c.Room.ID,
	}
	log.Printf("Sending message of types %s, size %d to room %s", message.Type, len(message.Content), message.RoomID)
	broadcastMessage, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling userReady message: %v", err)
		return
	}
	log.Printf("Broadcasting userReady message to room %s", c.Room.ID)
	c.Room.Broadcast(broadcastMessage, c)
}

func processCompleteMessage(content, messageType, roomID string) {
	switch messageType {
	case "offer":
		// Broadcast the offer to other clients in the room
		broadcastToRoom(roomID, "offer", content, nil)
	case "answer":
		// Broadcast the answer to other clients in the room
		broadcastToRoom(roomID, "answer", content, nil)
	case "iceCandidate":
		// Broadcast the ICE candidate to other clients in the room
		broadcastToRoom(roomID, "iceCandidate", content, nil)
	case "ready":
		// Broadcast that a user is ready
		broadcastToRoom(roomID, "userReady", content, nil)
	// ... handle other message types ...
	default:
		log.Printf("Unhandled message type: %s", messageType)
		// Optionally, send an error message back to the client
	}
}

// broadcastToRoom broadcasts a message to all clients in a room except the excluded client.
func broadcastToRoom(roomID, messageType, content string, excludeClient *Client) {
	message := Message{
		Type:    messageType,
		Content: content,
		RoomID:  roomID,
	}
	log.Printf("Broadcasting %s message to room %s", messageType, roomID)
	broadcastMessage, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling %s message: %v", messageType, err)
		return
	}
	room, err := GetRoomManager().GetRoom(roomID)
	if err != nil {
		log.Printf("Room %s not found for broadcasting %s message: %v", roomID, messageType, err)
		return
	}
	room.Broadcast(broadcastMessage, excludeClient)
	log.Printf("Broadcasted %s message to room %s", messageType, roomID)
}
