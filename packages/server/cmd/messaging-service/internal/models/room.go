package models

import (
	"errors"
	"sync"
)

type Room struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Members []string `json:"members"`
}

type RoomManager interface {
	GetRoom(roomID string) (*Room, error)
}

// Concrete implementation of RoomManager
type roomManagerImpl struct {
	rooms map[string]*Room
	mutex sync.RWMutex
}

// NewRoomManager creates a new instance of RoomManager
func NewRoomManager() RoomManager {
	return &roomManagerImpl{
		rooms: make(map[string]*Room),
	}
}

// GetRoom retrieves a room by its ID
func (rm *roomManagerImpl) GetRoom(roomID string) (*Room, error) {
	rm.mutex.RLock()
	defer rm.mutex.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		return nil, errors.New("room not found")
	}
	return room, nil
}

// Additional methods to manage rooms can be added here

func (r *Room) GetMembers() []string {
	return r.Members
}
