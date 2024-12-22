import React from 'react';
import { Box, Typography } from '@mui/material';

interface CallStatusProps {
  userId: string | null;
  roomId: string | null;
  isInitiator: boolean;
  iceConnectionState: string;
  iceGatheringState: string;
  version: string;
}

export const CallStatus: React.FC<CallStatusProps> = ({
  userId,
  roomId,
  isInitiator,
  iceConnectionState,
  iceGatheringState,
  version
}) => (
  <Box sx={{ 
    position: 'absolute', 
    top: 10, 
    right: 10, 
    bgcolor: 'rgba(255,255,255,0.1)', 
    padding: 1, 
    display: 'flex', 
    flexDirection: 'column', 
    gap: 1 
  }}>
    <Typography variant="caption" sx={{ color: 'white' }}>
      UserID: {userId || 'Not set'}
    </Typography>
    {/* ... other status items ... */}
  </Box>
); 