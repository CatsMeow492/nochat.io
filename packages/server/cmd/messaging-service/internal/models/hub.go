package models

import (
	"context"
	"log"
	"sync"

	"github.com/go-redis/redis/v8"
)

type Hub struct {
	RoomManager RoomManager
	clients     map[*Client]bool
	broadcast   chan []byte
	Register    chan *Client
	unregister  chan *Client
	mutex       sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		RoomManager: NewRoomManager(), // Corrected
		clients:     make(map[*Client]bool),
		broadcast:   make(chan []byte),
		Register:    make(chan *Client),
		unregister:  make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.clients[client] = true
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.Send)
			}
		case message := <-h.broadcast:
			for client := range h.clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.clients, client)
				}
			}
		}
	}
}

func (h *Hub) broadcastToRoom(roomID string, message []byte) {
	// Connect to Redis
	rdb := redis.NewClient(&redis.Options{
		Addr: "redis:6379",
	})
	defer rdb.Close()

	// Get the room members from Redis
	members, err := rdb.SMembers(context.Background(), "room:"+roomID).Result()
	if err != nil {
		log.Printf("Error getting room members: %v", err)
		return
	}

	// Broadcast the message to all clients in the room
	for _, clientID := range members {
		for client := range h.clients {
			if client.ID == clientID {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.clients, client)
				}
				break
			}
		}
	}
}
