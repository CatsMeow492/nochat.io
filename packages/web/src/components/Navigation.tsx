import React, { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Avatar,
} from '@mui/material';
import { Person as PersonIcon } from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';
import WalletSignInDialog from './WalletSignInDialog';
import styled from '@emotion/styled';

const StyledNav = styled('nav')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px',
  backgroundColor: 'rgba(8, 8, 12, 0.7)',
  backdropFilter: 'blur(10px)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
});

const Navigation: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, login, loginWithWallet } = useAuthStore();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [showWalletDialog, setShowWalletDialog] = useState(false);

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    handleClose();
    await logout();
    navigate('/');
  };

  const handleWalletSignIn = async (address: string) => {
    try {
      await loginWithWallet(address);
      setShowWalletDialog(false);
    } catch (err) {
      console.error('Error signing in with wallet:', err);
    }
  };

  return (
    <>
      <AppBar 
        position="static" 
        elevation={0}
        sx={{ 
          background: 'transparent',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
        }}
      >
        <Toolbar>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{
              flexGrow: 1,
              textDecoration: 'none',
              color: 'inherit',
              fontWeight: 800,
              background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              '&:hover': {
                textDecoration: 'none',
              },
            }}
          >
            nochat.io
          </Typography>

          <Box sx={{ display: 'flex', gap: 1 }}>
            {isAuthenticated ? (
              <>
                <IconButton
                  size="large"
                  aria-label="account of current user"
                  aria-controls="menu-appbar"
                  aria-haspopup="true"
                  onClick={handleMenu}
                  sx={{ 
                    color: 'rgba(255, 255, 255, 0.7)',
                    '&:hover': {
                      color: 'white'
                    }
                  }}
                >
                  <Avatar 
                    sx={{ 
                      width: 32, 
                      height: 32,
                      bgcolor: 'transparent',
                      border: '2px solid rgba(255, 255, 255, 0.1)'
                    }}
                  >
                    <PersonIcon />
                  </Avatar>
                </IconButton>
                <Menu
                  id="menu-appbar"
                  anchorEl={anchorEl}
                  anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                  }}
                  keepMounted
                  transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                  }}
                  open={Boolean(anchorEl)}
                  onClose={handleClose}
                >
                  <MenuItem disabled>
                    <Typography variant="body2" color="text.secondary">
                      Signed in as {user?.name}
                    </Typography>
                  </MenuItem>
                  <MenuItem onClick={handleLogout}>Logout</MenuItem>
                </Menu>
              </>
            ) : (
              <>
                <Button
                  color="inherit"
                  component={RouterLink}
                  to="/login"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.7)',
                    '&:hover': {
                      color: 'white'
                    }
                  }}
                >
                  Sign In
                </Button>
                <Button
                  component={RouterLink}
                  to="/register"
                  variant="outlined"
                  sx={{
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    color: 'rgba(255, 255, 255, 0.9)',
                    '&:hover': {
                      borderColor: 'rgba(255, 255, 255, 0.2)',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)'
                    }
                  }}
                >
                  Sign Up
                </Button>
                <Button
                  onClick={() => setShowWalletDialog(true)}
                  variant="contained"
                  sx={{
                    background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                    '&:hover': {
                      background: 'linear-gradient(45deg, #4f46e5, #7c3aed)',
                    }
                  }}
                >
                  Connect Wallet
                </Button>
              </>
            )}
          </Box>
        </Toolbar>
      </AppBar>

      <WalletSignInDialog
        open={showWalletDialog}
        onClose={() => setShowWalletDialog(false)}
        onSignIn={handleWalletSignIn}
      />
    </>
  );
};

export default Navigation; 