import { useState } from 'react';
import { Container, Paper, Typography, TextField, Button, Box, Avatar, useTheme } from '@mui/material';
import { useAuthStore } from '../store/authStore';

function Profile() {
  const theme = useTheme();
  const { user, isAuthenticated } = useAuthStore();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = async () => {
    try {
      const response = await fetch('https://nochat.io/api/users/update-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          email,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to update profile');
      }

      const updatedUser = await response.json();
      useAuthStore.setState({ user: updatedUser });
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
    }
  };

  if (!isAuthenticated || !user) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Typography>Please sign in to view your profile.</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Paper sx={{ p: 4, borderRadius: 2, bgcolor: 'rgba(255, 255, 255, 0.05)' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <Avatar 
            sx={{ 
              width: 100, 
              height: 100, 
              bgcolor: theme.palette.primary.main,
              fontSize: '2.5rem'
            }}
          >
            {user.name.charAt(0).toUpperCase()}
          </Avatar>

          <Typography variant="h5" sx={{ mb: 2 }}>Profile Settings</Typography>

          {user.walletAddress && (
            <TextField
              fullWidth
              label="Wallet Address"
              value={user.walletAddress}
              disabled
              sx={{ mb: 2 }}
            />
          )}

          <TextField
            fullWidth
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isEditing}
            sx={{ mb: 2 }}
          />

          {user.email && (
            <TextField
              fullWidth
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!isEditing}
              sx={{ mb: 2 }}
            />
          )}

          {isEditing ? (
            <Box sx={{ display: 'flex', gap: 2, width: '100%' }}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => {
                  setIsEditing(false);
                  setName(user.name);
                  setEmail(user.email || '');
                }}
              >
                Cancel
              </Button>
              <Button
                fullWidth
                variant="contained"
                onClick={handleSave}
              >
                Save Changes
              </Button>
            </Box>
          ) : (
            <Button
              fullWidth
              variant="contained"
              onClick={() => setIsEditing(true)}
            >
              Edit Profile
            </Button>
          )}
        </Box>
      </Paper>
    </Container>
  );
}

export default Profile; 