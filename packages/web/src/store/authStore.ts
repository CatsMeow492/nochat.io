import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BASE_URL } from '../config/webrtc';

interface User {
  id: string;
  email?: string;
  name: string;
  walletAddress?: string;
  emailVerified: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  register: (email: string, name: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithWallet: (walletAddress: string) => Promise<void>;
  logout: () => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      clearError: () => set({ error: null }),

      register: async (email: string, name: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`${BASE_URL}/api/users/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name, password }),
            credentials: 'include',
          });

          if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
          }

          const data = await response.json();
          set({ user: data, isAuthenticated: true });
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to register' });
        } finally {
          set({ isLoading: false });
        }
      },

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`${BASE_URL}/api/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'include',
          });

          if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
          }

          const data = await response.json();
          set({ user: data.user, isAuthenticated: true });
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to login' });
        } finally {
          set({ isLoading: false });
        }
      },

      loginWithWallet: async (walletAddress: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`${BASE_URL}/api/users/by-wallet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress }),
            credentials: 'include',
          });

          if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
          }

          const data = await response.json();
          set({ user: data, isAuthenticated: true });
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to login with wallet' });
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`${BASE_URL}/api/users/logout`, {
            method: 'POST',
            credentials: 'include',
          });

          // Even if the server returns 400 (no session), we still want to clear the local state
          if (!response.ok && response.status !== 400) {
            const error = await response.text();
            throw new Error(error);
          }

          // Clear the store state
          set({ user: null, isAuthenticated: false, error: null, isLoading: false });
          
          // Clear persisted state from localStorage
          window.localStorage.removeItem('auth-storage');
        } catch (error) {
          // Don't set error state if it was a 400, just clear the state
          if (error instanceof Error && !error.message.includes('400')) {
            set({ error: error instanceof Error ? error.message : 'Failed to logout' });
          }
        } finally {
          set({ isLoading: false });
        }
      },

      verifyEmail: async (token: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`${BASE_URL}/api/users/verify-email?token=${token}`, {
            method: 'POST',
            credentials: 'include',
          });

          if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
          }

          if (get().user) {
            set({ user: { ...get().user!, emailVerified: true } });
          }
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to verify email' });
        } finally {
          set({ isLoading: false });
        }
      },

      requestPasswordReset: async (email: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`${BASE_URL}/api/users/request-password-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
            credentials: 'include',
          });

          if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
          }
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to request password reset' });
        } finally {
          set({ isLoading: false });
        }
      },

      resetPassword: async (token: string, newPassword: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`${BASE_URL}/api/users/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, newPassword }),
            credentials: 'include',
          });

          if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
          }
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to reset password' });
        } finally {
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'auth-storage',
    }
  )
); 