import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Computer as ComputerIcon, Videocam as VideocamIcon } from '@mui/icons-material';
import { Box, Typography, Button } from '@mui/material';
import ThreeBackground from '../components/Background/webgl_background';
import AppBar from '../components/appbar';
import Logo from '../logo.svg';

/**
 * Splash Component
 *
 * This component serves as the landing page for the application.
 * It displays a splash screen with a "Get Started" button
 * that navigates the user to the join page.
 */
const Splash: React.FC = () => {
  const navigate = useNavigate();
  const [showBackground, setShowBackground] = useState(false);

  useEffect(() => {
    setShowBackground(true);
    return () => {
      setShowBackground(false);
    };
  }, []);

  const handleGetStarted = () => {
    // Remove the background, i.e. the webgl renderer, before navigating
    setShowBackground(false);

    // Allow one render before navigating to allow the cleanup to start and finish
    setTimeout(() => {
      navigate('/join');
    }, 0);
  };

  return (
    <Box component="div">
      <AppBar />
      {showBackground && <ThreeBackground />}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          zIndex: 1,
        }}
      >
        <Box
          sx={{
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '24px',
            padding: '48px',
            width: '480px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          }}
        >
          <Typography
            variant="h1"
            sx={{
              fontSize: '2.5rem',
              fontWeight: 800,
              background: `linear-gradient(45deg, #6366f1, #8b5cf6)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              mb: 2
            }}
          >
            nochat.io
          </Typography>
          
          <Typography
            variant="body1"
            sx={{
              color: 'rgba(255, 255, 255, 0.7)',
              mb: 4,
              maxWidth: '320px'
            }}
          >
            Zero-hassle, zero-traces video meetings—secure by design.
          </Typography>

          <Box
            sx={{
              display: 'flex',
              gap: '16px',
              mb: 4
            }}
          >
            <VideocamIcon sx={{ color: 'rgba(255, 255, 255, 0.5)' }} />
            <ComputerIcon sx={{ color: 'rgba(255, 255, 255, 0.5)' }} />
            <Mic sx={{ color: 'rgba(255, 255, 255, 0.5)' }} />
          </Box>

          <Button
            onClick={handleGetStarted}
            variant="contained"
            sx={{
              textTransform: 'none',
              py: 2,
              px: 6,
              borderRadius: '12px',
              fontSize: '1.1rem',
              fontWeight: 600,
              background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
              '&:hover': {
                background: 'linear-gradient(45deg, #4f46e5, #7c3aed)',
              }
            }}
          >
            Start a Call
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default Splash;
