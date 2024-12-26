import { useState, useEffect } from 'react';
import websocketService from '../services/websocket';

interface UseLobbyStateProps {
  roomId: string | undefined;
  userId: string | null;
  initialIsInitiator: boolean;
}

export const useLobbyState = ({ roomId, userId, initialIsInitiator }: UseLobbyStateProps) => {
  const [participants, setParticipants] = useState<string[]>([]);
  const [userCount, setUserCount] = useState<number>(0);
  const [isInitiator, setIsInitiator] = useState<boolean>(initialIsInitiator);
  const [meetingStarted, setMeetingStarted] = useState(false);

  useEffect(() => {
    if (!roomId) return;

    // Send joinRoom message when component mounts
    websocketService.send('joinRoom', { roomId });

    const handleMessage = (type: string, content: any) => {
      switch (type) {
        case 'userList':
          if (content && content.users) {
            setParticipants(content.users);
          }
          break;
        case 'userCount':
          const count = parseInt(content, 10);
          if (!isNaN(count)) {
            setUserCount(count);
          }
          break;
        case 'initiatorStatus':
          console.log('[useLobbyState] Received initiatorStatus:', content);
          const newIsInitiator = content === true || content === 'true';
          console.log('[useLobbyState] Setting isInitiator to:', newIsInitiator);
          setIsInitiator(newIsInitiator);
          break;
        case 'startMeeting':
          setMeetingStarted(true);
          break;
      }
    };

    // Subscribe to relevant message types
    const unsubscribers = [
      websocketService.subscribe('userList', (content) => handleMessage('userList', content)),
      websocketService.subscribe('userCount', (content) => handleMessage('userCount', content)),
      websocketService.subscribe('initiatorStatus', (content) => handleMessage('initiatorStatus', content)),
      websocketService.subscribe('startMeeting', (content) => handleMessage('startMeeting', content))
    ];

    // Cleanup subscriptions when unmounting
    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
      if (roomId) {
        websocketService.send('leaveRoom', { roomId });
      }
    };
  }, [roomId]);

  return {
    participants,
    userCount,
    isInitiator,
    meetingStarted
  };
};