package main

import (
	"encoding/json"
	"fmt"
	"log"
)

// Message represents a WebSocket message
type Message struct {
	Type    string          `json:"type"`
	Content json.RawMessage `json:"content"`
	RoomID  string          `json:"room_id,omitempty"`
}

// Client represents a connected WebSocket client
type Client struct {
	ID   string
	hub  *Hub
	send chan []byte
}

// Hub maintains the set of active clients and broadcasts messages to the clients
type Hub struct {
	clients map[string]*Client
	rooms   map[string]*Room
}

// Room represents a meeting room
type Room struct {
	clients map[string]*Client
}

// handleMessage processes incoming WebSocket messages
func (c *Client) handleMessage(message []byte) {
	var msg Message
	if err := json.Unmarshal(message, &msg); err != nil {
		log.Printf("[ERROR] Failed to unmarshal message: %v", err)
		return
	}

	// Log the received message
	log.Printf("[DEBUG] Received message from client %s: %s", c.ID, string(message))

	switch msg.Type {
	case "joinRoom":
		var content struct {
			RoomID string `json:"roomId"`
		}
		if err := json.Unmarshal(msg.Content, &content); err != nil {
			log.Printf("[ERROR] Failed to unmarshal joinRoom content: %v", err)
			return
		}

		// Join the room
		c.hub.joinRoom(c, content.RoomID)

	case "leaveRoom":
		var content struct {
			RoomID string `json:"roomId"`
		}
		if err := json.Unmarshal(msg.Content, &content); err != nil {
			log.Printf("[ERROR] Failed to unmarshal leaveRoom content: %v", err)
			return
		}

		// Leave the room
		c.hub.leaveRoom(c, content.RoomID)

	case "offer", "answer", "iceCandidate":
		var content struct {
			FromPeerID   string      `json:"fromPeerId"`
			TargetPeerID string      `json:"targetPeerId"`
			RoomID       string      `json:"roomId"`
			SDP          interface{} `json:"sdp,omitempty"`
			Candidate    interface{} `json:"candidate,omitempty"`
		}
		if err := json.Unmarshal(msg.Content, &content); err != nil {
			log.Printf("[ERROR] Failed to unmarshal %s content: %v", msg.Type, err)
			return
		}

		// Validate peer IDs
		if content.FromPeerID == "" {
			content.FromPeerID = c.ID
		}
		if content.TargetPeerID == "" {
			log.Printf("[ERROR] No target peer ID specified in %s message", msg.Type)
			return
		}

		// Log the signaling message
		log.Printf("[DEBUG] Signaling %s: from=%s, target=%s", msg.Type, content.FromPeerID, content.TargetPeerID)

		// Forward the message to the target peer
		targetClient := c.hub.clients[content.TargetPeerID]
		if targetClient == nil {
			log.Printf("[ERROR] Target peer %s not found", content.TargetPeerID)
			return
		}

		// Create the forwarded message
		forwardMsg := Message{
			Type:    msg.Type,
			Content: msg.Content,
			RoomID:  content.RoomID,
		}

		// Send the message to the target peer
		if err := targetClient.writeJSON(forwardMsg); err != nil {
			log.Printf("[ERROR] Failed to forward %s message to peer %s: %v", msg.Type, content.TargetPeerID, err)
			return
		}

	case "startMeeting":
		var content struct {
			RoomID string `json:"roomId"`
		}
		if err := json.Unmarshal(msg.Content, &content); err != nil {
			log.Printf("[ERROR] Failed to unmarshal startMeeting content: %v", err)
			return
		}

		// Get all peers in the room
		room := c.hub.rooms[content.RoomID]
		if room == nil {
			log.Printf("[ERROR] Room %s not found", content.RoomID)
			return
		}

		// Create a list of peer IDs
		peerIDs := make([]string, 0, len(room.clients))
		for clientID := range room.clients {
			peerIDs = append(peerIDs, clientID)
		}

		// Send startMeeting message to all peers in the room
		startMsg := Message{
			Type: "startMeeting",
			Content: json.RawMessage(
				[]byte(fmt.Sprintf(`{"peers":%s}`, string(peerIDs))),
			),
			RoomID: content.RoomID,
		}

		for _, client := range room.clients {
			if err := client.writeJSON(startMsg); err != nil {
				log.Printf("[ERROR] Failed to send startMeeting message to peer %s: %v", client.ID, err)
			}
		}

	default:
		log.Printf("[WARN] Unknown message type: %s", msg.Type)
	}
}
