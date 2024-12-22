import { useQuery } from '@tanstack/react-query';
import { fetchUserList } from '../api';

export type User = String;

interface UseUserListOptions {
  roomId: string;
  enabled?: boolean;
}

export function useUserList({ roomId, enabled = true }: UseUserListOptions) {
  return useQuery({
    queryKey: ['userList', roomId],
    queryFn: () => fetchUserList(roomId),
    enabled: false && Boolean(roomId),
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    // Throwing on error here can cause major disruption in the handshaking process
    // Instead we default to a value in the [`Lobby`] component
    throwOnError(error, query) {
      return false
    },
    networkMode: 'online',
    retryOnMount: false,
    
  });
}
