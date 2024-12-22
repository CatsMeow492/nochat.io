import { IconButton, SvgIconTypeMap, useTheme } from "@mui/material";
import { OverridableComponent } from "@mui/material/OverridableComponent";

interface CallButtonProps {
  Icon: OverridableComponent<SvgIconTypeMap<{}, "svg">> & {
    muiName: string;
  };
  onClick?: () => void;
  color?: string;
  active?: boolean;
  isUrgent?: boolean;
  sx?: any;
}

const CallButton: React.FC<CallButtonProps> = ({
  Icon,
  onClick,
  color = "inherit",
  active = true,
  isUrgent = false,
  sx = {}
}) => {
  const theme = useTheme();
  
  return (
    <IconButton
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        backgroundColor: isUrgent 
          ? 'rgba(239, 68, 68, 0.1)'
          : 'rgba(255, 255, 255, 0.02)',
        transition: 'all 0.2s ease',
        "&:hover": { 
          backgroundColor: isUrgent 
            ? 'rgba(239, 68, 68, 0.15)'
            : 'rgba(255, 255, 255, 0.05)',
          transform: 'translateY(-1px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        },
        "&:active": {
          transform: 'translateY(0)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)',
        },
        border: `1px solid ${active ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)'}`,
        width: 48,
        height: 48,
        color: active 
          ? isUrgent 
            ? theme.palette.error.main
            : '#6366f1'
          : 'rgba(255, 255, 255, 0.5)',
        borderRadius: '12px',
        backdropFilter: 'blur(12px)',
        ...sx
      }}
    >
      <Icon 
        sx={{ 
          cursor: 'pointer',
          fontSize: '1.5rem',
          transition: 'all 0.2s ease'
        }} 
      />
    </IconButton>
  );
};

export { CallButton };
