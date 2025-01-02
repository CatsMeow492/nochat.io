import React, { useState, useEffect } from 'react';
import { Box, IconButton, Fade, Badge } from '@mui/material';
import { Chat as ChatIcon, Close as CloseIcon } from '@mui/icons-material';
import ChatBox from './ChatBox';
import websocketService from '../services/websocket';

interface ChatOverlayProps {
  roomId: string;
  userId: string;
}

const ChatOverlay: React.FC<ChatOverlayProps> = ({ roomId, userId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const unsubscribe = websocketService.subscribe('chatMessage', (message) => {
      if (!isOpen && message.sender !== userId) {
        setUnreadCount(prev => prev + 1);
      }
    });

    return () => void unsubscribe?.();
  }, [isOpen, userId]);

  const handleOpen = () => {
    setIsOpen(true);
    setUnreadCount(0); // Clear unread count when opening chat
  };

  return (
    <>
      {/* Chat Toggle Button with Badge */}
      <IconButton
        onClick={handleOpen}
        sx={{
          position: 'fixed',
          bottom: 100,
          right: 24,
          backgroundColor: 'rgba(23, 23, 23, 0.9)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          '&:hover': {
            backgroundColor: 'rgba(23, 23, 23, 0.95)',
          },
          zIndex: 1300,
        }}
      >
        <Badge
          badgeContent={unreadCount}
          color="primary"
          sx={{
            '& .MuiBadge-badge': {
              backgroundColor: '#6366f1',
              color: 'white',
              fontWeight: 600,
              minWidth: '20px',
              height: '20px',
              fontSize: '0.75rem',
            }
          }}
        >
          <ChatIcon sx={{ color: 'rgba(255, 255, 255, 0.9)' }} />
        </Badge>
      </IconButton>

      {/* Chat Overlay */}
      <Fade in={isOpen}>
        <Box
          sx={{
            position: 'fixed',
            right: 24,
            bottom: 160,
            width: '350px',
            height: '500px',
            zIndex: 1300,
          }}
        >
          <Box
            sx={{
              position: 'relative',
              height: '100%',
            }}
          >
            <IconButton
              onClick={() => setIsOpen(false)}
              sx={{
                position: 'absolute',
                top: -40,
                right: 0,
                backgroundColor: 'rgba(23, 23, 23, 0.9)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                '&:hover': {
                  backgroundColor: 'rgba(23, 23, 23, 0.95)',
                },
              }}
            >
              <CloseIcon sx={{ color: 'rgba(255, 255, 255, 0.9)' }} />
            </IconButton>
            <ChatBox roomId={roomId} userId={userId} />
          </Box>
        </Box>
      </Fade>
    </>
  );
};

export default ChatOverlay; 