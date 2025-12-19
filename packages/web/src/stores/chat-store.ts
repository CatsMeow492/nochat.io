import { create } from "zustand";

export interface ChatMessage {
  id: string;
  content: string;
  senderId: string;
  senderName: string;
  timestamp: string;
  roomId: string;
  encrypted: boolean;
  decryptionError?: boolean;
}

export interface Participant {
  userId: string;
  username?: string;
  isTyping: boolean;
  isOnline: boolean;
  joinedAt: string;
}

export interface Room {
  id: string;
  name?: string;
  participants: Participant[];
  createdAt: string;
}

interface ChatState {
  // Current room state
  currentRoomId: string | null;
  rooms: Map<string, Room>;
  messages: Map<string, ChatMessage[]>;

  // UI state
  typingUsers: Map<string, Set<string>>; // roomId -> Set<userId>
  unreadCounts: Map<string, number>;

  // Actions
  setCurrentRoom: (roomId: string | null) => void;
  addRoom: (room: Room) => void;
  removeRoom: (roomId: string) => void;

  addMessage: (roomId: string, message: ChatMessage) => void;
  setMessages: (roomId: string, messages: ChatMessage[]) => void;
  clearMessages: (roomId: string) => void;

  setTyping: (roomId: string, userId: string, isTyping: boolean) => void;
  clearTyping: (roomId: string) => void;

  incrementUnread: (roomId: string) => void;
  clearUnread: (roomId: string) => void;

  updateParticipant: (
    roomId: string,
    userId: string,
    updates: Partial<Participant>
  ) => void;

  reset: () => void;
}

const initialState = {
  currentRoomId: null,
  rooms: new Map<string, Room>(),
  messages: new Map<string, ChatMessage[]>(),
  typingUsers: new Map<string, Set<string>>(),
  unreadCounts: new Map<string, number>(),
};

export const useChatStore = create<ChatState>()((set, get) => ({
  ...initialState,

  setCurrentRoom: (roomId) => {
    set({ currentRoomId: roomId });
    if (roomId) {
      get().clearUnread(roomId);
    }
  },

  addRoom: (room) =>
    set((state) => ({
      rooms: new Map(state.rooms).set(room.id, room),
    })),

  removeRoom: (roomId) =>
    set((state) => {
      const newRooms = new Map(state.rooms);
      newRooms.delete(roomId);
      const newMessages = new Map(state.messages);
      newMessages.delete(roomId);
      return {
        rooms: newRooms,
        messages: newMessages,
        currentRoomId:
          state.currentRoomId === roomId ? null : state.currentRoomId,
      };
    }),

  addMessage: (roomId, message) =>
    set((state) => {
      const currentMessages = state.messages.get(roomId) || [];
      const newMessages = new Map(state.messages);
      newMessages.set(roomId, [...currentMessages, message]);

      // Increment unread if not current room
      const newUnreadCounts = new Map(state.unreadCounts);
      if (state.currentRoomId !== roomId) {
        newUnreadCounts.set(
          roomId,
          (newUnreadCounts.get(roomId) || 0) + 1
        );
      }

      return {
        messages: newMessages,
        unreadCounts: newUnreadCounts,
      };
    }),

  setMessages: (roomId, messages) =>
    set((state) => ({
      messages: new Map(state.messages).set(roomId, messages),
    })),

  clearMessages: (roomId) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      newMessages.delete(roomId);
      return { messages: newMessages };
    }),

  setTyping: (roomId, userId, isTyping) =>
    set((state) => {
      const newTypingUsers = new Map(state.typingUsers);
      const roomTyping = new Set(newTypingUsers.get(roomId) || []);

      if (isTyping) {
        roomTyping.add(userId);
      } else {
        roomTyping.delete(userId);
      }

      newTypingUsers.set(roomId, roomTyping);
      return { typingUsers: newTypingUsers };
    }),

  clearTyping: (roomId) =>
    set((state) => {
      const newTypingUsers = new Map(state.typingUsers);
      newTypingUsers.delete(roomId);
      return { typingUsers: newTypingUsers };
    }),

  incrementUnread: (roomId) =>
    set((state) => ({
      unreadCounts: new Map(state.unreadCounts).set(
        roomId,
        (state.unreadCounts.get(roomId) || 0) + 1
      ),
    })),

  clearUnread: (roomId) =>
    set((state) => {
      const newUnreadCounts = new Map(state.unreadCounts);
      newUnreadCounts.delete(roomId);
      return { unreadCounts: newUnreadCounts };
    }),

  updateParticipant: (roomId, userId, updates) =>
    set((state) => {
      const room = state.rooms.get(roomId);
      if (!room) return {};

      const updatedParticipants = room.participants.map((p) =>
        p.userId === userId ? { ...p, ...updates } : p
      );

      const newRooms = new Map(state.rooms);
      newRooms.set(roomId, { ...room, participants: updatedParticipants });
      return { rooms: newRooms };
    }),

  reset: () => set(initialState),
}));
