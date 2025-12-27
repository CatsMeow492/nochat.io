package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/redis/go-redis/v9"
	"github.com/kindlyrobotics/nochat/cmd/room-service/internal/models"
)

// CreateRoom handles the creation of a new room.
func CreateRoom(rdb *redis.Client, manager *models.RoomManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var roomRequest struct {
			Name string `json:"name"`
		}
		err := json.NewDecoder(r.Body).Decode(&roomRequest)
		if err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		// Generate a unique ID for the new room
		roomID := models.GenerateUniqueID()
		// Create the room using RoomManager
		createdRoom, err := (*manager).CreateRoom(roomID, roomRequest.Name, "system")
		if err != nil {
			http.Error(w, "Failed to create room", http.StatusInternalServerError)
			return
		}

		// Save the room to Redis
		err = createdRoom.Save(r.Context(), rdb)
		if err != nil {
			http.Error(w, "Failed to save room", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(createdRoom)
	}
}
