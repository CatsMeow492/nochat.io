import { IconButton, SvgIconTypeMap } from "@mui/material";
import theme from "../theme";
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
}) => (
  <IconButton
    onClick={onClick}
    sx={{
      cursor: 'pointer',
      backgroundColor: isUrgent ? 'red' : theme.palette.background.paper,
      "&:hover": { 
        backgroundColor: "action.hover",
        "& .MuiSvgIcon-root": {
          color: '#fff'  
        }
      },
      border: "1px solid rgba(255, 255, 255, 0.1)",
      width: 48,
      height: 48,
      color: active ? '#eee' : "grey.500",


    }}
  >
    <Icon sx={{ cursor: 'pointer' }} />
  </IconButton>
);

export { CallButton };
