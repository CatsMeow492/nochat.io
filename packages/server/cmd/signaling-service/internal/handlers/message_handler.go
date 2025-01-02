package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"gitlab.com/secp/services/backend/cmd/signaling-service/internal/models"
)

type MessageHandler struct {
	RoomManager *models.RoomManager
}

func NewMessageHandler(roomManager *models.RoomManager) *MessageHandler {
	return &MessageHandler{RoomManager: roomManager}
}

func (h *MessageHandler) HandleMessage(msg models.Message, client *models.Client, room *models.Room) {
	log.Printf("[%s:%s] from:%s", msg.Type, room.ID, client.UserID)

	switch msg.Type {
	case "joinRoom":
		h.handleJoinRoom(msg, client, room)
	case "startMeeting":
		h.handleStartMeeting(msg, client, room)
	case "offer":
		h.handleOffer(msg, client, room)
	case "answer":
		content, ok := msg.Content.(map[string]interface{})
		if !ok {
			log.Printf("Error: answer content is not a map")
			return
		}
		targetPeerID, ok := content["targetPeerID"].(string)
		if !ok {
			log.Printf("Error: targetPeerID not found in answer")
			return
		}
		log.Printf("[ANSWER] Received answer message from client %s to %s: %+v", client.UserID, targetPeerID, msg)
		h.handleAnswer(msg, client, room)
	case "iceCandidate":
		h.handleICECandidate(msg, client, room)
	case "chatMessage":
		h.handleChatMessage(msg, client, room)
	default:
		h.handleUnknownMessage(msg, client, room)
	}
}

func (h *MessageHandler) handleReady(msg models.Message, client *models.Client, room *models.Room) {
	var readyData struct {
		UserId string `json:"userId"`
		Status string `json:"status"`
	}
	contentBytes, ok := msg.Content.([]byte)
	if !ok {
		contentStr, ok := msg.Content.(string)
		if !ok {
			log.Printf("Error: Content is neither []byte nor string")
			return
		}
		contentBytes = []byte(contentStr)
	}
	if err := json.Unmarshal(contentBytes, &readyData); err != nil {
		log.Printf("Error unmarshaling ready message: %v", err)
		return
	}
	isReady := readyData.Status == "ready"
	room.SetClientReady(client, isReady)

}

func (h *MessageHandler) handleOffer(msg models.Message, client *models.Client, room *models.Room) {
	content, ok := msg.Content.(map[string]interface{})
	if !ok {
		log.Printf("[OFFER:ERROR] Content is not a map: %T", msg.Content)
		return
	}

	// Log all available keys in content for debugging
	log.Printf("[OFFER:DEBUG] Available content keys: %v", getKeys(content))

	// Check both possible property names
	var targetPeerID string
	if id, ok := content["targetPeerID"].(string); ok {
		targetPeerID = id
	} else if id, ok := content["targetPeerId"].(string); ok {
		targetPeerID = id
	} else if id, ok := content["targetPeer"].(string); ok {
		targetPeerID = id
	} else {
		log.Printf("[OFFER:ERROR] targetPeerID not found. Available keys: %v", getKeys(content))
		return
	}

	// Validate SDP exists and log detailed info
	sdpContent, hasSDP := content["sdp"].(map[string]interface{})
	if !hasSDP {
		log.Printf("[OFFER:ERROR] Missing or invalid SDP for peer %s. SDP type: %T", targetPeerID, content["sdp"])
		return
	}

	sdpStr, hasSDPString := sdpContent["sdp"].(string)
	if !hasSDPString {
		log.Printf("[OFFER:ERROR] Invalid SDP string for peer %s. Available SDP keys: %v", targetPeerID, getKeys(sdpContent))
		return
	}

	// Log SDP validation details
	log.Printf("[OFFER:DEBUG] SDP validation for peer %s:", targetPeerID)
	log.Printf("  - Has m=audio: %v", strings.Contains(sdpStr, "m=audio"))
	log.Printf("  - Has m=video: %v", strings.Contains(sdpStr, "m=video"))
	log.Printf("  - SDP length: %d bytes", len(sdpStr))
	log.Printf("  - First line: %s", strings.Split(sdpStr, "\n")[0])

	content["fromPeerID"] = client.UserID

	// Store the offer state before forwarding
	room.StoreSignalingState(targetPeerID, client.UserID, "offer", content)

	// Forward the offer
	targetPeer, exists := room.Clients[targetPeerID]
	if !exists {
		log.Printf("[OFFER:ERROR] Target peer %s not found in room", targetPeerID)
		return
	}

	offerMsg := models.Message{
		Type:    "offer",
		RoomID:  room.ID,
		Content: content,
	}

	messageBytes, err := json.Marshal(offerMsg)
	if err != nil {
		log.Printf("[OFFER:ERROR] Failed to marshal offer message: %v", err)
		return
	}

	log.Printf("[OFFER:INFO] Forwarding offer from %s to %s in room %s",
		client.UserID[:8], targetPeerID[:8], room.ID)
	targetPeer.Send <- messageBytes

	// Send any queued ICE candidates now that the offer is processed
	queuedCandidates := room.GetQueuedCandidates(targetPeerID, client.UserID)
	if len(queuedCandidates) > 0 {
		log.Printf("[OFFER:INFO] Sending %d queued ICE candidates to %s", len(queuedCandidates), targetPeerID[:8])
		for _, candidateContent := range queuedCandidates {
			iceMsg := models.Message{
				Type:    "iceCandidate",
				RoomID:  room.ID,
				Content: candidateContent,
			}
			if messageBytes, err := json.Marshal(iceMsg); err == nil {
				targetPeer.Send <- messageBytes
			}
		}
	}
}

func (h *MessageHandler) handleAnswer(msg models.Message, client *models.Client, room *models.Room) {
	content, ok := msg.Content.(map[string]interface{})
	if !ok {
		log.Printf("Error: answer content is not a map")
		return
	}

	// Log only essential information, not the SDP
	log.Printf("[ANSWER] Processing answer from client %s", client.UserID[:8])

	// Check for target peer ID in various formats
	var targetPeerID string
	if id, ok := content["targetPeerId"].(string); ok {
		targetPeerID = id
	} else if id, ok := content["targetPeerID"].(string); ok {
		targetPeerID = id
	} else if id, ok := content["targetPeer"].(string); ok {
		targetPeerID = id
	}

	if targetPeerID == "" {
		// Try to find the peer from signaling state
		states := room.GetSignalingStates(client.UserID)
		if len(states) > 0 {
			// Use the most recent offer's peer ID
			targetPeerID = states[len(states)-1].PeerID
			log.Printf("[ANSWER] Retrieved target peer %s from signaling state", targetPeerID)
		} else {
			log.Printf("[ANSWER] No target peer ID found in answer or signaling state")
			return
		}
	}

	// Don't queue answers to self
	if targetPeerID == client.UserID {
		log.Printf("[ANSWER] Ignoring self-targeted from %s", client.UserID[:8])
		return
	}

	// Add fromPeerId to content
	content["fromPeerId"] = client.UserID

	targetPeer, exists := room.Clients[targetPeerID]
	if !exists {
		log.Printf("[ANSWER] Target peer %s not found in room", targetPeerID[:8])
		return
	}

	answerMsg := models.Message{
		Type:    "answer",
		RoomID:  room.ID,
		Content: content,
	}

	messageBytes, err := json.Marshal(answerMsg)
	if err != nil {
		log.Printf("Error marshaling answer message: %v", err)
		return
	}

	log.Printf("[ANSWER] from:%s to:%s room:%s", client.UserID[:8], targetPeerID[:8], room.ID)
	targetPeer.Send <- messageBytes
}

func (h *MessageHandler) handleICECandidate(msg models.Message, client *models.Client, room *models.Room) {
	content, ok := msg.Content.(map[string]interface{})
	if !ok {
		log.Printf("[ICE:ERROR] Invalid content type: %T", msg.Content)
		return
	}

	// Log all available keys for debugging
	log.Printf("[ICE:DEBUG] Available content keys: %v", getKeys(content))

	// Check for target peer ID in various formats
	var targetPeerID string
	if id, ok := content["targetPeerId"].(string); ok {
		targetPeerID = id
	} else if id, ok := content["targetPeerID"].(string); ok {
		targetPeerID = id
	} else if id, ok := content["targetPeer"].(string); ok {
		targetPeerID = id
	}

	if targetPeerID == "" {
		log.Printf("[ICE:ERROR] Missing target peer ID. Available keys: %v", getKeys(content))
		return
	}

	// Prevent self-targeting of ICE candidates
	if targetPeerID == client.UserID {
		log.Printf("[ICE:SKIP] Ignoring self-targeted candidate from %s", client.UserID[:8])
		return
	}

	// Add fromPeerId to content
	content["fromPeerId"] = client.UserID

	// Check if we have a valid signaling state for this peer
	if !room.HasPendingOffer(targetPeerID, client.UserID) {
		log.Printf("[ICE:QUEUE] No pending offer found for peer %s -> %s, queueing candidate",
			client.UserID[:8], targetPeerID[:8])
		room.QueueICECandidate(targetPeerID, client.UserID, content)
		return
	}

	// Validate candidate structure
	candidate, ok := content["candidate"].(map[string]interface{})
	if !ok {
		log.Printf("[ICE:ERROR] Invalid candidate structure: %T", content["candidate"])
		return
	}

	log.Printf("[ICE:DEBUG] Candidate details for %s -> %s:", client.UserID[:8], targetPeerID[:8])
	log.Printf("  - Type: %v", candidate["type"])
	log.Printf("  - Protocol: %v", candidate["protocol"])
	log.Printf("  - Foundation: %v", candidate["foundation"])

	iceMsg := models.Message{
		Type:    "iceCandidate",
		RoomID:  room.ID,
		Content: content,
	}

	if targetPeer, exists := room.Clients[targetPeerID]; exists {
		messageBytes, err := json.Marshal(iceMsg)
		if err != nil {
			log.Printf("[ICE:ERROR] Failed to marshal ICE message: %v", err)
			return
		}
		targetPeer.Send <- messageBytes
		log.Printf("[ICE:INFO] Forwarded candidate from %s to %s", client.UserID[:8], targetPeerID[:8])
	} else {
		log.Printf("[ICE:ERROR] Target peer not found: %s", targetPeerID[:8])
	}
}

func (h *MessageHandler) handleInitiatorStatus(msg models.Message, client *models.Client, room *models.Room) {
	isInitiator := room.Initiator == client
	jsonMessage, err := json.Marshal(models.Message{Type: "initiatorStatus", Content: fmt.Sprintf("%t", isInitiator)})
	if err != nil {
		log.Printf("Error marshaling message: %v", err)
		return
	}
	client.Send <- jsonMessage
}

func (h *MessageHandler) handleChatMessage(msg models.Message, client *models.Client, room *models.Room) {
	// Parse the chat message
	var chatMessage models.ChatMessage
	contentBytes, err := json.Marshal(msg.Content)
	if err != nil {
		log.Printf("Error marshaling chat content: %v", err)
		return
	}

	if err := json.Unmarshal(contentBytes, &chatMessage); err != nil {
		log.Printf("Error unmarshaling chat message: %v", err)
		return
	}

	// Add server-side timestamp if not present
	if chatMessage.Timestamp == "" {
		chatMessage.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	// Ensure sender info is correct
	chatMessage.Sender = client.UserID
	chatMessage.RoomID = room.ID

	// Create broadcast message
	broadcastMsg := models.Message{
		Type:    "chatMessage",
		RoomID:  room.ID,
		Content: chatMessage,
	}

	// Marshal the message
	messageBytes, err := json.Marshal(broadcastMsg)
	if err != nil {
		log.Printf("Error marshaling broadcast message: %v", err)
		return
	}

	// Broadcast to all clients in the room
	room.Broadcast(messageBytes, nil)
	log.Printf("Chat message broadcasted in room %s from user %s", room.ID, client.UserID)
}

func (h *MessageHandler) handleRequestInitialState(msg models.Message, client *models.Client, room *models.Room) {
	log.Printf("Received requestInitialState message from client %s in room: %s", client.UserID, room.ID)
	isInitiator := room.Initiator == client
	initialState := models.InitialState{
		UserID:      client.UserID,
		IsInitiator: isInitiator,
		UserCount:   room.GetTotalClientsCount(),
	}
	initialStateBytes, err := json.Marshal(initialState)
	if err != nil {
		log.Printf("Error marshaling initial state: %v", err)
		return
	}
	initialStateMessage := models.Message{
		Type:    "initialState",
		RoomID:  room.ID,
		Content: string(initialStateBytes),
	}
	messageBytes, err := json.Marshal(initialStateMessage)
	if err != nil {
		log.Printf("Error marshaling initial state message: %v", err)
		return
	}
	client.Send <- messageBytes
	log.Printf("Sent initial state to client %s: %s", client.UserID, string(messageBytes))
}

func (h *MessageHandler) handleUnknownMessage(msg models.Message, client *models.Client, room *models.Room) {
	log.Printf("Unhandled message type: %s", msg.Type)
	log.Printf("Full message: %+v", msg)
	client.Send <- []byte(fmt.Sprintf(`{"type":"error","roomID":"%s","content":"Unhandled message type: %s"}`, room.ID, msg.Type))
}

func (h *MessageHandler) handleStartMeeting(msg models.Message, client *models.Client, room *models.Room) {
	// First, update room state
	room.MeetingStarted = true
	room.State = "started"

	// Broadcast meeting started to everyone
	startMsg := models.Message{
		Type:    "startMeeting",
		RoomID:  room.ID,
		Content: true,
	}
	messageBytes, _ := json.Marshal(startMsg)
	room.Broadcast(messageBytes, nil)

	// Get all clients sorted by their IDs
	sortedClients := room.GetSortedClients()

	// For each client, determine their target peers based on ID comparison
	for _, client := range sortedClients {
		// Only get peers with larger IDs to prevent duplicate connections
		peers := room.GetTargetPeerIDs(client.UserID)

		if len(peers) > 0 {
			createOfferMsg := models.Message{
				Type:   "createOffer",
				RoomID: room.ID,
				Content: map[string]interface{}{
					"peers": peers,
				},
			}
			messageBytes, _ := json.Marshal(createOfferMsg)
			client.Send <- messageBytes
			log.Printf("Sent createOffer to client %s with peers: %v", client.UserID[:8], peers)
		}
	}
}

func (h *MessageHandler) SendAllReadyMessage(room *models.Room) {
	log.Println("All clients are ready, sending allReady message")
	readyMessage := models.Message{
		Type:    "allReady",
		RoomID:  room.ID,
		Content: "All clients are ready",
	}
	readyMessageBytes, _ := json.Marshal(readyMessage)
	room.Broadcast(readyMessageBytes, nil)
	room.AllReadyMessageSent = true
}

func (h *MessageHandler) SendCreateOfferToInitiator(room *models.Room) {
	if room.Initiator != nil {
		log.Println("Sending createOffer message to initiator")
		initiatorMsg := models.Message{
			Type:    "createOffer",
			RoomID:  room.ID,
			Content: "Please create an offer",
		}
		initiatorMsgBytes, _ := json.Marshal(initiatorMsg)
		room.Initiator.Send <- initiatorMsgBytes
	}
}

func (h *MessageHandler) handlePing(msg models.Message, client *models.Client, room *models.Room) {
	log.Printf("Received ping message from client %s in room: %s", client.UserID, room.ID)

	pongMessage := models.Message{
		Type:   "pong",
		RoomID: room.ID,
		Content: map[string]interface{}{
			"userId":      client.UserID,
			"isInitiator": room.Initiator == client,
			"clientCount": room.GetTotalClientsCount(),
		},
	}

	pongMessageBytes, err := json.Marshal(pongMessage)
	if err != nil {
		log.Printf("Error marshaling pong message: %v", err)
		return
	}

	client.Send <- pongMessageBytes
	log.Printf("Sent pong message to client %s in room: %s", client.UserID, room.ID)
}

func (h *MessageHandler) handlePong(msg models.Message, client *models.Client, room *models.Room) {
	log.Printf("Received pong message from client %s in room: %s", client.UserID, room.ID)

	contentJSON, err := json.Marshal(msg.Content)
	if err != nil {
		log.Printf("Error marshaling pong content: %v", err)
	} else {
		log.Printf("Pong content: %s", string(contentJSON))
	}

}

func broadcastToRoom(room *models.Room, messageType string, content interface{}, excludeClient *models.Client) {
	message := models.Message{
		Type:    messageType,
		RoomID:  room.ID,
		Content: content,
	}
	broadcastMessage, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling %s message: %v", messageType, err)
		return
	}

	room.Broadcast(broadcastMessage, excludeClient)
}

func toString(v interface{}) string {
	switch v := v.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			log.Printf("Error marshaling to string: %v", err)
			return ""
		}
		return string(b)
	}
}

func (h *MessageHandler) BroadcastUserCount(room *models.Room) {
	count := room.GetTotalClientsCount()
	message := models.Message{
		Type:    "userCount",
		RoomID:  room.ID,
		Content: fmt.Sprintf("%d", count),
	}

	messageBytes, err := json.Marshal(message)
	if err != nil {
		log.Printf("[ERROR] Error marshaling user count message: %v", err)
		return
	}

	log.Printf("[DEBUG] Broadcasting userCount message: %s", string(messageBytes))
	room.Broadcast(messageBytes, nil)
}

func (h *MessageHandler) SendInitialRoomState(client *models.Client, room *models.Room) {
	log.Printf("[DEBUG] Preparing initial room state for client %s in room %s", client.UserID, room.ID)
	userCountMsg := models.Message{
		Type:    "userCount",
		RoomID:  room.ID,
		Content: fmt.Sprintf("%d", room.GetTotalClientsCount()),
	}

	messageBytes, err := json.Marshal(userCountMsg)
	if err != nil {
		log.Printf("[ERROR] Error marshaling initial user count message: %v", err)
		return
	}

	log.Printf("[DEBUG] Sending initial userCount message: %s", string(messageBytes))

	// Send initiator status
	isInitiator := room.Initiator == client
	log.Printf("[DEBUG] Sending initiatorStatus message to client %s (isInitiator: %v)", client.UserID, isInitiator)
	initiatorMsg := models.MarshalMessage("initiatorStatus", room.ID, isInitiator)

	log.Printf("[DEBUG] Attempting to send to client channel for %s", client.UserID)
	select {
	case client.Send <- initiatorMsg:
		log.Printf("[DEBUG] Successfully queued initiatorStatus message for client %s", client.UserID)
	default:
		log.Printf("[ERROR] Failed to queue initiatorStatus message for client %s - channel full", client.UserID)
	}

	client.Send <- messageBytes
}

func (h *MessageHandler) BroadcastUserList(room *models.Room) {
	log.Printf("[DEBUG] Broadcasting user list for room %s", room.ID)
	users := room.GetUserList()
	log.Printf("[DEBUG] Current users in room: %v", users)

	message := models.Message{
		Type:   "userList",
		RoomID: room.ID,
		Content: map[string]interface{}{
			"users": users,
		},
	}

	messageBytes, err := json.Marshal(message)
	if err != nil {
		log.Printf("[ERROR] Error marshaling user list message: %v", err)
		return
	}

	log.Printf("[DEBUG] Broadcasting userList message: %s", string(messageBytes))
	room.Broadcast(messageBytes, nil)
}

func (h *MessageHandler) BroadcastToRoom(room *models.Room, message []byte) {
	room.Broadcast(message, nil)
}

func truncateSDP(sdp string) string {
	lines := strings.Split(sdp, "\n")
	return fmt.Sprintf("[SDP:%d lines]", len(lines))
}

// Helper function to get map keys
func getKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func (h *MessageHandler) handleJoinRoom(msg models.Message, client *models.Client, room *models.Room) {
	log.Printf("[JOIN] Client %s joining room %s", client.UserID, room.ID)

	// Send initial state to the joining client with logging
	userIDMsg := models.MarshalMessage("userID", room.ID, client.UserID)
	log.Printf("[DEBUG] Sending userID message: %s", string(userIDMsg))
	client.Send <- userIDMsg

	isInitiator := room.Initiator == client
	initiatorMsg := models.MarshalMessage("initiatorStatus", room.ID, isInitiator)
	log.Printf("[DEBUG] Sending initiatorStatus message: %s", string(initiatorMsg))
	client.Send <- initiatorMsg

	// Broadcast updated room state with logging
	log.Printf("[DEBUG] Broadcasting room state updates")
	h.BroadcastUserCount(room)
	h.BroadcastUserList(room)
}
