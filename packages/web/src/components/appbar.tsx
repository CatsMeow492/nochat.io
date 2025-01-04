import { AppBar as MuiAppBar, styled, Box, Typography, useTheme, Button, Avatar, Menu, MenuItem, IconButton, Divider } from "@mui/material";
import { useState, useEffect } from "react";
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import StyledToolbar from "./toolbar";
import SignUpDialog from "./SignUpDialog";
import SignInDialog from "./SignInDialog";
import WalletSignInDialog from "./WalletSignInDialog";
import { useAuthStore } from '../store/authStore';

const StyledAppBar = styled(MuiAppBar)({
  background: 'rgba(8, 8, 12, 0.7)',
  backdropFilter: 'blur(10px)',
  boxShadow: 'none',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
});

const LogoWrapper = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
});

const AuthButtons = styled(Box)({
  display: 'flex',
  gap: '16px',
  marginLeft: 'auto',
  alignItems: 'center',
});

function AppBar() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user, isAuthenticated, login, loginWithWallet, logout } = useAuthStore();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [showSignUp, setShowSignUp] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [showWalletSignIn, setShowWalletSignIn] = useState(false);

  useEffect(() => {
    // Ensure isAuthenticated is true when we have a user
    if (user && !isAuthenticated) {
      console.log('User exists but not authenticated, fixing state...');
      useAuthStore.setState({ isAuthenticated: true });
    }
    // Ensure isAuthenticated is false when we don't have a user
    if (!user && isAuthenticated) {
      console.log('No user but authenticated, fixing state...');
      useAuthStore.setState({ isAuthenticated: false });
    }
  }, [user, isAuthenticated]);

  const handleSignUp = async (email: string, name: string, password: string) => {
    try {
      const res = await fetch('https://nochat.io/api/users/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, name, password }),
        credentials: 'include',
      });
      
      if (!res.ok) {
        throw new Error('Signup failed');
      }

      const data = await res.json();
      useAuthStore.setState({ user: data, isAuthenticated: false });
      setShowSignUp(false);
      navigate('/verify-email');
    } catch (err) {
      console.error('Error signing up:', err);
    }
  };

  const handleSignIn = async (email: string, password: string) => {
    try {
      await login(email, password);
      setShowSignIn(false);
    } catch (err) {
      console.error('Error signing in:', err);
    }
  };

  const handleWalletSignIn = async (address: string) => {
    try {
      await loginWithWallet(address);
      setShowWalletSignIn(false);
    } catch (err) {
      console.error('Error signing in with wallet:', err);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setAnchorEl(null);
    navigate('/');
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };
  
  return (
    <StyledAppBar position="fixed">
      <StyledToolbar>
        <LogoWrapper>
          <Typography 
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{ 
              fontWeight: 800,
              background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '0.5px',
              fontSize: '1.25rem',
              textDecoration: 'none',
              '&:hover': {
                textDecoration: 'none',
              },
            }}
          >
            nochat.io
          </Typography>
        </LogoWrapper>

        {isAuthenticated ? (
          <Box sx={{ display: 'flex', gap: 2, marginLeft: 'auto', alignItems: 'center' }}>
            {user?.walletAddress && (
              <Typography
                variant="body2"
                sx={{
                  color: 'rgba(255, 255, 255, 0.7)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  fontFamily: 'monospace'
                }}
              >
                {user.walletAddress.slice(0, 6)}...{user.walletAddress.slice(-4)}
              </Typography>
            )}
            <IconButton
              onClick={handleMenuOpen}
            >
              <Avatar sx={{ bgcolor: theme.palette.primary.main }}>
                {user?.name.charAt(0).toUpperCase()}
              </Avatar>
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right',
              }}
              transformOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
            >
              <MenuItem disabled>
                <Typography variant="body2" color="text.secondary">
                  Signed in as {user?.name}
                </Typography>
              </MenuItem>
              <Divider />
              <MenuItem onClick={() => {
                handleMenuClose();
                navigate('/profile');
              }}>
                Profile
              </MenuItem>
              <MenuItem onClick={handleSignOut}>Sign Out</MenuItem>
            </Menu>
          </Box>
        ) : (
          <AuthButtons>
            <Button
              variant="outlined"
              color="primary"
              onClick={() => setShowSignIn(true)}
              sx={{
                borderColor: 'rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.9)',
                height: '36px',
                '&:hover': {
                  borderColor: 'rgba(255, 255, 255, 0.2)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)'
                }
              }}
            >
              Sign In
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={() => setShowSignUp(true)}
              sx={{
                background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                height: '36px',
                '&:hover': {
                  background: 'linear-gradient(45deg, #4f46e5, #7c3aed)',
                }
              }}
            >
              Sign Up
            </Button>
            <Button
              variant="outlined"
              color="primary"
              onClick={() => setShowWalletSignIn(true)}
              sx={{
                borderColor: 'rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.9)',
                height: '36px',
                '&:hover': {
                  borderColor: 'rgba(255, 255, 255, 0.2)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)'
                }
              }}
            >
              Connect Wallet
            </Button>
          </AuthButtons>
        )}
      </StyledToolbar>

      <SignUpDialog
        open={showSignUp}
        onClose={() => setShowSignUp(false)}
        onSignUp={handleSignUp}
      />
      <SignInDialog
        open={showSignIn}
        onClose={() => setShowSignIn(false)}
        onSignIn={handleSignIn}
      />
      <WalletSignInDialog
        open={showWalletSignIn}
        onClose={() => setShowWalletSignIn(false)}
        onSignIn={handleWalletSignIn}
      />
    </StyledAppBar>
  );
}

export default AppBar;