import React, { useState, useRef, useEffect } from 'react';
import { Box, Stack, TextField, Button, Typography } from '@mui/material';

interface ChatComponentProps {
  messages: Array<{
    content: string;
    sender: string;
    senderName: string;
    timestamp: number;
    roomId: string;
  }>;
  userId: string;
  onSendMessage: (content: string) => void;
}

export const ChatComponent: React.FC<ChatComponentProps> = ({ 
  messages, 
  userId, 
  onSendMessage 
}) => {
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim()) {
      onSendMessage(newMessage.trim());
      setNewMessage('');
    }
  };

  return (
    <Box sx={{ 
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      gap: 2
    }}>
      <Box sx={{ 
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: 2
      }}>
        {messages.map((msg, i) => (
          <Box key={i} sx={{ 
            alignSelf: msg.sender === userId ? 'flex-end' : 'flex-start',
            maxWidth: '80%'
          }}>
            <Typography variant="caption" sx={{ 
              color: 'gray',
              display: 'block',
              mb: 0.5,
              fontSize: '0.7rem'
            }}>
              {msg.sender === userId ? 'You' : msg.senderName}
              {' • '}
              {new Date(msg.timestamp).toLocaleTimeString()}
            </Typography>
            <Box sx={{ 
              bgcolor: msg.sender === userId ? 'primary.main' : 'grey.700',
              color: 'white',
              p: 1,
              borderRadius: 1,
              wordBreak: 'break-word'
            }}>
              <Typography variant="body2">
                {msg.content}
              </Typography>
            </Box>
          </Box>
        ))}
        <div ref={messagesEndRef} />
      </Box>

      <form onSubmit={handleSend} style={{ width: '100%' }}>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            fullWidth
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            sx={{ 
              width: '100%',
              bgcolor: 'rgba(255,255,255,0.1)',
              '& .MuiInputBase-input': {
                color: 'white',
              }
            }}
          />
          <Button 
            type="submit" 
            variant="contained"
            disabled={!newMessage.trim()}
          >
            Send
          </Button>
        </Stack>
      </form>
    </Box>
  );
}; 