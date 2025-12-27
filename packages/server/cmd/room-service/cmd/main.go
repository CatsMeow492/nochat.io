package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/gorilla/mux"
	"github.com/redis/go-redis/v9"
	"github.com/kindlyrobotics/nochat/cmd/room-service/internal/config"
	"github.com/kindlyrobotics/nochat/cmd/room-service/internal/handlers"
	"github.com/kindlyrobotics/nochat/cmd/room-service/internal/models"
)

func main() {
	// Load configuration (implement config.LoadConfig accordingly)
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize Redis client
	rdb := redis.NewClient(&redis.Options{
		Addr: cfg.RedisAddr,
	})

	// Initialize RoomManager
	roomManager := models.NewRoomManager()

	// Create a default room
	defaultRoomID := models.GenerateUniqueID()
	defaultRoom := models.NewRoom(defaultRoomID, "Default Room", "system")
	err = defaultRoom.Save(context.Background(), rdb)
	if err != nil {
		log.Fatalf("Failed to save default room: %v", err)
	}

	createdRoom, err := roomManager.CreateRoom(defaultRoom.ID, defaultRoom.Name, defaultRoom.CreatedBy)
	if err != nil {
		log.Fatalf("Failed to add default room to manager: %v", err)
	}
	log.Printf("Created default room with ID: %s", createdRoom.ID)

	// Initialize router
	r := mux.NewRouter()

	// WebSocket handler
	r.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handlers.ServeWs(w, r)
	})

	// Health check handler (implement handlers.HealthCheck accordingly)
	r.HandleFunc("/health", handlers.HealthCheck).Methods("GET")
	// Room creation handler
	r.HandleFunc("/rooms", handlers.CreateRoom(rdb, &roomManager)).Methods("POST")

	// Initialize and start server
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	go func() {
		log.Printf("Starting room service on :%s\n", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down room service...")

	if err := srv.Shutdown(context.Background()); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Room service exited")
}
