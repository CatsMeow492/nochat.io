package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"gitlab.com/secp/services/backend/cmd/signaling-service/internal/handlers"
	"gitlab.com/secp/services/backend/cmd/signaling-service/internal/models"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  128 * 1024,
	WriteBufferSize: 128 * 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

var (
	maxMessageSize = 128 * 1024
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
)

var roomManager models.RoomManager
var messageHandler *handlers.MessageHandler

func init() {
	roomManager = models.GetRoomManager()
	messageHandler = handlers.NewMessageHandler(&roomManager)
}

func handleConnection(w http.ResponseWriter, r *http.Request) {
	log.Printf("Received connection request from %s", r.RemoteAddr)

	// Upgrade connection to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Error during connection upgrade:", err)
		return
	}

	if conn == nil {
		log.Println("WebSocket connection is nil, cannot proceed")
		return
	}

	roomID := r.URL.Query().Get("room_id")
	log.Printf("Getting or creating room for %s", roomID)

	room, err := roomManager.GetOrCreateRoom(roomID)
	if err != nil {
		log.Printf("Error getting or creating room: %v", err)
		conn.Close()
		return
	}

	if room == nil {
		log.Printf("Room is nil for room ID: %s", roomID)
		conn.Close()
		return
	}

	clientUUID := models.GenerateUniqueID()
	client := room.AddClient(conn, clientUUID)
	if client == nil {
		log.Printf("Client could not be added to room: %s", roomID)
		conn.Close()
		return
	}

	log.Printf("Added client %s to room %s", clientUUID, roomID)

	// Queue the user ID message
	userIDMessage := models.Message{
		Type:    "userID",
		RoomID:  roomID,
		Content: clientUUID,
	}
	userIDMessageBytes, err := json.Marshal(userIDMessage)
	if err != nil {
		log.Printf("Error marshaling user ID message: %v", err)
	} else {
		client.Send <- userIDMessageBytes
	}

	room.Mu.Lock()
	isInitiator := room.Initiator == nil
	if isInitiator {
		room.Initiator = client
	}
	sendMessage(client, "initiatorStatus", isInitiator)
	room.Mu.Unlock()

	// Set up read and write pumps
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		readPump(client, room)
	}()

	go func() {
		defer wg.Done()
		writePump(client)
	}()

	wg.Wait()

	room.RemoveClient(client)
	// broadcastUserCount(room)
}

func checkRoomReadiness(room *models.Room, messageHandler *handlers.MessageHandler) {
	for {
		time.Sleep(10 * time.Second)

		log.Printf("Checking room readiness for room %s", room.ID)
		room.Mu.RLock()
		meetingStarted := room.MeetingStarted
		allReady := room.AllClientsReady()
		allReadyMessageSent := room.AllReadyMessageSent
		room.Mu.RUnlock()

		log.Printf("Meeting started: %t, All clients ready: %t", meetingStarted, allReady)

		if meetingStarted && allReady && !allReadyMessageSent {
			log.Printf("Meeting started and all clients are ready in room %s. Sending allReady message.", room.ID)
			messageHandler.SendAllReadyMessage(room)

			// Wait for a short duration to ensure the allReady message is sent
			time.Sleep(500 * time.Millisecond)

			log.Printf("Sending createOffer message for room %s.", room.ID)
			messageHandler.SendCreateOfferToInitiator(room)
			return
		}

		if !meetingStarted {
			log.Printf("Waiting for meeting to start in room %s", room.ID)
		}
	}
}

func readPump(client *models.Client, room *models.Room) {
	log.Printf("Starting read pump for client %s in room %s", client.UserID, client.Room.ID)
	defer func() {
		client.Conn.Close()
		log.Printf("Read pump stopped for client %s in room %s", client.UserID, client.Room.ID)
	}()

	client.Conn.SetReadLimit(int64(maxMessageSize))
	client.Conn.SetReadDeadline(time.Now().Add(pongWait))
	client.Conn.SetPongHandler(func(string) error {
		client.Conn.SetReadDeadline(time.Now().Add(pongWait))
		log.Printf("Received pong from client %s in room %s", client.UserID, room.ID)
		return nil
	})

	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			// ...existing error handling code...
			break
		}
		var parsedMessage models.Message
		log.Printf("Received message: %s", string(message))
		if err := json.Unmarshal(message, &parsedMessage); err != nil {
			log.Printf("Error parsing message: %v", err)
			continue
		}
		switch parsedMessage.Type {
		case "ready":
			log.Printf("Client %s is ready in room %s", client.UserID, room.ID)
			room.SetClientReady(client, true)
			go checkRoomReadiness(room, messageHandler)
		case "offer":
			log.Printf("Handling message type: %s, sending to message handler", parsedMessage.Type)
			messageHandler.HandleMessage(parsedMessage, client, room)
		case "answer":
			log.Printf("Handling message type: %s, sending to message handler", parsedMessage.Type)
			messageHandler.HandleMessage(parsedMessage, client, room)
		case "iceCandidate":
			log.Printf("Handling message type: %s, sending to message handler", parsedMessage.Type)
			messageHandler.HandleMessage(parsedMessage, client, room)
		case "chatMessage":
			log.Printf("Handling message type: %s, sending to message handler", parsedMessage.Type)
			messageHandler.HandleMessage(parsedMessage, client, room)
		case "startMeeting":
			log.Printf("Handling message type: %s, sending to message handler", parsedMessage.Type)
			messageHandler.HandleMessage(parsedMessage, client, room)
		}

	}
}

func writePump(client *models.Client) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		client.Conn.Close()
		log.Printf("[WritePump] Stopped for client %s", client.UserID)
	}()

	log.Printf("[WritePump] Started for client %s", client.UserID)

	for {
		select {
		case message, ok := <-client.Send:
			if !ok {
				log.Printf("[WritePump] Send channel closed for client %s", client.UserID)
				client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			log.Printf("[WritePump] Received message for client %s: %s", client.UserID, string(message))

			if err := client.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("[WritePump] Error writing to client %s: %v", client.UserID, err)
				return
			}
			log.Printf("[WritePump] Successfully wrote to client %s", client.UserID)
		}
	}
}

func broadcastUserCount(room *models.Room) {
	log.Printf("Attempting to lock room mutex for room %s", room.ID)
	room.Mu.Lock()
	log.Printf("Room mutex locked for room %s", room.ID)
	defer func() {
		room.Mu.Unlock()
		log.Printf("Room mutex unlocked for room %s", room.ID)
	}()

	log.Printf("Getting total clients count for room %s", room.ID)
	count := room.GetTotalClientsCount()
	log.Printf("Total clients count for room %s: %d", room.ID, count)

	if count != room.LastBroadcastedCount {
		log.Printf("Broadcasting user count: %d for room: %s", count, room.ID)

		message := models.Message{
			Type:    "userCount",
			RoomID:  room.ID,
			Content: fmt.Sprintf("%d", count),
		}
		broadcastMessage, err := json.Marshal(message)
		if err != nil {
			log.Printf("Error marshaling user count message: %v", err)
			return
		}
		log.Printf("Broadcasting message to room %s", room.ID)
		room.Broadcast(broadcastMessage, nil)
		log.Printf("Broadcast complete for room %s", room.ID)
		room.LastBroadcastTime = time.Now()
		room.LastBroadcastedCount = count
	}
}

func getInitiatorStatus(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room_id")
	room, err := roomManager.GetRoom(roomID)
	if err != nil {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"initiatorUUID": room.Initiator.UserID})
}

func getHandshakeStages(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room_id")
	room, err := roomManager.GetRoom(roomID)
	if err != nil {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}

	handshakeStages := map[string]interface{}{
		"initiator":    room.Initiator != nil,
		"readyClients": room.GetReadyClientsCount(),
		"totalClients": room.GetTotalClientsCount(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(handshakeStages)
}

func getRoomStatus(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room_id")
	room, err := roomManager.GetRoom(roomID)
	if err != nil {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": room.State})
}

const (
	roomCleanupInterval   = 5 * time.Minute
	roomInactiveThreshold = 30 * time.Minute
)

func cleanupRooms() {
	ticker := time.NewTicker(roomCleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		log.Printf("Starting room cleanup check...")
		rooms := roomManager.GetAllRooms()
		now := time.Now()

		if len(rooms) == 0 {
			log.Printf("No rooms to cleanup")
			continue
		}

		for _, room := range rooms {
			room.Mu.RLock()
			isEmpty := len(room.Clients) == 0
			isInactive := now.Sub(room.LastActivity) > roomInactiveThreshold
			lastActivity := room.LastActivity
			room.Mu.RUnlock()

			log.Printf("Room %s status - Empty: %v, Inactive: %v, Last Activity: %v",
				room.ID,
				isEmpty,
				isInactive,
				lastActivity)

			if isEmpty && isInactive {
				log.Printf("Cleaning up inactive room: %s (Last activity: %v, Inactive for: %v)",
					room.ID,
					lastActivity,
					now.Sub(lastActivity))

				if err := roomManager.RemoveRoom(room.ID); err != nil {
					log.Printf("Error removing room %s: %v", room.ID, err)
				} else {
					log.Printf("Successfully removed room %s", room.ID)
				}
			}
		}
	}
}

func getDebugInfo(w http.ResponseWriter, r *http.Request) {
	rooms := roomManager.GetAllRooms()
	debugInfo := make(map[string]interface{})

	for _, room := range rooms {

		roomInfo := map[string]interface{}{
			"TotalClients": room.GetTotalClientsCount(),
			"ReadyClients": room.GetReadyClientsCount(),
			"HasInitiator": room.Initiator != nil,
			"OfferCreated": room.OfferCreated,
			"State":        room.State,
		}
		debugInfo[room.ID] = roomInfo
	}
	log.Printf("Debug info: %v", debugInfo)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(debugInfo)
}

func health(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func main() {

	rdb := redis.NewClient(&redis.Options{
		Addr:     os.Getenv("REDIS_ADDR"),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       0,
	})

	ctx := context.Background()
	_, err := rdb.Ping(ctx).Result()
	if err != nil {
		log.Fatalf("Error connecting to Redis: %v", err)
	}

	// Initialize the RoomManager with the Redis client
	roomManager = models.GetRoomManager()
	roomManager.SetRedisClient(rdb)

	http.HandleFunc("/health", health)
	http.HandleFunc("/ws", handleConnection)
	http.HandleFunc("/initiator", getInitiatorStatus)
	http.HandleFunc("/handshake", getHandshakeStages)
	http.HandleFunc("/roomStatus", getRoomStatus)
	http.HandleFunc("/debug", getDebugInfo)

	go cleanupRooms()

	log.Println("Signaling service started on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func sendMessage(client *models.Client, messageType string, content interface{}) {
	message := models.Message{
		Type:    messageType,
		RoomID:  client.Room.ID,
		Content: content,
	}
	messageBytes, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling message: %v", err)
		return
	}
	client.Send <- messageBytes
}
