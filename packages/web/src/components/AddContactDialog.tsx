import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Typography } from '@mui/material';
import { useState } from 'react';

interface AddContactDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (identifier: string) => void;
}

function AddContactDialog({ open, onClose, onAdd }: AddContactDialogProps) {
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');

  const isWalletAddress = (value: string) => {
    // Basic Ethereum address validation (0x followed by 40 hex characters)
    return /^0x[a-fA-F0-9]{40}$/.test(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Reset error
    setInputError('');

    // Validate input
    if (!inputValue) {
      setInputError('Email or wallet address is required');
      return;
    }

    const isEmail = inputValue.includes('@');
    const isWallet = isWalletAddress(inputValue);

    if (!isEmail && !isWallet) {
      setInputError('Invalid email or wallet address format');
      return;
    }

    // Check if user exists
    try {
      const endpoint = isWallet ? 'check-wallet' : 'check-email';
      const param = isWallet ? 'wallet' : 'email';
      const res = await fetch(`https://nochat.io/api/users/${endpoint}?${param}=${encodeURIComponent(inputValue)}`);
      const data = await res.json();
      
      if (!data.exists) {
        setInputError('User not found');
        return;
      }

      onAdd(inputValue);
      handleClose();
    } catch (err) {
      console.error('Error checking user:', err);
      setInputError('Failed to check user');
    }
  };

  const handleClose = () => {
    setInputValue('');
    setInputError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Add Contact</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
              Enter the email address or wallet address of the person you want to add as a contact.
            </Typography>
            <TextField
              label="Email or Wallet Address"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              error={!!inputError}
              helperText={inputError}
              fullWidth
              autoFocus
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button type="submit" variant="contained" color="primary">
            Add Contact
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default AddContactDialog; 