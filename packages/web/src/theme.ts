import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    background: {
      default: "#18181A",
      paper: "#1E1E24",
    },
    primary: {
      main: '#3366cc', 
    },
    text: {
      primary: '#ffffff', 
    },
  },
  typography: {
    fontFamily: 'Roboto, Arial, sans-serif',
  },
});


export default theme;