import React, { useState, useRef, useEffect } from 'react';
import { Box, Stack, TextField, Button, Typography, useTheme } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';

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
  const theme = useTheme();

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
      gap: 2,
      bgcolor: theme.palette.background.default,
      borderRadius: 2,
      overflow: 'hidden'
    }}>
      <Box sx={{ 
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        p: 3,
        '&::-webkit-scrollbar': {
          width: '8px',
        },
        '&::-webkit-scrollbar-track': {
          background: 'transparent',
        },
        '&::-webkit-scrollbar-thumb': {
          background: theme.palette.primary.main + '40',
          borderRadius: '4px',
        },
      }}>
        {messages.map((msg, i) => (
          <Box key={i} sx={{ 
            alignSelf: msg.sender === userId ? 'flex-end' : 'flex-start',
            maxWidth: '70%',
          }}>
            <Typography variant="caption" sx={{ 
              color: theme.palette.text.secondary,
              display: 'block',
              mb: 0.5,
              fontSize: '0.75rem',
              px: 1
            }}>
              {msg.sender === userId ? 'You' : msg.senderName}
              {' • '}
              {new Date(msg.timestamp).toLocaleTimeString()}
            </Typography>
            <Box sx={{ 
              bgcolor: msg.sender === userId 
                ? `${theme.palette.primary.main}40`
                : theme.palette.background.paper,
              color: theme.palette.text.primary,
              p: 2,
              borderRadius: msg.sender === userId 
                ? '20px 20px 4px 20px'
                : '20px 20px 20px 4px',
              wordBreak: 'break-word',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              border: `1px solid ${theme.palette.primary.main}20`,
              position: 'relative',
              '&::after': msg.sender === userId ? {
                content: '""',
                position: 'absolute',
                bottom: 0,
                right: '-8px',
                width: '20px',
                height: '20px',
                background: `${theme.palette.primary.main}40`,
                clipPath: 'polygon(0 0, 0% 100%, 100% 100%)',
              } : undefined
            }}>
              <Typography variant="body2">
                {msg.content}
              </Typography>
            </Box>
          </Box>
        ))}
        <div ref={messagesEndRef} />
      </Box>

      <form onSubmit={handleSend} style={{ width: '100%', padding: '16px' }}>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            fullWidth
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            multiline
            maxRows={4}
            sx={{ 
              '& .MuiOutlinedInput-root': {
                bgcolor: theme.palette.background.paper,
                borderRadius: '20px',
                '& fieldset': {
                  borderColor: theme.palette.primary.main + '40',
                },
                '&:hover fieldset': {
                  borderColor: theme.palette.primary.main + '60',
                },
                '&.Mui-focused fieldset': {
                  borderColor: theme.palette.primary.main,
                },
              },
              '& .MuiInputBase-input': {
                color: theme.palette.text.primary,
                px: 2,
              }
            }}
          />
          <Button 
            type="submit" 
            variant="contained"
            disabled={!newMessage.trim()}
            sx={{
              borderRadius: '20px',
              minWidth: '50px',
              height: '40px',
              boxShadow: 'none',
              '&:hover': {
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              }
            }}
          >
            <SendIcon />
          </Button>
        </Stack>
      </form>
    </Box>
  );
}; 