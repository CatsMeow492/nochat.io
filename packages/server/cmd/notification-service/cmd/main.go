package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"reflect"
	"syscall"

	"github.com/gorilla/mux"
	"github.com/CatsMeow492/nochat.io/packages/server/cmd/notification-service/internal/config"
	"github.com/CatsMeow492/nochat.io/packages/server/cmd/notification-service/internal/models"
	"github.com/redis/go-redis/v9"
)

// Define a new type in the current package
type NotificationServiceWrapper struct {
	*models.NotificationService
}

// Define the SendNotification method on NotificationServiceWrapper
func (s *NotificationServiceWrapper) SendNotification(w http.ResponseWriter, r *http.Request) {
	var req models.NotificationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Access the unexported sendNotification method using reflection
	sendNotificationMethod := reflect.ValueOf(s.NotificationService).MethodByName("sendNotification")
	if !sendNotificationMethod.IsValid() {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	results := sendNotificationMethod.Call([]reflect.Value{reflect.ValueOf(req)})
	if len(results) > 0 && !results[0].IsNil() {
		err := results[0].Interface().(error)
		http.Error(w, "Failed to send notification: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Notification sent successfully"))
}

// Move this method to the wrapper type
func (s *NotificationServiceWrapper) HealthCheck(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	_, err := s.RedisClient.Ping(ctx).Result()
	if err != nil {
		log.Printf("Health check failed: %v", err)
		http.Error(w, "Service unhealthy", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Service healthy"))
}

func main() {
	cfg := config.LoadConfig()
	service := &NotificationServiceWrapper{
		NotificationService: &models.NotificationService{
			RedisClient: redis.NewClient(&redis.Options{ // This should now work correctly
				Addr:     cfg.RedisAddr,
				Password: cfg.RedisPassword,
			}),
		},
	}

	r := mux.NewRouter()
	r.HandleFunc("/send", service.SendNotification).Methods("POST")
	r.HandleFunc("/health", service.HealthCheck).Methods("GET")

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	go func() {
		log.Println("Starting notification service on :" + cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down notification service...")

	// Graceful shutdown
	if err := srv.Shutdown(nil); err != nil { // TODO: Fix this
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Notification service exited")
}
