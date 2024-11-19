import { AppBar as MuiAppBar, styled } from "@mui/material";
import StyledToolbar from "./toolbar";
import Logo from '../logo.svg'

const StyledAppBar = styled(MuiAppBar)(({ theme }) => ({
  background: "transparent",
  backdropFilter: "blur(10px)",
  boxShadow: "none",
}));

function AppBar() {
    return (
      <StyledAppBar position="fixed">
      </StyledAppBar>
    );
  }

  export default AppBar
export { StyledAppBar }
