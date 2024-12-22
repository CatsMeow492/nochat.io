import { useState, useEffect } from 'react';
import { getHttpUrl } from '../utils/url';
import { BASE_URL } from '../config/webrtc';

interface UseParticipantCountProps {
  roomId: string;
  enabled?: boolean;
  pollingInterval?: number;
}

export const useParticipantCount = ({ 
  roomId, 
  enabled = true, 
  pollingInterval = 2000 
}: UseParticipantCountProps) => {
  const [count, setCount] = useState<number>(0);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!enabled || !roomId) return;

    const fetchCount = async () => {
      try {
        const httpUrl = getHttpUrl(BASE_URL);
        const response = await fetch(`${httpUrl}/handshake?room_id=${roomId}`);
        
        if (!response.ok) throw new Error('Failed to fetch participant count');
        
        const data = await response.json();
        setCount(data.totalClients || 0);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch
    fetchCount();

    // Set up polling
    const interval = setInterval(fetchCount, pollingInterval);

    return () => clearInterval(interval);
  }, [roomId, enabled, pollingInterval]);

  return { count, error, loading };
}; 