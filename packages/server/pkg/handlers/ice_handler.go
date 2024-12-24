package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/twilio/twilio-go"
	twilioApi "github.com/twilio/twilio-go/rest/api/v2010"
)

type IceHandler struct {
	twilioClient *twilio.RestClient
}

func NewIceHandler(accountSid, authToken string) *IceHandler {
	return &IceHandler{
		twilioClient: twilio.NewRestClientWithParams(twilio.ClientParams{
			Username: accountSid,
			Password: authToken,
		}),
	}
}

func (h *IceHandler) GetIceServers(w http.ResponseWriter, r *http.Request) {
	log.Printf("Received request for ICE servers")

	// Check if credentials are available
	if h.twilioClient == nil {
		log.Printf("Error: Twilio client not initialized")
		http.Error(w, "Twilio client not initialized", http.StatusInternalServerError)
		return
	}

	ttl := 86400
	token, err := h.twilioClient.Api.CreateToken(&twilioApi.CreateTokenParams{
		Ttl: &ttl,
	})
	if err != nil {
		http.Error(w, "Failed to get ICE servers", http.StatusInternalServerError)
		return
	}

	// Convert Twilio ICE servers to generic format
	servers := make([]map[string]interface{}, len(*token.IceServers))
	for i, server := range *token.IceServers {
		servers[i] = map[string]interface{}{
			"urls":       server.Url,
			"username":   server.Username,
			"credential": server.Credential,
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"iceServers": token.IceServers,
	})

	log.Printf("Successfully returned ICE servers")
}
