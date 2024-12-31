import React, { useState, useEffect, memo } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Grid,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Tooltip,
  Fade,
} from '@mui/material';
import {
  Mic as MicIcon,
  MicOff as MicOffIcon,
  Videocam as VideocamIcon,
  VideocamOff as VideocamOffIcon,
  Group as GroupIcon,
  ContentCopy as ContentCopyIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import DeviceToggle from '../components/DeviceToggle';
import { User } from '../hooks/useRoomList';
import { useLobbyState } from '../hooks/useLobbyState';
import { validateTurnConfig } from '../config/webrtc';
import websocketService from '../services/websocket';
import { useMediaStore } from '../store/mediaStore';

interface LobbyOverlayProps {
  isInitiator: boolean;
  meetingStarted: boolean;
  onStartMeeting: () => void;
  participants?: Array<User>;
  userId: string | null;
  onReadyChange: (ready: boolean) => void;
  roomId?: string;
  onCameraToggle: (enabled: boolean) => void;
  onMicrophoneToggle: (enabled: boolean) => void;
}

const LobbyOverlay: React.FC<LobbyOverlayProps> = ({
  isInitiator: propIsInitiator,
  meetingStarted,
  onStartMeeting,
  participants: propParticipants,
  userId,
  roomId,
  onReadyChange,
  onCameraToggle,
  onMicrophoneToggle,
}) => {
  const { participants, userCount, isInitiator, mediaReady } = useLobbyState({
    roomId,
    userId,
    initialIsInitiator: propIsInitiator,
  });

  // Get media state from store
  const { audioEnabled, videoEnabled } = useMediaStore();

  const participantCount = participants.length;

  // State
  const [copied, setCopied] = useState<boolean>(false);

  // Only show start button when media is ready
  const canStartMeeting = isInitiator && mediaReady && participants.length > 0;

  // Copies window location to navigator clipboard
  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [turnConfigValid, setTurnConfigValid] = useState(false);

  useEffect(() => {
    validateTurnConfig().then(setTurnConfigValid);
  }, []);

  const handleStartMeeting = () => {
    if (canStartMeeting) {
      websocketService.send('startMeeting', { roomId });
      onStartMeeting();
    }
  };

  if (!meetingStarted) {
    return (
      <Fade in timeout={800}>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(8, 8, 12, 0.85)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
          }}
        >
          <Paper
            elevation={0}
            sx={{
              width: '100%',
              maxWidth: '800px',
              mx: 3,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '24px',
              backdropFilter: 'blur(12px)',
              p: { xs: 3, md: 5 },
              position: 'relative',
            }}
          >
            {/* Header */}
            <Box textAlign="center" mb={5}>
              <Typography
                variant="h1"
                sx={{
                  fontSize: '2.5rem',
                  fontWeight: 800,
                  background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  mb: 2,
                }}
              >
                Ready to Connect
              </Typography>
              <Typography
                variant="body1"
                sx={{
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '1.1rem',
                }}
              >
                {isInitiator
                  ? 'Share this link with others to join your secure call.'
                  : 'Waiting for the host to start the call...'}
              </Typography>
            </Box>

            {/* Room Link */}
            <Box
              sx={{
                mb: 5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                py: 2,
                px: 3,
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontSize: '0.8rem',
                  color: 'rgba(255,255,255,0.7)',
                  fontFamily: 'monospace',
                }}
              >
                {window.location.href}
              </Typography>
              <Tooltip title={copied ? 'Copied!' : 'Copy link'}>
                <IconButton
                  size="small"
                  onClick={handleCopyLink}
                  sx={{ color: copied ? 'success.main' : 'primary.main' }}
                >
                  {copied ? (
                    <CheckIcon sx={{ fontSize: 16 }} fontSize="small" />
                  ) : (
                    <ContentCopyIcon sx={{ fontSize: 16 }} fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </Box>

            {/* Device Controls and Status */}
            <Grid container spacing={3} mb={5}>
              <Grid item xs={12} md={4}>
                <DeviceToggle
                  enabled={videoEnabled}
                  onToggle={() => onCameraToggle(!videoEnabled)}
                  enabledIcon={VideocamIcon}
                  disabledIcon={VideocamOffIcon}
                  label="Camera"
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <DeviceToggle
                  enabled={audioEnabled}
                  onToggle={() => onMicrophoneToggle(!audioEnabled)}
                  enabledIcon={MicIcon}
                  disabledIcon={MicOffIcon}
                  label="Microphone"
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 2,
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  <GroupIcon sx={{ color: '#6366f1', fontSize: 20 }} />
                  <Typography sx={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.9rem' }}>
                    {`${participantCount} Participant${participantCount !== 1 ? 's' : ''}`}
                  </Typography>
                </Paper>
              </Grid>
            </Grid>

            {/* Participants List */}
            <Paper
              sx={{
                mb: 5,
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                maxHeight: '200px',
                overflow: 'auto',
              }}
            >
              <List dense>
                {Array.isArray(participants) && participants.length == 0 && (
                  <Typography sx={{ color: 'rgba(255, 255, 255, 0.5)' }} px={3} variant="body2">
                    There are currently no participants ready to join the call.
                  </Typography>
                )}
                {participants.map((participant, index) => (
                  <ListItem
                    key={participant}
                    sx={{
                      borderBottom:
                        index !== participants.length - 1
                          ? '1px solid rgba(255,255,255,0.06)'
                          : 'none',
                    }}
                    secondaryAction={
                      <CheckIcon sx={{ color: 'success.main', fontSize: 22 }} />
                    }
                  >
                    <ListItemText
                      primary={
                        <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem' }}>
                          {participant}
                          {participant === userId && (
                            <span
                              style={{
                                color: 'primary.main',
                                marginLeft: '8px',
                                fontSize: '0.8rem',
                              }}
                            >
                              (You)
                            </span>
                          )}
                        </Typography>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </Paper>

            {/* Ready/Start Controls */}
            <Box sx={{ width: '100%', display: 'flex', justifyContent: 'center', mb: 4 }}>
              {isInitiator && (
                <Button
                  variant="contained"
                  size="large"
                  disableElevation
                  onClick={handleStartMeeting}
                  disabled={!canStartMeeting}
                  sx={{
                    minWidth: 200,
                    py: 2,
                    px: 6,
                    textTransform: 'none',
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    borderRadius: '12px',
                    background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                    opacity: canStartMeeting ? 1 : 0.5,
                    '&:hover': {
                      background: 'linear-gradient(45deg, #4f46e5, #7c3aed)',
                      opacity: canStartMeeting ? 1 : 0.5,
                    },
                  }}
                >
                  {mediaReady
                    ? participants.length > 0
                      ? 'Start Call'
                      : 'Waiting for Participants...'
                    : 'Setting up Media...'}
                </Button>
              )}
            </Box>

            {/* Privacy Section */}
            <Box
              sx={{
                maxHeight: 350,
                overflow: 'auto',
                mt: 4,
                pt: 4,
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              <Typography
                variant="h2"
                sx={{
                  fontSize: '1.75rem',
                  fontWeight: 700,
                  background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  mb: 3,
                }}
              >
                Protecting Your Privacy
              </Typography>

              <Typography
                sx={{
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '0.95rem',
                  mb: 3,
                  lineHeight: 1.6,
                }}
              >
                While we strive to provide a secure platform, we encourage you to take additional
                steps to safeguard your privacy. Here are some important recommendations:
              </Typography>

              <Box sx={{ mb: 4 }}>
                <Typography
                  component="h3"
                  sx={{
                    fontSize: '1.1rem',
                    color: 'rgba(255,255,255,0.85)',
                    fontWeight: 600,
                    mb: 2,
                  }}
                >
                  Device Security
                </Typography>

                <Typography
                  component="div"
                  sx={{
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: '0.95rem',
                    pl: 2,
                    borderLeft: '2px solid rgba(66,153,225,0.4)',
                    '& strong': {
                      color: 'rgba(255,255,255,0.9)',
                      fontWeight: 600,
                    },
                  }}
                >
                  <p>
                    <strong>Disable Voice Assistants:</strong> Turn off voice assistants like Siri
                    or Google Assistant when not in use. For additional security, consider turning
                    off your phone and unplugging "smart" appliances during sensitive conversations.
                  </p>

                  <p>
                    <strong>Update Software:</strong> Regularly update your device's operating
                    system and application software to address security vulnerabilities and ensure
                    optimal protection.
                  </p>

                  <p>
                    <strong>Secure Wi-Fi Networks:</strong> Use strong, unique passwords for your
                    Wi-Fi network and consider using a VPN for added protection during sensitive
                    communications.
                  </p>
                </Typography>
              </Box>

              <Box>
                <Typography
                  component="h3"
                  sx={{
                    fontSize: '1.1rem',
                    color: 'rgba(255,255,255,0.85)',
                    fontWeight: 600,
                    mb: 2,
                  }}
                >
                  App Permissions
                </Typography>

                <Typography
                  component="div"
                  sx={{
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: '0.95rem',
                    pl: 2,
                    borderLeft: '2px solid rgba(66,153,225,0.4)',
                    '& strong': {
                      color: 'rgba(255,255,255,0.9)',
                      fontWeight: 600,
                    },
                  }}
                >
                  <p>
                    <strong>Review App Permissions:</strong> Carefully review and limit the
                    permissions granted to applications on your device. Only provide necessary
                    access rights.
                  </p>

                  <p>
                    <strong>Minimize Microphone and Camera Access:</strong> Only allow applications
                    to access your microphone and camera when absolutely necessary for
                    functionality.
                  </p>
                </Typography>
              </Box>
            </Box>
          </Paper>
        </Box>
      </Fade>
    );
  }

  return null;
};

export default memo(LobbyOverlay);
