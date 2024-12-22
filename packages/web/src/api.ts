import { BASE_URL } from "./config/webrtc";
import { getHttpUrl } from "./utils/url";
import { User } from "./hooks/useRoomList";

// Fetches a list of users in a room with id `roomId`
export async function fetchUserList(roomId: string): Promise<User[]> {
    const httpUrl = getHttpUrl(BASE_URL);
    const response = await fetch(`${httpUrl}/userList?room_id=${roomId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  
    if (!response.ok) {
      throw new Error(`status: ${response.status}`);
    }
    
    const jsonResponse = await response.json()
    if (!Object.keys(jsonResponse).includes('users')) {
      console.debug(`Missing key "users" in json response`);
      return []
    }
  
    return jsonResponse['users']
}