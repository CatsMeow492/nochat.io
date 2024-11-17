package handlers

import (
	"encoding/json"
	"net/http"
)

// HealthCheck returns the health status of the service.
func HealthCheck(w http.ResponseWriter, r *http.Request) {
	status := struct {
		Status string `json:"status"`
	}{
		Status: "ok",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}
