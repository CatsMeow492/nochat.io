package models

import (
	"encoding/json"
	"log"
	"sync"
)

type Hub struct {
	rooms      map[string]*Room
	clients    map[string]*Client // Changed to use client ID as key
	Broadcast  chan []byte
	Register   chan *Client
	Unregister chan *Client
	mutex      sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		rooms:      make(map[string]*Room),
		clients:    make(map[string]*Client), // Changed to use client ID as key
		Broadcast:  make(chan []byte),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.HandleClientJoin(client)
			log.Println("New client registered:", client.ID)
		case client := <-h.Unregister:
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
				log.Println("Client unregistered:", client.ID)
			}
		case message := <-h.Broadcast:
			var msg map[string]interface{}
			if err := json.Unmarshal(message, &msg); err != nil {
				log.Printf("Error parsing broadcast message: %v", err)
				continue
			}
			roomID, ok := msg["roomId"].(string)
			if !ok {
				log.Println("Invalid roomId in message")
				continue
			}
			log.Printf("Broadcasting message type %s to room %s", msg["type"], roomID)
			h.broadcastToRoom(roomID, message)
		}
	}
}

func (h *Hub) HandleClientJoin(client *Client) {
	h.mutex.Lock()
	defer h.mutex.Unlock()

	room, exists := h.rooms[client.RoomID]
	if !exists {
		room = NewRoom(client.RoomID)
		h.rooms[client.RoomID] = room
	}

	isInitiator := len(room.Clients) == 0
	room.AddClient(client)
	h.clients[client.ID] = client

	joinMessage := map[string]interface{}{
		"type":        "joined",
		"isInitiator": isInitiator,
		"roomId":      client.RoomID,
		"clientId":    client.ID,
	}

	messageBytes, _ := json.Marshal(joinMessage)
	client.Send <- messageBytes
}

func (h *Hub) broadcastToRoom(roomID string, message []byte) {
	h.mutex.Lock()
	defer h.mutex.Unlock()

	room, exists := h.rooms[roomID]
	if !exists {
		return
	}

	for clientID, client := range room.Clients {
		select {
		case client.Send <- message:
		default:
			close(client.Send)
			delete(room.Clients, clientID)
			delete(h.clients, clientID)
		}
	}
}
