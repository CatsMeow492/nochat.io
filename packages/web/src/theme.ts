import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#00B4D8',
      light: '#48CAE4',
      dark: '#0096C7'
    },
    secondary: {
      main: '#023E8A',
      light: '#0077B6',
      dark: '#03045E'
    },
    background: {
      default: '#0A1929',
      paper: '#132F4C'
    },
    text: {
      primary: '#F8F9FA',
      secondary: '#ADB5BD'
    }
  },
  typography: {
    fontFamily: "'Inter', sans-serif",
    h1: {
      fontSize: '2.5rem',
      fontWeight: 600
    },
    h2: {
      fontSize: '2rem',
      fontWeight: 600
    },
    body1: {
      fontSize: '1rem',
      lineHeight: 1.5
    }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none',
          fontWeight: 500
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none'
        }
      }
    }
  }
});

export default theme;