import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box } from '@mui/material';
import { useState } from 'react';

interface SignUpDialogProps {
  open: boolean;
  onClose: () => void;
  onSignUp: (email: string, name: string) => void;
}

function SignUpDialog({ open, onClose, onSignUp }: SignUpDialogProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [emailError, setEmailError] = useState('');
  const [nameError, setNameError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Reset errors
    setEmailError('');
    setNameError('');

    // Validate inputs
    let hasError = false;
    if (!email) {
      setEmailError('Email is required');
      hasError = true;
    } else if (!email.includes('@')) {
      setEmailError('Invalid email format');
      hasError = true;
    }

    if (!name) {
      setNameError('Name is required');
      hasError = true;
    }

    if (hasError) return;

    // Check if email exists
    try {
      const res = await fetch(`https://nochat.io/api/users/check-email?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      
      if (data.exists) {
        setEmailError('Email already exists');
        return;
      }

      onSignUp(email, name);
    } catch (err) {
      console.error('Error checking email:', err);
    }
  };

  const handleClose = () => {
    setEmail('');
    setName('');
    setEmailError('');
    setNameError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Sign Up</DialogTitle>
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
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={!!nameError}
              helperText={nameError}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button type="submit" variant="contained" color="primary">
            Sign Up
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default SignUpDialog; 