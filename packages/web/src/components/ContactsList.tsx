import { Box, Typography, List, ListItem, ListItemAvatar, ListItemText, Avatar, Button, IconButton, CircularProgress } from '@mui/material';
import { VideoCall, PersonAdd } from '@mui/icons-material';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AddContactDialog from './AddContactDialog';

interface Contact {
  id: string;
  name: string;
  email?: string;
  wallet_address?: string;
}

interface ContactsListProps {
  userEmail?: string;
  userWallet?: string;
  userId: string;
}

function ContactsList({ userEmail, userWallet, userId }: ContactsListProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchContacts();
  }, [userId]);

  const fetchContacts = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`https://nochat.io/api/contacts?user_id=${userId}`);
      if (!res.ok) {
        throw new Error('Failed to fetch contacts');
      }
      const data = await res.json();
      console.log('API Response:', {
        status: res.status,
        data: data,
        userId
      });
      setContacts(data || []);
    } catch (err) {
      console.error('Error fetching contacts:', err);
      setError('Failed to load contacts');
      setContacts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddContact = async (identifier: string) => {
    try {
      // Check if it's a wallet address (0x followed by 40 hex characters)
      const isWallet = /^0x[a-fA-F0-9]{40}$/.test(identifier);
      
      // Get user ID by email or wallet
      const endpoint = isWallet ? 'by-wallet' : 'by-email';
      const param = isWallet ? 'wallet' : 'email';
      const userRes = await fetch(`https://nochat.io/api/users/${endpoint}?${param}=${encodeURIComponent(identifier)}`);
      
      if (!userRes.ok) {
        throw new Error('Failed to find user');
      }
      const userData = await userRes.json();

      // Add contact
      const res = await fetch('https://nochat.io/api/contacts/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          contact_id: userData.id,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to add contact');
      }

      // Refresh contacts list
      await fetchContacts();
    } catch (err) {
      console.error('Error adding contact:', err);
      setError('Failed to add contact');
    }
  };

  const handleStartCall = (contactId: string) => {
    // Generate a unique room ID based on user IDs (sorted to ensure consistency)
    const participants = [userId, contactId].sort();
    const roomId = `${participants[0]}-${participants[1]}`;
    navigate(`/room/${roomId}`);
  };

  const handleStartNewCall = () => {
    // Remove any existing room ID from localStorage
    localStorage.removeItem('roomId');
    // Navigate to join page
    navigate('/join');
  };

  const renderContent = () => {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      );
    }

    if (error) {
      return (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography color="error">{error}</Typography>
        </Box>
      );
    }

    if (!contacts || contacts.length === 0) {
      return (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
            No contacts yet. Add some to start calling!
          </Typography>
        </Box>
      );
    }

    return (
      <List sx={{ width: '100%' }}>
        {contacts.map((contact) => (
          <ListItem
            key={contact.id}
            secondaryAction={
              <IconButton
                edge="end"
                onClick={() => handleStartCall(contact.id)}
                sx={{
                  color: 'primary.main',
                  '&:hover': {
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                  },
                }}
              >
                <VideoCall />
              </IconButton>
            }
            sx={{
              borderRadius: '8px',
              mb: 1,
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
              },
            }}
          >
            <ListItemAvatar>
              <Avatar sx={{ bgcolor: 'primary.main' }}>
                {contact.name ? contact.name.charAt(0).toUpperCase() : '?'}
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={
                <Typography sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
                  {contact.name || 'Unknown'}
                </Typography>
              }
              secondary={
                <Typography sx={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.875rem' }}>
                  {contact.email || contact.wallet_address || 'No contact info'}
                </Typography>
              }
            />
          </ListItem>
        ))}
      </List>
    );
  };

  return (
    <>
      <Box
        sx={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          borderRadius: '16px',
          p: 2,
          width: '100%',
          maxWidth: '480px',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
            Contacts
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              startIcon={<VideoCall />}
              variant="contained"
              size="small"
              onClick={handleStartNewCall}
              sx={{
                textTransform: 'none',
                background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                '&:hover': {
                  background: 'linear-gradient(45deg, #4f46e5, #7c3aed)',
                },
              }}
            >
              Start a Call
            </Button>
            <Button
              startIcon={<PersonAdd />}
              variant="outlined"
              size="small"
              onClick={() => setShowAddContact(true)}
              sx={{
                textTransform: 'none',
                borderColor: 'rgba(255, 255, 255, 0.2)',
                color: 'rgba(255, 255, 255, 0.7)',
                '&:hover': {
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                },
              }}
            >
              Add Contact
            </Button>
          </Box>
        </Box>

        {renderContent()}
      </Box>

      <AddContactDialog
        open={showAddContact}
        onClose={() => setShowAddContact(false)}
        onAdd={handleAddContact}
      />
    </>
  );
}

export default ContactsList; 