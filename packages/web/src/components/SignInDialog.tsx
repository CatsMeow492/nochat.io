import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box } from '@mui/material';
import { useState } from 'react';

interface SignInDialogProps {
  open: boolean;
  onClose: () => void;
  onSignIn: (email: string) => void;
}

function SignInDialog({ open, onClose, onSignIn }: SignInDialogProps) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Reset error
    setEmailError('');

    // Validate input
    if (!email) {
      setEmailError('Email is required');
      return;
    }
    if (!email.includes('@')) {
      setEmailError('Invalid email format');
      return;
    }

    // Check if email exists
    try {
      const res = await fetch(`https://nochat.io/api/users/check-email?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      
      if (!data.exists) {
        setEmailError('Email not found');
        return;
      }

      onSignIn(email);
    } catch (err) {
      console.error('Error checking email:', err);
    }
  };

  const handleClose = () => {
    setEmail('');
    setEmailError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Sign In</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={!!emailError}
              helperText={emailError}
              fullWidth
              autoFocus
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button type="submit" variant="contained" color="primary">
            Sign In
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default SignInDialog; 