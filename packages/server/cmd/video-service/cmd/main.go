package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"gitlab.com/secp/services/backend/cmd/video-service/internal/config"
	"gitlab.com/secp/services/backend/cmd/video-service/internal/handlers"
	"gitlab.com/secp/services/backend/cmd/video-service/internal/models"
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

	// WebSocket endpoint for signaling
	r.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handlers.ServeWs(hub, w, r)
	}).Queries("roomId", "{roomId}")

	// REST endpoints
	r.HandleFunc("/rooms", handlers.CreateRoom).Methods("POST")
	r.HandleFunc("/rooms/{roomID}", handlers.GetRoom).Methods("GET")
	r.HandleFunc("/rooms/{roomID}/join", handlers.JoinRoom).Methods("POST")
	r.HandleFunc("/health", handlers.HealthCheck).Methods("GET")

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	go func() {
		log.Printf("Starting video service on :%s\n", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down video service...")

	if err := srv.Shutdown(nil); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Video service exited")
}
