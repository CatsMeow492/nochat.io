import React from 'react';
import {
  Typography,
  Paper,
  Switch,
} from '@mui/material';

interface IDeviceToggleProps {
  enabled: boolean;
  onToggle: () => void;
  enabledIcon: React.ElementType;
  disabledIcon: React.ElementType;
  label: string;
}

/**
 * Device toggle component encompassing logic to display and toggle
 * an icon state [enabled/disabled].
 */
const DeviceToggle = ({
  enabled,
  onToggle,
  enabledIcon: EnabledIcon,
  disabledIcon: DisabledIcon,
  label,
}: IDeviceToggleProps) => (
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
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      backdropFilter: 'blur(12px)',
      '&:hover': {
        background: 'rgba(255, 255, 255, 0.05)',
        transform: 'translateY(-1px)',
      },
      '&:active': {
        transform: 'translateY(0)',
      },
    }}
    onClick={onToggle}
  >
    {enabled ? (
      <EnabledIcon sx={{ color: '#6366f1', fontSize: 20 }} />
    ) : (
      <DisabledIcon sx={{ color: '#ef4444', fontSize: 20 }} />
    )}
    <Typography 
      sx={{ 
        color: enabled ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.7)', 
        fontSize: '0.9rem', 
        flex: 1,
        fontWeight: 500,
      }}
    >
      {label}
    </Typography>
    <Switch
      size="small"
      checked={enabled}
      onChange={onToggle}
      sx={{
        '& .MuiSwitch-switchBase': {
          color: 'rgba(255, 255, 255, 0.7)',
          '&.Mui-checked': {
            color: '#6366f1',
          },
          '&.Mui-checked + .MuiSwitch-track': {
            backgroundColor: '#6366f1',
            opacity: 0.5,
          },
        },
        '& .MuiSwitch-track': {
          backgroundColor: 'rgba(255, 255, 255, 0.2)',
        },
      }}
    />
  </Paper>
);

export default DeviceToggle;
