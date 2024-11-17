import React, { useEffect, useState } from 'react';
import { useNavigate } from "react-router-dom";
import { Mic, Computer as ComputerIcon, Videocam as VideocamIcon } from "@mui/icons-material";
import { Box, Typography, Button } from "@mui/material";
import ThreeBackground from "../components/Background/webgl_background";
import AppBar from "../components/appbar";
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
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 140,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 1,
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            maxWidth: "600px",
            width: "90%",
          }}
        >
          <Box
            sx={{
              backgroundColor: "rgba(255, 255, 255, 0.1)",
              borderRadius: "16px 16px 0 0",
              padding: "10px 20px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "20px",
              width: "100%",
            }}
          >
            <VideocamIcon sx={{ color: "white", fontSize: 18 }} />
            <ComputerIcon sx={{ color: "white", fontSize: 18 }} />
            <Mic sx={{ color: "white", fontSize: 18 }} />
          </Box>
          <Box
            sx={{
              backgroundColor: "rgba(0, 0, 0, 0.2)",
              borderRadius: "0 0 16px 16px",
              padding: "40px",
              width: "100%",
              textAlign: "center",
              backdropFilter: "blur(5px)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              boxShadow: "0 4px 30px rgba(0, 0, 0, 0.1)",
            }}
          >
            <Box
              component="img"
              src={Logo}
              alt="Phantom Logo"
            />
            <Button
              onClick={handleGetStarted}
              disableElevation
              variant="text"
              sx={{
                textTransform: "none",
                mt: 4,
                width: 250,
                height: 60,
                fontSize: "1rem",
              }}
            >
              Haunt
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Splash;