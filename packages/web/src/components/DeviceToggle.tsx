import React, { useState, useEffect } from 'react';
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
      background: 'rgba(45,45,55,0.3)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '3px',
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      '&:hover': {
        background: 'rgba(45,45,55,0.4)',
      },
    }}
    onClick={onToggle}
  >
    {enabled ? (
      <EnabledIcon sx={{ color: 'primary.main', fontSize: 20 }} />
    ) : (
      <DisabledIcon sx={{ color: 'error.main', fontSize: 20 }} />
    )}
    <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', flex: 1 }}>
      {label}
    </Typography>
    <Switch
      size="small"
      checked={enabled}
      onChange={onToggle}
      sx={{
        '& .MuiSwitch-switchBase.Mui-checked': {
          color: 'primary.main',
        },
        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
          backgroundColor: 'primary.main',
        },
      }}
    />
  </Paper>
);

export default DeviceToggle;
