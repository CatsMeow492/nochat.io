package handlers

import (
	"encoding/json"
	"net/http"
	"github.com/gorilla/mux"
)

func CreateRoom(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement room creation logic
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"status": "Room created"})
}

func GetRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["roomID"]
	// TODO: Implement room retrieval logic
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"roomID": roomID})
}

func JoinRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["roomID"]
	// TODO: Implement room joining logic
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "Joined room", "roomID": roomID})
}

func HealthCheck(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Video service is healthy"))
}