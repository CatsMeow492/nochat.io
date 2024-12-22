import React, { useState, useEffect, memo } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Grid,
  CircularProgress,
  Fade,
  List,
  ListItem,
  ListItemText,
  IconButton,
  useTheme,
  Tooltip
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
import { RTCConfiguration as config } from '../config/webrtc';


interface LobbyOverlayProps {
  isInitiator: boolean;
  meetingStarted: boolean;
  onStartMeeting: () => void;
  participants?: Array<User>;
  userId: string | null;

  onReadyChange: (ready: boolean) => void;
  roomId?: string;
  onCameraToggle?: (enabled: boolean) => void;
  onMicrophoneToggle?: (enabled: boolean) => void;
  initialCameraEnabled?: boolean;
  initialMicrophoneEnabled?: boolean;
  mediaReady?: boolean;
}

/**
 * A lobby overlay displaying the current state of the lobby
 * `number of participants`
 * 
 */
const LobbyOverlay: React.FC<LobbyOverlayProps> = ({
  isInitiator: propIsInitiator,
  meetingStarted,
  onStartMeeting,
  participants: propParticipants,
  userId,
  roomId,
  onReadyChange,
  onCameraToggle = () => {},
  onMicrophoneToggle = () => {},
  initialCameraEnabled = true,
  initialMicrophoneEnabled = true,
  mediaReady = false,
}) => {
  const { participants, userCount } = useLobbyState({
    roomId,
    userId,
    initialIsInitiator: propIsInitiator,
  });

  // Use the prop instead of the hook value
  const isInitiator = propIsInitiator;

  // Add effect to log state changes
  useEffect(() => {
    console.log('Lobby state updated:', {
      mediaReady,
      isInitiator,
      participantsCount: participants.length,
      canStartMeeting: isInitiator && mediaReady && participants.length > 0
    });
  }, [mediaReady, isInitiator, participants]);

  const participantCount = participants.length;

  // State
  const [isReady, setIsReady] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // State controls for devices
  // TODO: Move logic to Redux store
  const [isCameraEnabled, setIsCameraEnabled] = useState<boolean>(initialCameraEnabled);
  const [isMicrophoneEnabled, setIsMicrophoneEnabled] = useState<boolean>(initialMicrophoneEnabled);

  // Only show start button when media is ready
  const canStartMeeting = isInitiator && mediaReady && participants.length > 0;

  const handleCameraToggle = () => {
    const newState = !isCameraEnabled;
    setIsCameraEnabled(newState);
    onCameraToggle?.(newState);
  };

  const handleMicrophoneToggle = () => {
    const newState = !isMicrophoneEnabled;
    setIsMicrophoneEnabled(newState);
    onMicrophoneToggle?.(newState);
  };

  // Copies window location to navigator clipboard
  // @dev This only works in a secure context, i.e. HTTPS
  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [turnConfigValid, setTurnConfigValid] = useState(false);

  useEffect(() => {
    validateTurnConfig().then(setTurnConfigValid);
  }, []);

  if (!meetingStarted) {
    return (
      <Fade in timeout={800}>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, rgba(0,0,0,0.15) 0%, rgba(25,25,35,0.12) 100%)',
            backdropFilter: 'blur(20px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
          }}
        >
                        <Box
        sx={{
          position: 'absolute',
          top: 10,
          right: 10,
          bgcolor: 'rgba(255,255,255,0.1)',
          padding: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <Typography variant="caption" sx={{ color: 'white', display: 'block' }}>
          UserID: {userId || 'Not set'}
        </Typography>
        <Typography variant="caption" sx={{ color: 'white', display: 'block' }}>
          RoomID: {roomId || 'Not set'}
        </Typography>
        <Typography variant="caption" sx={{ color: 'white', display: 'block' }}>
          Initiator: {isInitiator ? 'Yes' : 'No'}
        </Typography>
        <Typography variant="caption" sx={{ color: 'white', display: 'block' }}>
          Participants: {participantCount}
        </Typography>
        {/* Show TURN server status */}
        <Typography variant="caption" sx={{ color: 'white', display: 'block' }}>
          TURN Server: {turnConfigValid ? 'Connected' : 'Disconnected'}
        </Typography>
        {/* Show relay policy */}
        <Typography variant="caption" sx={{ color: 'white', display: 'block' }}>
          Relay Policy: {config.iceTransportPolicy}
        </Typography>
      </Box>
          <Paper
            elevation={0}
            sx={{
              width: '100%',
              maxWidth: '900px',
              mx: 3,
              background: 'linear-gradient(145deg, rgba(45,45,55,0.3) 20%, rgba(25,25,35,0.3) 65%)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '3px',
              backdropFilter: 'blur(12px)',
              p: { xs: 2, md: 4 },
              position: 'relative',
            }}
          >
            {/* Header */}
            <Box textAlign="center" mb={4}>
              <Typography
                fontSize={32}
                sx={{
                  color: 'rgba(255,255,255,0.9)',
                  fontWeight: 600,
                  mb: 1,
                }}
              >
                Secure Ephemeral Communication
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: '0.95rem',
                }}
              >
                {isInitiator
                  ? 'Ready to start the meeting? Waiting on at least one participant to join.'
                  : 'Waiting for host to start...'}
              </Typography>
            </Box>

            {/* Room Link */}
            <Box
              sx={{
                mb: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
         
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
            <Grid container spacing={2} mb={4}>
              <Grid item xs={12} md={4}>
                <DeviceToggle
                  enabled={isCameraEnabled}
                  onToggle={handleCameraToggle}
                  enabledIcon={VideocamIcon}
                  disabledIcon={VideocamOffIcon}
                  label="Camera"
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <DeviceToggle
                  enabled={isMicrophoneEnabled}
                  onToggle={handleMicrophoneToggle}
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
                    background: 'rgba(45,45,55,0.3)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  <GroupIcon sx={{ color: 'primary.main', fontSize: 20 }} />
                  <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem' }}>
                    {`${participantCount} Participant${participantCount !== 1 ? 's' : ''}`}
                  </Typography>
                </Paper>
              </Grid>
            </Grid>

            {/* Participants List */}
            <Paper
              sx={{
                mb: 4,
                background: 'rgba(45,45,55,0.3)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '3px',
                maxHeight: '150px',
                overflow: 'scroll',
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
                  // @ts-ignore
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
            <Box sx={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
              {
                isInitiator && (
                  <Button
                  variant="contained"
                  size="small"
                  disableElevation
                  onClick={onStartMeeting}
                  disabled={!canStartMeeting}
                  sx={{
                    minWidth: 130,
                    height: 36,
                    textTransform: 'none',
                    fontSize: '0.95rem',
                    fontWeight: 500,
                    borderRadius: '3px',
                    background: canStartMeeting
                      ? 'linear-gradient(135deg, #48bb78 100%, #38a169 100%)'
                      : 'linear-gradient(135deg, #4299e1 100%, #667eea 100%)',
                    opacity: canStartMeeting ? 1 : 0.5,
                    '&:hover': {
                      opacity: canStartMeeting ? 0.9 : 0.5,
                    },
                  }}
                >
                  {mediaReady ? (participants.length > 0 ? 'Start Meeting' : 'Waiting for participants...') : 'Setting up media...'}
                </Button>
                )
              }
             
            </Box>

            <Box sx={{ maxHeight: 350, overflow: 'scroll', mt: 6, borderTop: '1px solid rgba(255,255,255,0.08)', pt: 4 }}>
              <Typography
                component="h2"
                sx={{
                  fontSize: '1.5rem',
                  color: 'rgba(255,255,255,0.9)',
                  fontWeight: 600,
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

  // Once the meeting is started we no longer need to show
  // the overlay
  return null;
};

export default memo(LobbyOverlay)
