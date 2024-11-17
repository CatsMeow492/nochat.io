package models

import (
	"context"
	"encoding/json"
	"log"

	"github.com/redis/go-redis/v9"
)

type NotificationService struct {
	RedisClient *redis.Client
	RoomManager RoomManager
}

func NewNotificationService(redisAddr, redisPassword string) *NotificationService {
	rdb := redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: redisPassword,
	})
	return &NotificationService{
		RedisClient: rdb,
		RoomManager: NewRoomManager(),
	}
}

func (s *NotificationService) SendRoomNotification(roomID string, notification NotificationRequest) error {
	// Fetch room members from the room service or shared database
	members, err := s.fetchRoomMembers(roomID)
	if err != nil {
		return err
	}

	// Send notification to each room member
	for _, userID := range members {
		notification.UserID = userID
		err := s.sendNotification(notification)
		if err != nil {
			log.Printf("Failed to send notification to user %s: %v", userID, err)
		}
	}

	return nil
}

func (s *NotificationService) sendNotification(notification NotificationRequest) error {
	ctx := context.Background()
	key := "notifications:" + notification.UserID
	value, err := json.Marshal(notification)
	if err != nil {
		return err
	}

	err = s.RedisClient.RPush(ctx, key, value).Err()
	if err != nil {
		return err
	}

	log.Printf("Notification sent to user %s", notification.UserID)
	return nil
}

func (s *NotificationService) fetchRoomMembers(roomID string) ([]string, error) {
	room, err := s.RoomManager.GetRoom(roomID)
	if err != nil {
		return nil, err
	}
	return room.Members, nil // Access the Members field directly
}
