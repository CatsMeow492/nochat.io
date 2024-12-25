import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, CircularProgress } from '@mui/material';
import { useState } from 'react';
import { ethers } from 'ethers';

interface WalletSignInDialogProps {
  open: boolean;
  onClose: () => void;
  onSignIn: (address: string, name: string) => void;
}

function WalletSignInDialog({ open, onClose, onSignIn }: WalletSignInDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    setLoading(true);
    setError('');

    try {
      // Check if MetaMask is installed
      if (!window.ethereum) {
        throw new Error('Please install MetaMask to use this feature');
      }

      // Request account access
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const address = accounts[0];

      // Check if wallet exists
      const checkRes = await fetch(`https://nochat.io/api/users/check-wallet?wallet=${address}`);
      const responseText = await checkRes.text(); // Get raw response
      console.log('Raw server response:', responseText); // Debug log
      
      if (!checkRes.ok) {
        throw new Error(`Server error: ${checkRes.status} - ${responseText}`);
      }
      
      try {
        const checkData = JSON.parse(responseText);
        
        if (checkData.exists) {
          // Get existing user
          const userRes = await fetch(`https://nochat.io/api/users/by-wallet?wallet=${address}`);
          if (!userRes.ok) {
            console.error('User fetch error:', await userRes.text());
            throw new Error(`User fetch failed: ${userRes.status}`);
          }
          const userData = await userRes.json();
          onSignIn(address, userData.name);
        } else {
          // Try to get ENS name
          let name = '';
          try {
            const ensName = await provider.lookupAddress(address);
            if (ensName) {
              name = ensName;
            } else {
              // Use shortened address as name if no ENS name
              name = `${address.slice(0, 6)}...${address.slice(-4)}`;
            }
          } catch (err) {
            console.error('Error getting ENS name:', err);
            // Use shortened address as name if ENS lookup fails
            name = `${address.slice(0, 6)}...${address.slice(-4)}`;
          }

          onSignIn(address, name);
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        throw new Error('Invalid server response format');
      }
    } catch (err: any) {
      console.error('Detailed error:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect Wallet</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2, alignItems: 'center' }}>
          {error ? (
            <Typography color="error">{error}</Typography>
          ) : (
            <Typography>
              Connect your Ethereum wallet to sign in. If you have an ENS name, we'll use it as your display name.
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleConnect}
          variant="contained"
          color="primary"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} /> : null}
        >
          Connect Wallet
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default WalletSignInDialog; 