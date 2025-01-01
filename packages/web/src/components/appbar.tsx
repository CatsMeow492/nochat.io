import { AppBar as MuiAppBar, styled, Box, Typography, useTheme, Button, Avatar, Menu, MenuItem, IconButton, Divider } from "@mui/material";
import { useState, useEffect } from "react";
import StyledToolbar from "./toolbar";
import SignUpDialog from "./SignUpDialog";
import SignInDialog from "./SignInDialog";
import WalletSignInDialog from "./WalletSignInDialog";

const StyledAppBar = styled(MuiAppBar)(({ theme }) => ({
  background: 'rgba(8, 8, 12, 0.7)',
  backdropFilter: 'blur(12px)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  boxShadow: 'none'
}));

const LogoWrapper = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: theme.spacing(0, 2)
}));

const AuthButtons = styled(Box)(({ theme }) => ({
  marginLeft: 'auto',
  display: 'flex',
  gap: theme.spacing(2)
}));

interface User {
  id: string;
  email?: string;
  name: string;
  wallet_address?: string;
  isAnonymous?: boolean;
}

function AppBar() {
  const theme = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [showSignUp, setShowSignUp] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [showWalletSignIn, setShowWalletSignIn] = useState(false);

  useEffect(() => {
    const fetchUserData = async () => {
      const userId = localStorage.getItem('userId');
      
      // Skip fetching for anonymous users
      if (userId?.startsWith('anon_')) {
        setUser({
          id: userId,
          name: 'Anonymous User',
          isAnonymous: true
        });
        return;
      }

      try {
        const response = await fetch(`https://nochat.io/api/users/${userId}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const userData = await response.json();
        setUser(userData);
      } catch (error) {
        console.error('Error fetching user:', error);
        // Handle error gracefully
      }
    };

    fetchUserData();
  }, []);

  const handleSignUp = async (email: string, name: string) => {
    try {
      const res = await fetch('https://nochat.io/api/users/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, name }),
      });
      
      if (!res.ok) {
        throw new Error('Signup failed');
      }

      const data = await res.json();
      setUser(data);
      localStorage.setItem('userId', data.id);
      setShowSignUp(false);
    } catch (err) {
      console.error('Error signing up:', err);
    }
  };

  const handleSignIn = async (email: string) => {
    try {
      const res = await fetch(`https://nochat.io/api/users/check-email?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      
      if (!data.exists) {
        throw new Error('User not found');
      }

      // In a real app, you'd verify the user's identity here
      // For now, we'll just fetch the user details by email
      const userRes = await fetch(`https://nochat.io/api/users/by-email?email=${encodeURIComponent(email)}`);
      const userData = await userRes.json();
      
      setUser(userData);
      localStorage.setItem('userId', userData.id);
      setShowSignIn(false);
    } catch (err) {
      console.error('Error signing in:', err);
    }
  };

  const handleWalletSignIn = async (address: string, name: string) => {
    try {
      // First check if the wallet exists
      const checkRes = await fetch(`https://nochat.io/api/users/check-wallet?wallet=${address}`);
      const checkData = await checkRes.json();
      
      if (checkData.exists) {
        // Get existing user
        const userRes = await fetch(`https://nochat.io/api/users/by-wallet?wallet=${address}`);
        const userData = await userRes.json();
        setUser(userData);
        localStorage.setItem('userId', userData.id);
      } else {
        // Create new user with wallet
        const signupRes = await fetch('https://nochat.io/api/users/signup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ wallet_address: address, name }),
        });
        
        if (!signupRes.ok) {
          const errorText = await signupRes.text();
          console.error('Signup response:', errorText);
          throw new Error('Wallet signup failed');
        }

        const newUser = await signupRes.json();
        setUser(newUser);
        localStorage.setItem('userId', newUser.id);
      }
      
      setShowWalletSignIn(false);
    } catch (err) {
      console.error('Error signing in with wallet:', err);
    }
  };

  const handleSignOut = () => {
    setUser(null);
    localStorage.removeItem('userId');
    setAnchorEl(null);
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
            sx={{ 
              fontWeight: 800,
              background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '0.5px',
              fontSize: '1.25rem'
            }}
          >
            nochat.io
          </Typography>
        </LogoWrapper>

        {user ? (
          <>
            <IconButton
              onClick={handleMenuOpen}
              sx={{ marginLeft: 'auto' }}
            >
              <Avatar sx={{ bgcolor: theme.palette.primary.main }}>
                {user.name.charAt(0).toUpperCase()}
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
              <MenuItem disabled>{user.email || user.wallet_address}</MenuItem>
              <MenuItem onClick={handleSignOut}>Sign Out</MenuItem>
            </Menu>
          </>
        ) : (
          <AuthButtons>
            <Button
              variant="outlined"
              color="primary"
              onClick={() => setShowSignIn(true)}
            >
              Sign In
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={() => setShowSignUp(true)}
            >
              Sign Up
            </Button>
            <Button
              variant="outlined"
              color="primary"
              onClick={() => setShowWalletSignIn(true)}
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