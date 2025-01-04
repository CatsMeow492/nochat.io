import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import {
  Box,
  Button,
  Container,
  Typography,
  Alert,
  Link as MuiLink,
  Paper,
  CircularProgress,
} from '@mui/material';

const VerifyEmail: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { verifyEmail, error, isLoading, clearError, user } = useAuthStore();
  const [verificationStatus, setVerificationStatus] = useState<'pending' | 'success' | 'error'>(
    'pending'
  );

  useEffect(() => {
    const verify = async () => {
      if (token) {
        clearError();
        await verifyEmail(token);
        if (!error) {
          setVerificationStatus('success');
          setTimeout(() => {
            navigate('/');
          }, 3000);
        } else {
          setVerificationStatus('error');
        }
      }
    };

    verify();
  }, [token, verifyEmail, clearError, error, navigate]);

  if (!token) {
    return (
      <Container component="main" maxWidth="xs">
        <Box
          sx={{
            marginTop: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
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
            <Typography component="h1" variant="h5" gutterBottom>
              Verify Your Email
            </Typography>
            <Typography variant="body1" align="center" sx={{ mt: 2 }}>
              {user?.email
                ? `We've sent a verification email to ${user.email}. Please check your inbox and click the verification link.`
                : 'Please check your email for the verification link we sent you.'}
            </Typography>
            <Box sx={{ mt: 3 }}>
              <MuiLink component={Link} to="/" variant="body2">
                Return to Home
              </MuiLink>
            </Box>
          </Paper>
        </Box>
      </Container>
    );
  }

  return (
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
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
          {verificationStatus === 'pending' && (
            <>
              <Typography component="h1" variant="h5" gutterBottom>
                Verifying Email
              </Typography>
              <Box sx={{ mt: 3 }}>
                <CircularProgress />
              </Box>
            </>
          )}

          {verificationStatus === 'success' && (
            <>
              <Typography component="h1" variant="h5" gutterBottom>
                Email Verified
              </Typography>
              <Typography variant="body1" align="center" sx={{ mt: 2 }}>
                Your email has been successfully verified. You will be redirected to the home page in a
                few seconds.
              </Typography>
              <Box sx={{ mt: 3 }}>
                <MuiLink component={Link} to="/" variant="body2">
                  Go to Home
                </MuiLink>
              </Box>
            </>
          )}

          {verificationStatus === 'error' && (
            <>
              <Typography component="h1" variant="h5" color="error" gutterBottom>
                Verification Failed
              </Typography>
              {error && (
                <Alert severity="error" sx={{ mt: 2, width: '100%' }}>
                  {error}
                </Alert>
              )}
              <Typography variant="body1" align="center" sx={{ mt: 2 }}>
                The verification link is invalid or has expired. Please request a new verification
                email.
              </Typography>
              <Box sx={{ mt: 3 }}>
                <Button
                  variant="contained"
                  onClick={() => {
                    // TODO: Implement resend verification email
                  }}
                  disabled={isLoading}
                >
                  Resend Verification Email
                </Button>
              </Box>
            </>
          )}
        </Paper>
      </Box>
    </Container>
  );
};

export default VerifyEmail; 