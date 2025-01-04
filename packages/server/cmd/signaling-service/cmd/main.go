package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/CatsMeow492/nochat.io/packages/server/cmd/signaling-service/internal/handlers"
	"github.com/CatsMeow492/nochat.io/packages/server/cmd/signaling-service/internal/models"
	"github.com/redis/go-redis/v9"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  128 * 1024,
	WriteBufferSize: 128 * 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

var (
	maxMessageSize = 1024 * 1024
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
)

var (
	roomManager    *models.RoomManagerImpl
	messageHandler *handlers.MessageHandler
)

func init() {
	rdb := redis.NewClient(&redis.Options{
		Addr:     os.Getenv("REDIS_ADDR"),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       0,
	})

	roomManager = models.GetRoomManager()
	roomManager.SetRedisClient(rdb)
	messageHandler = handlers.NewMessageHandler(roomManager, rdb)
}

func handleConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ERROR] Failed to upgrade connection: %v", err)
		return
	}

	clientUUID := r.URL.Query().Get("user_id")
	if clientUUID == "" {
		log.Printf("[ERROR] No user_id provided in query parameters")
		conn.Close()
		return
	}

	log.Printf("[INFO] WebSocket connection established for client %s", r.RemoteAddr)

	// Create a client with buffered channel
	client := &models.Client{
		UserID: clientUUID,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		Done:   make(chan struct{}),
	}

	// Start the write pump in a goroutine
	go writePump(client)

	// Send initial userID message
	log.Printf("[DEBUG] Sending initial userID message to client %s", clientUUID)
	select {
	case client.Send <- models.MarshalMessage("userID", "", clientUUID):
		log.Printf("[DEBUG] Successfully sent initial userID message")
	default:
		log.Printf("[ERROR] Failed to send initial userID message - channel full")
		close(client.Done)
		return
	}

	// Handle first message to join room
	_, message, err := client.Conn.ReadMessage()
	if err != nil {
		log.Printf("[ERROR] Failed to read initial message: %v", err)
		close(client.Done)
		return
	}

	var parsedMessage models.Message
	if err := json.Unmarshal(message, &parsedMessage); err != nil {
		log.Printf("[ERROR] Error parsing message: %v", err)
		close(client.Done)
		return
	}

	if parsedMessage.Type != "joinRoom" {
		log.Printf("[ERROR] First message must be joinRoom, got: %s", parsedMessage.Type)
		close(client.Done)
		return
	}

	content, ok := parsedMessage.Content.(map[string]interface{})
	if !ok {
		log.Printf("[ERROR] Invalid joinRoom message content")
		close(client.Done)
		return
	}

	roomID, ok := content["roomId"].(string)
	if !ok {
		log.Printf("[ERROR] No roomId in joinRoom message")
		close(client.Done)
		return
	}

	// Get or create the room
	room, err := roomManager.GetOrCreateRoom(roomID)
	if err != nil {
		log.Printf("[ERROR] Error getting/creating room: %v", err)
		close(client.Done)
		return
	}

	// Important: Keep using the same client instance
	client.Room = room

	// Update room's client map with our existing client instance
	room.Mu.Lock()
	room.Clients[clientUUID] = client
	// Set initiator if this is the first client
	if len(room.Clients) == 1 {
		room.Initiator = client
		log.Printf("[DEBUG] Set client %s as initiator for room %s (first client)", clientUUID, roomID)
	}
	room.Mu.Unlock()

	log.Printf("[DEBUG] Client %s joined room %s successfully. Is initiator: %v",
		clientUUID, roomID, room.Initiator == client)

	// Send initial room state using the same client instance
	messageHandler.SendInitialRoomState(client, room)
	messageHandler.BroadcastUserCount(room)
	messageHandler.BroadcastUserList(room)

	// Start read pump and block until it's done
	readPump(client, room)
}

func readPump(client *models.Client, room *models.Room) {
	log.Printf("Starting read pump for client %s in room %s", client.UserID, client.Room.ID)
	defer func() {
		client.Conn.Close()
		room.RemoveClient(client)
		messageHandler.BroadcastUserCount(room)
		messageHandler.BroadcastUserList(room)
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
			messageHandler.BroadcastUserCount(room)
			break
		}
		var parsedMessage models.Message
		// only log the first 25 characters of the message
		log.Printf("Received message type: %s", getMessageType(message))
		if err := json.Unmarshal(message, &parsedMessage); err != nil {
			log.Printf("Error parsing message: %v", err)
			continue
		}
		switch parsedMessage.Type {
		case "ready":
			log.Printf("Client %s is ready in room %s", client.UserID, room.ID)
			room.SetClientReady(client, true)
			messageHandler.BroadcastUserCount(room)
			messageHandler.BroadcastUserList(room)
		case "offer":
			log.Printf("Handling message type: %s, sending to message handler", parsedMessage.Type)
			messageHandler.HandleMessage(parsedMessage, client, room)
		case "answer":
			log.Printf("[answer:new] from:%s", client.UserID)
			if content, ok := parsedMessage.Content.(map[string]interface{}); ok && content != nil {
				targetPeerID, ok1 := content["targetPeerID"].(string)
				fromPeerID, ok2 := content["fromPeerID"].(string)
				sdp, ok3 := content["sdp"].(map[string]interface{})

				log.Printf("Answer validation: targetPeerID=%v, fromPeerID=%v, hasSDP=%v", ok1, ok2, ok3)
				log.Printf("Answer received with SDP from %s to %s", fromPeerID, targetPeerID)

				if !ok1 || !ok2 || !ok3 || targetPeerID == "" || fromPeerID == "" || sdp == nil {
					log.Printf("Invalid answer message content: %+v")
					continue
				}

				log.Printf("Forwarding answer from %s to %s", fromPeerID, targetPeerID)
				messageHandler.HandleMessage(parsedMessage, client, room)
			} else {
				log.Printf("Invalid answer message type: expected map[string]interface{}, got %T", parsedMessage.Content)
			}
		case "iceCandidate":
			log.Printf("Handling message type: %s, sending to message handler", parsedMessage.Type)
			messageHandler.HandleMessage(parsedMessage, client, room)
		case "chatMessage":
			log.Printf("Handling message type: %s, sending to message handler", parsedMessage.Type)
			messageHandler.HandleMessage(parsedMessage, client, room)
		case "startMeeting":
			log.Printf("Handling startMeeting message for room %s", room.ID)
			messageHandler.HandleMessage(parsedMessage, client, room)
		}

	}
}

func writePump(client *models.Client) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		log.Printf("[DEBUG] WritePump stopped for client %s", client.UserID)
		client.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-client.Send:
			log.Printf("[DEBUG] WritePump received message for client %s", client.UserID)

			client.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				log.Printf("[DEBUG] Send channel closed for client %s", client.UserID)
				client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := client.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				log.Printf("[ERROR] Failed to get next writer for client %s: %v", client.UserID, err)
				return
			}

			log.Printf("[DEBUG] Writing message to client %s: %s", client.UserID, string(message))
			_, err = w.Write(message)
			if err != nil {
				log.Printf("[ERROR] Failed to write message for client %s: %v", client.UserID, err)
				return
			}

			if err := w.Close(); err != nil {
				log.Printf("[ERROR] Failed to close writer for client %s: %v", client.UserID, err)
				return
			}
			log.Printf("[DEBUG] Successfully wrote message to client %s", client.UserID)

		case <-ticker.C:
			client.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("[ERROR] Failed to write ping message for client %s: %v", client.UserID, err)
				return
			}
			log.Printf("[DEBUG] Sent ping to client %s", client.UserID)

		case <-client.Done:
			log.Printf("[DEBUG] Client %s done, stopping writePump", client.UserID)
			return
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
		rooms := roomManager.GetAllRooms()
		now := time.Now()

		for _, room := range rooms {
			isEmpty := len(room.Clients) == 0
			isInactive := now.Sub(room.LastActivity) > roomInactiveThreshold

			if isEmpty || isInactive {
				roomManager.RemoveRoom(room.ID)
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

	// Initialize room manager and set Redis client
	roomManager.SetRedisClient(rdb)

	// Initialize message handler with Redis client
	messageHandler = handlers.NewMessageHandler(roomManager, rdb)

	// Set up HTTP server with CORS middleware
	r := mux.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	})

	// WebSocket endpoint
	r.HandleFunc("/ws/", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[DEBUG] WebSocket request received: %s", r.URL.Path)
		handleConnection(w, r)
	})

	// Regular HTTP endpoints
	r.HandleFunc("/health", health)
	r.HandleFunc("/debug", getDebugInfo)
	r.HandleFunc("/handshake-stages", getHandshakeStages)
	r.HandleFunc("/room-status", getRoomStatus)
	r.HandleFunc("/initiator-status", getInitiatorStatus)

	// Start room cleanup goroutine
	go cleanupRooms()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Handler:      r,
		Addr:         ":" + port,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	log.Printf("Starting server on port %s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
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

func getUserList(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room_id")
	room, err := roomManager.GetRoom(roomID)
	if err != nil {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(room.GetUserList())
}

func truncateMessage(msg string, length int) string {
	if len(msg) > length {
		return msg[:length] + "..."
	}
	return msg
}

func truncateSDP(sdp map[string]interface{}) string {
	if sdpContent, ok := sdp["sdp"].(map[string]interface{}); ok {
		return fmt.Sprintf("[SDP content with %d parameters]", len(sdpContent))
	}
	return "[SDP content]"
}

func getMessageType(message []byte) string {
	var msg struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(message, &msg); err != nil {
		return "unknown"
	}
	return msg.Type
}
