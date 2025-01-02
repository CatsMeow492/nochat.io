import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Paper,
  TextField,
  IconButton,
  Typography,
  List,
  ListItem,
  ListItemText,
  Fade,
} from '@mui/material';
import { Send as SendIcon } from '@mui/icons-material';
import websocketService from '../services/websocket';

interface ChatMessage {
  content: string;
  sender: string;
  senderName: string;
  timestamp: string;
  roomId: string;
}

interface ChatBoxProps {
  roomId: string;
  userId: string;
}

const ChatBox: React.FC<ChatBoxProps> = ({ roomId, userId }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const unsubscribe = websocketService.subscribe('chatMessage', (message: ChatMessage) => {
      if (message.sender !== userId) {
        const displayMessage = {
          ...message,
          senderName: `User ${message.sender.slice(0, 4)}`
        };
        setMessages(prev => [...prev, displayMessage]);
      }
    });

    return () => void unsubscribe?.();
  }, [userId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const chatMessage: ChatMessage = {
      content: newMessage,
      sender: userId,
      senderName: 'You',
      timestamp: new Date().toISOString(),
      roomId: roomId
    };

    setMessages(prev => [...prev, chatMessage]);
    
    websocketService.send('chatMessage', {
      ...chatMessage,
      senderName: `User ${userId.slice(0, 4)}`
    });
    setNewMessage('');
  };

  return (
    <Paper
      elevation={0}
      sx={{
        width: '100%',
        maxWidth: '350px',
        height: '100%',
        background: 'rgba(23, 23, 23, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(10px)',
      }}
    >
      <Box sx={{ 
        p: 2, 
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'rgba(255, 255, 255, 0.05)',
      }}>
        <Typography
          variant="h6"
          sx={{
            fontSize: '1rem',
            fontWeight: 600,
            color: 'rgba(255, 255, 255, 0.9)',
          }}
        >
          Chat
        </Typography>
      </Box>

      <List
        ref={listRef}
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 2,
          '&::-webkit-scrollbar': {
            width: '6px',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '3px',
          },
        }}
      >
        {messages.map((message, index) => (
          <Fade in timeout={300} key={index}>
            <ListItem
              sx={{
                flexDirection: 'column',
                alignItems: message.sender === userId ? 'flex-end' : 'flex-start',
                p: 1,
              }}
            >
              <Box
                sx={{
                  maxWidth: '85%',
                  background: message.sender === userId 
                    ? 'linear-gradient(45deg, #6366f1, #8b5cf6)'
                    : 'rgba(255, 255, 255, 0.05)',
                  borderRadius: '12px',
                  p: 1.5,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.9)',
                    fontSize: '0.9rem',
                    wordBreak: 'break-word',
                  }}
                >
                  {message.content}
                </Typography>
              </Box>
              <Typography
                variant="caption"
                sx={{
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontSize: '0.75rem',
                  mt: 0.5,
                }}
              >
                {message.sender === userId ? 'You' : message.senderName}
                {' • '}
                {new Date(message.timestamp).toLocaleTimeString()}
              </Typography>
            </ListItem>
          </Fade>
        ))}
        <div ref={messagesEndRef} />
      </List>

      <Box
        component="form"
        onSubmit={handleSendMessage}
        sx={{
          p: 2,
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          background: 'rgba(255, 255, 255, 0.05)',
          display: 'flex',
          gap: 1,
        }}
      >
        <TextField
          fullWidth
          size="small"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          variant="outlined"
          sx={{
            '& .MuiOutlinedInput-root': {
              color: 'rgba(255, 255, 255, 0.9)',
              backgroundColor: 'rgba(0, 0, 0, 0.2)',
              '& fieldset': {
                borderColor: 'rgba(255, 255, 255, 0.1)',
              },
              '&:hover fieldset': {
                borderColor: 'rgba(255, 255, 255, 0.2)',
              },
              '&.Mui-focused fieldset': {
                borderColor: 'primary.main',
              },
            },
          }}
        />
        <IconButton
          type="submit"
          disabled={!newMessage.trim()}
          sx={{
            color: 'primary.main',
            '&.Mui-disabled': {
              color: 'rgba(255, 255, 255, 0.3)',
            },
          }}
        >
          <SendIcon />
        </IconButton>
      </Box>
    </Paper>
  );
};

export default ChatBox; 