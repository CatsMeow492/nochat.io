import React from 'react';
import { Box, Typography, Button, Alert } from '@mui/material';
import { Error as ErrorIcon } from '@mui/icons-material';

interface ErrorProps {
  message: string;
  onRetry?: () => void;
}

const Error: React.FC<ErrorProps> = ({ message, onRetry }) => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
        gap: 2,
        padding: 3,
      }}
    >
      <ErrorIcon color="error" sx={{ fontSize: 48 }} />
      <Alert severity="error" sx={{ width: '100%', maxWidth: 400 }}>
        {message}
      </Alert>
      {onRetry && (
        <Button variant="contained" onClick={onRetry} sx={{ mt: 2 }}>
          Try Again
        </Button>
      )}
    </Box>
  );
};

export default Error; 