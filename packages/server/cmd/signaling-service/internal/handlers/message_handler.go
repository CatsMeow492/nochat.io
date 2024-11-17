package handlers

import (
	"encoding/json"
	"fmt"
	"log"
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
	room.UpdateActivity()

	log.Printf("Handling message of type: %s for room: %s", msg.Type, msg.RoomID)

	switch msg.Type {
	case "ready":
		h.handleReady(msg, client, room)
	case "offer":
		h.handleOffer(msg, client, room)
	case "answer":
		h.handleAnswer(msg, client, room)
	case "iceCandidate":
		h.handleICECandidate(msg, client, room)
	case "ping":
		h.handlePing(msg, client, room)
	case "pong":
		h.handlePong(msg, client, room)
	case "initiatorStatus":
		h.handleInitiatorStatus(msg, client, room)
	case "requestInitialState":
		h.handleRequestInitialState(msg, client, room)
	case "chatMessage":
		h.handleChatMessage(msg, client, room)
	case "startMeeting":
		log.Printf("Handling startMeeting message from client %s", client.UserID)
		h.handleStartMeeting(msg, client, room)
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

	// if room.AllClientsReady() && room.GetTotalClientsCount() >= 2 {
	// 	h.sendAllReadyMessage(room)
	// 	h.sendCreateOfferToInitiator(room)
	// }
}

func (h *MessageHandler) handleOffer(msg models.Message, client *models.Client, room *models.Room) {
	log.Printf("Received offer from client %s in room: %s", client.UserID, room.ID)
	room.State = "offer"
	log.Printf("Broadcasting offer to room: %s", msg.RoomID)
	broadcastToRoom(room, "offer", toString(msg.Content), client)
}

func (h *MessageHandler) handleAnswer(msg models.Message, client *models.Client, room *models.Room) {
	log.Printf("Received answer from client %s in room: %s", client.UserID, room.ID)
	room.State = "answer"
	log.Printf("Broadcasting answer to room: %s", msg.RoomID)
	broadcastToRoom(room, "answer", toString(msg.Content), client)
}

func (h *MessageHandler) handleICECandidate(msg models.Message, client *models.Client, room *models.Room) {
	log.Printf("Received ICE candidate from client %s in room: %s", client.UserID, room.ID)
	log.Printf("Broadcasting ICE candidate to room: %s", msg.RoomID)
	broadcastToRoom(room, "iceCandidate", toString(msg.Content), client)
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

func (h *MessageHandler) handleStartMeeting(_ models.Message, client *models.Client, room *models.Room) {
	// First block: things that need the write lock
	room.Mu.Lock()
	if room.Initiator != client {
		room.Mu.Unlock()
		log.Printf("Client %s is not the initiator and cannot start the meeting", client.UserID)
		return
	}

	log.Printf("Setting MeetingStarted flag for room %s", room.ID)
	room.MeetingStarted = true
	log.Printf("MeetingStarted flag is now: %t", room.MeetingStarted)
	room.Mu.Unlock() // Release the lock before broadcasting

	// Create and broadcast meetingStarted message
	meetingStartedMsg := models.Message{
		Type:    "meetingStarted",
		RoomID:  room.ID,
		Content: nil,
	}
	meetingStartedBytes, err := json.Marshal(meetingStartedMsg)
	if err != nil {
		log.Printf("Error marshaling meetingStarted message: %v", err)
		return
	}

	log.Printf("Broadcasting meetingStarted message directly via room.Broadcast")
	room.Broadcast(meetingStartedBytes, nil)
	log.Printf("MeetingStarted broadcast complete")

	// Send createOffer to initiator
	createOfferMsg := models.Message{
		Type:    "createOffer",
		RoomID:  room.ID,
		Content: "Please create an offer",
	}
	createOfferBytes, err := json.Marshal(createOfferMsg)
	if err != nil {
		log.Printf("Error marshaling createOffer message: %v", err)
		return
	}

	log.Printf("Sending createOffer message directly to initiator %s", client.UserID)
	client.Send <- createOfferBytes
	log.Printf("CreateOffer message sent to initiator")
}

func (h *MessageHandler) SendAllReadyMessage(room *models.Room) {
	log.Printf("Preparing to send allReady message to room %s", room.ID)
	readyMessage := models.Message{
		Type:    "allReady",
		RoomID:  room.ID,
		Content: "All clients are ready",
	}
	readyMessageBytes, err := json.Marshal(readyMessage)
	if err != nil {
		log.Printf("Error marshaling allReady message: %v", err)
		return
	}
	log.Printf("Broadcasting allReady message: %s", string(readyMessageBytes))
	room.Broadcast(readyMessageBytes, nil)
	room.AllReadyMessageSent = true
	log.Printf("AllReady message broadcast completed for room %s", room.ID)
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

	// Log the content of the pong message
	contentJSON, err := json.Marshal(msg.Content)
	if err != nil {
		log.Printf("Error marshaling pong content: %v", err)
	} else {
		log.Printf("Pong content: %s", string(contentJSON))
	}

	// You can add additional logic here if needed, such as updating client status or room state
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

	log.Printf("Broadcasting %s message to room %s", messageType, room.ID)
	room.Broadcast(broadcastMessage, excludeClient)
	log.Printf("Broadcast of %s message completed", messageType)
}

// Helper function to convert interface{} to string
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

func (h *MessageHandler) checkRoomReadiness(room *models.Room) {
	for {
		time.Sleep(1 * time.Second)

		room.Mu.RLock()
		meetingStarted := room.MeetingStarted
		allReady := room.AllClientsReady()
		allAnswersReceived := room.AllAnswersReceived()
		allReadyMessageSent := room.AllReadyMessageSent
		room.Mu.RUnlock()

		log.Printf("Room %s status - Meeting started: %t, All ready: %t, All answers: %t",
			room.ID, meetingStarted, allReady, allAnswersReceived)

		if meetingStarted && allReady && !allReadyMessageSent {
			log.Printf("Meeting started and all clients are ready in room %s. Sending allReady message.", room.ID)
			h.SendAllReadyMessage(room)

			// Wait for a short duration to ensure the allReady message is sent
			time.Sleep(500 * time.Millisecond)

			log.Printf("Sending createOffer message for room %s.", room.ID)
			h.SendCreateOfferToInitiator(room)
			return
		}

		if !meetingStarted {
			log.Printf("Waiting for meeting to start in room %s", room.ID)
		}
	}
}
