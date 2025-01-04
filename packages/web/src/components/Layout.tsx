import React from 'react';
import { Box, Container, Paper } from '@mui/material';

interface LayoutProps {
  children: React.ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  noPaper?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ children, maxWidth = 'sm', noPaper = false }) => {
  const content = noPaper ? (
    children
  ) : (
    <Paper
      elevation={3}
      sx={{
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
      }}
    >
      {children}
    </Paper>
  );

  return (
    <Container component="main" maxWidth={maxWidth}>
      <Box
        sx={{
          marginTop: 8,
          marginBottom: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {content}
      </Box>
    </Container>
  );
};

export default Layout; 