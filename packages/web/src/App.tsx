import './index.css';

import React from 'react';
import { CssBaseline } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { RouterProvider } from 'react-router-dom';
import theme from './theme';
import store from './services/redux';
import queryClient from './services/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { Provider } from 'react-redux';
import router from './services/react-router';

function WrappedApp() {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <App />
        </ThemeProvider>
      </QueryClientProvider>
    </Provider>
  );
}

function App() {
  return <RouterProvider router={router} />;
}

export default WrappedApp;
