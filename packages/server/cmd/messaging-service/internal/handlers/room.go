package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/CatsMeow492/nochat.io/packages/server/cmd/messaging-service/internal/models"
)

func CreateRoom(w http.ResponseWriter, r *http.Request) {
	var room models.Room
	err := json.NewDecoder(r.Body).Decode(&room)
	if err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// TODO: Validate room data
	// TODO: Save room to database

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(room)
}
