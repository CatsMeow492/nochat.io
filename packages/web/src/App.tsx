import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AppBar from './components/appbar';
import Splash from './pages/splash';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import Profile from './pages/Profile';
import { Box } from '@mui/material';
import { CallSettingsProvider } from './context/provider';
import CallConfigurations from './pages/call_configurations';

const App: React.FC = () => {
  return (
    <Router>
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <AppBar />
        <Box component="main" sx={{ flexGrow: 1, mt: '64px' }}>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Splash />} />
            <Route 
              path="/join" 
              element={
                <CallSettingsProvider>
                  <CallConfigurations />
                </CallSettingsProvider>
              } 
            />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              path="/verify-email"
              element={
                <ProtectedRoute requireVerified={false}>
                  <VerifyEmail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />

            {/* Catch all route */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Box>
      </Box>
    </Router>
  );
};

export default App;
