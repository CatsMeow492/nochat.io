import { AppBar as MuiAppBar, styled, Box, Typography, useTheme } from "@mui/material";
import StyledToolbar from "./toolbar";

const StyledAppBar = styled(MuiAppBar)(({ theme }) => ({
  background: `linear-gradient(180deg, ${theme.palette.background.paper} 0%, rgba(19, 47, 76, 0.95) 100%)`,
  backdropFilter: 'blur(10px)',
  borderBottom: `1px solid ${theme.palette.primary.dark}40`,
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)'
}));

const LogoWrapper = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: theme.spacing(0, 1)
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
              fontWeight: 700,
              background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.primary.light})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '0.5px',
              textShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }}
          >
            phantom
          </Typography>
        </LogoWrapper>
      </StyledToolbar>
    </StyledAppBar>
  );
}

export default AppBar;