import { AppBar as MuiAppBar, styled } from "@mui/material";
import StyledToolbar from "./toolbar";
import Logo from '../logo.png';

const StyledAppBar = styled(MuiAppBar)(({ theme }) => ({
  background: "transparent",
  backdropFilter: "blur(10px)",
  boxShadow: "none",
}));

const LogoWrapper = styled('div')({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  padding: '0 5px',
});

function AppBar() {
  return (
    <StyledAppBar position="fixed">
      <StyledToolbar>
        <LogoWrapper>
          <img 
            src={Logo} 
            alt="Logo" 
            style={{ 
    height: 25,
              // height: '140px', 
              // width: '190px',
       
           //   objectFit: 'contain',
            }} 
          />
        </LogoWrapper>
      </StyledToolbar>
    </StyledAppBar>
  );
}

export default AppBar;
export { StyledAppBar };