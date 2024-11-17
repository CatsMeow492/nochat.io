package handlers

import (
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"gitlab.com/secp/services/backend/cmd/video-service/internal/models"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Be cautious with this in production
	},
}

func ServeWs(hub *models.Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	client := &models.Client{Hub: hub, Conn: conn, Send: make(chan []byte, 256)}
	client.Hub.Register <- client

	go client.WritePump()
	go client.ReadPump()
}

// Implement ReadPump and WritePump methods for the Client struct in the models package
