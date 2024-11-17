package models

import (
	"sync"
	"time"
)

type Room struct {
	ID        string
	Name      string
	Clients   map[string]*Client // Map of client ID to Client object
	mutex     sync.Mutex
	CreatedAt time.Time
	CreatedBy string
}

func NewRoom(id string) *Room {
	return &Room{
		ID:        id,
		Clients:   make(map[string]*Client),
		CreatedAt: time.Now(),
	}
}

func (r *Room) AddClient(client *Client) {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	r.Clients[client.ID] = client
}

func (r *Room) RemoveClient(client *Client) {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	delete(r.Clients, client.ID)
}
