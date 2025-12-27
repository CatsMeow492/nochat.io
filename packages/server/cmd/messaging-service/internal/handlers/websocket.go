package handlers

import (
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/kindlyrobotics/nochat/cmd/messaging-service/internal/models"
)

func ServeWs(hub *models.Hub, w http.ResponseWriter, r *http.Request, upgrader websocket.Upgrader) {
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

func HealthCheck(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Messaging service is healthy"))
}