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
}

const CallButton: React.FC<CallButtonProps> = ({
  Icon,
  onClick,
  color = "inherit",
  active = true,
  isUrgent = false
}) => {
  const theme = useTheme();
  
  return (
    <IconButton
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        backgroundColor: isUrgent 
          ? theme.palette.error.main 
          : theme.palette.background.paper,
        transition: 'all 0.3s ease',
        "&:hover": { 
          backgroundColor: isUrgent 
            ? theme.palette.error.dark
            : `${theme.palette.primary.main}20`,
          transform: 'translateY(-2px)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          "& .MuiSvgIcon-root": {
            color: theme.palette.primary.main
          }
        },
        "&:active": {
          transform: 'translateY(0)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        },
        border: `1px solid ${active ? theme.palette.primary.main + '40' : 'rgba(255,255,255,0.1)'}`,
        width: 48,
        height: 48,
        color: active ? theme.palette.primary.main : theme.palette.text.secondary,
        borderRadius: '12px',
        boxShadow: active ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
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
