package models

type NotificationRequest struct {
	UserID      string `json:"user_id"`
	Type        string `json:"type"`
	Message     string `json:"message"`
	CallID      string `json:"call_id,omitempty"`
	MessageID   string `json:"message_id,omitempty"`
}