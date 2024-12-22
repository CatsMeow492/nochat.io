import { useState, useEffect } from 'react';
import { subscribeToMessages } from '../services/websocket';

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

    const handleMessage = (message: any) => {
        if (message.type === 'userList' || message.type === 'userCount' || message.type === 'initiatorStatus' || message.type === 'startMeeting') {
            console.log('Lobby handling message:', message);
        }
      
      if (message.type === 'userList' && message.content) {
        const participantList = message.content.users || [];
        setParticipants(participantList);
        console.log('Updated participants:', participantList);
      } else if (message.type === 'userCount') {
        setUserCount(parseInt(message.content));
      } else if (message.type === 'initiatorStatus') {
        console.log('Setting initiator status:', message.content);
        setIsInitiator(message.content);
      } else if (message.type === 'startMeeting') {
        setMeetingStarted(true);
      }
    };

    const unsubscribe = subscribeToMessages(handleMessage);
    return () => unsubscribe();
  }, [roomId]);

  return {
    participants,
    userCount,
    userId,
    meetingStarted
  };
};