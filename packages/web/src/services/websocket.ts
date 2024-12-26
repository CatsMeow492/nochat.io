class WebSocketService {
  private socket: WebSocket | null = null;
  private subscribers = new Map<string, Set<(data: any) => void>>();
  private reconnectTimeout: number | null = null;
  private isConnected = false;

  setSocket(socket: WebSocket | null) {
    console.log('[WebSocketService] Setting socket:', socket ? 'new socket' : 'null');
    
    if (this.socket) {
      console.log('[WebSocketService] Closing existing socket connection');
      this.socket.close();
      this.clearSubscribers();
    }

    this.socket = socket;
    this.isConnected = socket !== null;

    if (socket) {
      console.log('[WebSocketService] Initializing socket event handlers');
      
      socket.onclose = (event) => {
        console.log('[WebSocketService] Socket closed:', event.code, event.reason);
        this.isConnected = false;
        this.notifySubscribers('connectionState', { connected: false });
      };

      socket.onopen = () => {
        console.log('[WebSocketService] Socket opened successfully');
        this.isConnected = true;
        this.notifySubscribers('connectionState', { connected: true });
      };

      socket.onerror = (error) => {
        console.error('[WebSocketService] Socket error:', error);
      };

      socket.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[WebSocketService] Received message:', {
            type: message.type,
            content: message.content
          });
          
          // Notify subscribers of the specific message type
          this.notifySubscribers(message.type, message.content);
          
          // Also notify 'message' subscribers of all messages
          this.notifySubscribers('message', message);
        } catch (error) {
          console.error('[WebSocketService] Error handling message:', error);
        }
      };
    }
  }

  private async handleIncomingCall(data: { from: string; fromName?: string; roomId: string }) {
    try {
      // Request notification permission if needed
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }

      if (Notification.permission === 'granted') {
        const notification = new Notification('Incoming Call', {
          body: `${data.fromName || data.from} is calling you`,
          icon: '/favicon.ico',
          requireInteraction: true, // Keep notification until user interacts
        });

        notification.onclick = () => {
          window.focus();
          window.location.href = `/call/${data.roomId}`;
        };
      }
    } catch (err) {
      console.error('Error showing notification:', err);
    }
  }

  send(type: string, content: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket is not connected. Message not sent:', type);
      return false;
    }

    try {
      this.socket.send(JSON.stringify({ type, content }));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }

  subscribe(type: string, callback: (data: any) => void) {
    if (!this.subscribers.has(type)) {
      this.subscribers.set(type, new Set());
    }
    this.subscribers.get(type)?.add(callback);
    
    // Return unsubscribe function
    return () => this.subscribers.get(type)?.delete(callback);
  }

  private notifySubscribers(type: string, data: any) {
    this.subscribers.get(type)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in subscriber callback:', error);
      }
    });
  }

  private clearSubscribers() {
    this.subscribers.clear();
  }

  isSocketConnected(): boolean {
    return this.isConnected && this.socket?.readyState === WebSocket.OPEN;
  }

  getSocket(): WebSocket | null {
    return this.socket;
  }
}

export default new WebSocketService(); 