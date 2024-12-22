type MessageHandler = (message: any) => void;
type UnsubscribeFunction = () => void;

const messageHandlers: Set<MessageHandler> = new Set();

export const subscribeToMessages = (handler: MessageHandler): UnsubscribeFunction => {
  messageHandlers.add(handler);
  return () => {
    messageHandlers.delete(handler);
  };
};

export const broadcastMessage = (message: any): void => {
  messageHandlers.forEach(handler => handler(message));
}; 