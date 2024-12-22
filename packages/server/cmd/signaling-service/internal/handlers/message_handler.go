package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

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
		log.Printf("Error: offer content is not a map")
		return
	}

	// Check both possible property names
	var targetPeerID string
	if id, ok := content["targetPeerID"].(string); ok {
		targetPeerID = id
	} else if id, ok := content["targetPeerId"].(string); ok {
		targetPeerID = id
	} else if id, ok := content["targetPeer"].(string); ok {
		targetPeerID = id
	} else {
		log.Printf("Error: targetPeerID/targetPeerId not found in offer. Available keys: %v", getKeys(content))
		return
	}

	// Validate SDP exists and log concise info
	if sdp, ok := content["sdp"].(map[string]interface{}); ok {
		if sdpStr, ok := sdp["sdp"].(string); ok {
			log.Printf("[OFFER] SDP validation: %s", truncateSDP(sdpStr))
		}
	}

	content["fromPeerID"] = client.UserID

	// Store the offer state before forwarding
	room.StoreSignalingState(targetPeerID, client.UserID, "offer", content)

	// Check for any queued answers
	queuedAnswers := room.GetAndClearQueuedAnswers(targetPeerID, client.UserID)

	// Forward the offer
	targetPeer, exists := room.Clients[targetPeerID]
	if !exists {
		log.Printf("Target peer %s not found in room", targetPeerID)
		return
	}

	offerMsg := models.Message{
		Type:    "offer",
		RoomID:  room.ID,
		Content: content,
	}

	messageBytes, err := json.Marshal(offerMsg)
	if err != nil {
		log.Printf("Error marshaling offer message: %v", err)
		return
	}

	log.Printf("[OFFER] from:%s to:%s room:%s", client.UserID[:8], targetPeerID[:8], room.ID)
	targetPeer.Send <- messageBytes

	if len(queuedAnswers) > 0 {
		log.Printf("[OFFER] Processing %d queued answers for peer %s", len(queuedAnswers), targetPeerID[:8])
		for _, answer := range queuedAnswers {
			answerMsg := models.Message{
				Type:    "answer",
				RoomID:  room.ID,
				Content: answer,
			}
			if answerBytes, err := json.Marshal(answerMsg); err == nil {
				client.Send <- answerBytes
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
		log.Printf("[ICE] Invalid content")
		return
	}

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
		log.Printf("[ICE] Missing target. Available keys: %v", getKeys(content))
		return
	}

	// Prevent self-targeting of ICE candidates
	if targetPeerID == client.UserID {
		log.Printf("[ICE] Skipping self-targeted candidate from %s", client.UserID[:8])
		return
	}

	// Add fromPeerId to content
	content["fromPeerId"] = client.UserID

	log.Printf("[ICE] Content: from=%s, target=%s", client.UserID[:8], targetPeerID[:8])

	iceMsg := models.Message{
		Type:    "iceCandidate",
		RoomID:  room.ID,
		Content: content,
	}

	if targetPeer, exists := room.Clients[targetPeerID]; exists {
		messageBytes, _ := json.Marshal(iceMsg)
		targetPeer.Send <- messageBytes
		log.Printf("[ICE] Forwarded from %s to %s", client.UserID[:8], targetPeerID[:8])
	} else {
		log.Printf("[ICE] Target peer not found: %s", targetPeerID[:8])
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
	log.Printf("Received chat message from client %s in room: %s", client.UserID, room.ID)
	log.Printf("Broadcasting chat message to room: %s", msg.RoomID)
	broadcastToRoom(room, "chatMessage", toString(msg.Content), client)
	log.Printf("Chat message broadcasted with content: %s", toString(msg.Content))
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
		log.Printf("Error marshaling user count message: %v", err)
		return
	}

	room.Broadcast(messageBytes, nil)
	log.Printf("Broadcasted user count %d for room %s", count, room.ID)
}

func (h *MessageHandler) SendInitialRoomState(client *models.Client, room *models.Room) {
	userCountMsg := models.Message{
		Type:    "userCount",
		RoomID:  room.ID,
		Content: fmt.Sprintf("%d", room.GetTotalClientsCount()),
	}

	messageBytes, err := json.Marshal(userCountMsg)
	if err != nil {
		log.Printf("Error marshaling initial user count message: %v", err)
		return
	}

	client.Send <- messageBytes
}

func (h *MessageHandler) BroadcastUserList(room *models.Room) {
	users := room.GetUserList()
	message := models.Message{
		Type:   "userList",
		RoomID: room.ID,
		Content: map[string]interface{}{
			"users": users,
		},
	}

	messageBytes, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling user list message: %v", err)
		return
	}

	room.Broadcast(messageBytes, nil)
	log.Printf("Broadcasted user list for room %s: %v", room.ID, users)
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
