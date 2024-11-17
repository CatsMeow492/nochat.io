import { IconButton } from "@mui/material";
import theme from "../theme";

interface CallButtonProps {
  Icon: React.ElementType;
  onClick?: () => void;
  color?: string;
  active?: boolean;
}

const CallButton: React.FC<CallButtonProps> = ({
  Icon,
  onClick,
  color = "inherit",
  active = true,
}) => (
  <IconButton
    onClick={onClick}
    sx={{
      backgroundColor: theme.palette.background.paper,
      "&:hover": { backgroundColor: "action.hover" },
      border: "1px solid rgba(255, 255, 255, 0.1)",
      width: 48,
      height: 48,
      color: active ? '#eee' : "grey.500",
    }}
  >
    <Icon />
  </IconButton>
);

export { CallButton };
