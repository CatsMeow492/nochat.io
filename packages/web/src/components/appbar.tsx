import { AppBar as MuiAppBar, styled, Box, Typography, useTheme } from "@mui/material";
import StyledToolbar from "./toolbar";

const StyledAppBar = styled(MuiAppBar)(({ theme }) => ({
  background: 'rgba(8, 8, 12, 0.7)',
  backdropFilter: 'blur(12px)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  boxShadow: 'none'
}));

const LogoWrapper = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: theme.spacing(0, 2)
}));

function AppBar() {
  const theme = useTheme();
  
  return (
    <StyledAppBar position="fixed">
      <StyledToolbar>
        <LogoWrapper>
          <Typography 
            variant="h6" 
            sx={{ 
              fontWeight: 800,
              background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '0.5px',
              fontSize: '1.25rem'
            }}
          >
            nochat.io
          </Typography>
        </LogoWrapper>
      </StyledToolbar>
    </StyledAppBar>
  );
}

export default AppBar;