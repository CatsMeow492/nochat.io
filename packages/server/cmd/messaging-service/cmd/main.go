package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"gitlab.com/secp/services/backend/cmd/messaging-service/internal/config"
	"gitlab.com/secp/services/backend/cmd/messaging-service/internal/handlers"
	"gitlab.com/secp/services/backend/cmd/messaging-service/internal/models"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// TODO: Implement proper origin checking for production
		return true
	},
}

func main() {
	cfg := config.LoadConfig()
	hub := models.NewHub()
	go hub.Run()

	r := mux.NewRouter()

	// WebSocket endpoint
	r.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handlers.ServeWs(hub, w, r, upgrader)
	})

	// Health check endpoint
	r.HandleFunc("/health", handlers.HealthCheck).Methods("GET")

	// TODO: Add more REST endpoints for managing rooms, users, etc.
	// r.HandleFunc("/rooms", handlers.CreateRoom).Methods("POST")
	// r.HandleFunc("/rooms/{roomID}", handlers.GetRoom).Methods("GET")
	// r.HandleFunc("/rooms/{roomID}/messages", handlers.GetMessages).Methods("GET")

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	go func() {
		log.Printf("Starting messaging service on :%s\n", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down messaging service...")

	if err := srv.Shutdown(nil); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Messaging service exited")
}