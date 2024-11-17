package models

import (
	"encoding/json"
	"log"

	"github.com/gorilla/websocket"
)

type Client struct {
	ID     string
	Hub    *Hub
	Conn   *websocket.Conn
	Send   chan []byte
	RoomID string
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.unregister <- c
		c.Conn.Close()
	}()
	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Error unmarshaling message: %v", err)
			continue
		}

		// Use the client's RoomID if the message doesn't include one
		if _, ok := msg["roomId"]; !ok {
			msg["roomId"] = c.RoomID
		}

		// Broadcast the message to the room
		messageBytes, _ := json.Marshal(msg)
		c.Hub.broadcastToRoom(c.RoomID, messageBytes)
	}
}

func (c *Client) WritePump() {
	defer func() {
		c.Conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.Send:
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			if err := w.Close(); err != nil {
				return
			}
		}
	}
}
