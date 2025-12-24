"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, AuthError } from "@/lib/api";
import { useAuthStore, type User } from "@/stores";
import { useEffect } from "react";

// Debug logging for Tauri
async function debugLog(message: string) {
  if (typeof window !== 'undefined' && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("debug_log", { message: `[useAuth] ${message}` });
    } catch {
      // Ignore
    }
  }
}

// Transform backend user response to frontend User type
// Backend uses snake_case (is_anonymous), frontend uses camelCase (isAnonymous)
function transformUser(backendUser: any): User {
  return {
    id: backendUser.id,
    username: backendUser.username,
    email: backendUser.email,
    isAnonymous: backendUser.is_anonymous ?? false,
    walletAddress: backendUser.wallet_address,
    createdAt: backendUser.created_at,
  };
}

export function useAuth() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, token, isAuthenticated, setUser, logout, clearAuth, setLoading, _hasHydrated } =
    useAuthStore();

  // Check auth on mount - only after hydration is complete
  const { data, isLoading: isLoadingUser, error, isFetched, isFetching } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      debugLog(`Fetching /me API...`);
      try {
        const result = await api.getMe();
        debugLog(`/me API success - user: ${result?.user?.id}`);
        return result;
      } catch (e) {
        debugLog(`/me API error: ${e}`);
        throw e;
      }
    },
    enabled: _hasHydrated && !!token, // Wait for hydration before checking token
    staleTime: 30000, // Consider fresh for 30 seconds to avoid race conditions on login
    gcTime: 60000, // Keep in cache for 1 minute
    retry: (failureCount, error) => {
      // Never retry on auth errors
      if (error instanceof AuthError) return false;
      // Limit other retries
      return failureCount < 2;
    },
  });

  // Log query state changes
  useEffect(() => {
    debugLog(`Query state - enabled: ${_hasHydrated && !!token}, isFetched: ${isFetched}, hasData: ${!!data?.user}, error: ${error?.message || 'none'}`);
  }, [_hasHydrated, token, isFetched, data, error]);

  // Auth is verified only after we've hydrated, fetched, and got valid user data
  const isAuthVerified = _hasHydrated && isFetched && !!data?.user && !error;

  useEffect(() => {
    // Handle auth errors - clear auth state completely but don't redirect
    if (error instanceof AuthError) {
      // Clear token from localStorage
      localStorage.removeItem("token");
      // Clear zustand store (this sets isAuthenticated to false, no redirect)
      clearAuth();
      return;
    }

    if (data?.user && token) {
      setUser(transformUser(data.user), token);
    }
    // Wait for hydration before making loading decisions
    // If not hydrated yet, keep loading
    // If there's no token after hydration, we're not loading - user is simply not authenticated
    // If there is a token, we're loading until the query finishes
    if (!_hasHydrated) {
      setLoading(true);
    } else if (!token) {
      setLoading(false);
    } else {
      setLoading(isLoadingUser);
    }
  }, [data, token, setUser, setLoading, isLoadingUser, error, clearAuth, _hasHydrated]);

  // Sign in mutation
  const signInMutation = useMutation({
    mutationFn: (data: { email: string; password: string }) =>
      api.signIn(data),
    onSuccess: (response) => {
      // Store token first, then update state
      localStorage.setItem("token", response.token);
      setUser(transformUser(response.user), response.token);
      // Set the query data directly instead of invalidating to avoid race condition
      queryClient.setQueryData(["me"], { user: response.user });
      router.push("/");
    },
  });

  // Sign up mutation
  const signUpMutation = useMutation({
    mutationFn: (data: { username: string; email: string; password: string }) =>
      api.signUp(data),
    onSuccess: (response) => {
      // Store token first, then update state
      localStorage.setItem("token", response.token);
      setUser(transformUser(response.user), response.token);
      // Set the query data directly instead of invalidating to avoid race condition
      queryClient.setQueryData(["me"], { user: response.user });
      router.push("/");
    },
  });

  // Anonymous sign in mutation
  const anonymousSignInMutation = useMutation({
    mutationFn: () => api.signInAnonymous(),
    onSuccess: (response) => {
      // Store token first, then update state
      localStorage.setItem("token", response.token);
      setUser(transformUser(response.user), response.token);
      // Set the query data directly instead of invalidating to avoid race condition
      queryClient.setQueryData(["me"], { user: response.user });
      router.push("/");
    },
  });

  // Wallet sign in mutation
  const walletSignInMutation = useMutation({
    mutationFn: (data: { address: string; signature: string }) =>
      api.signInWithWallet(data),
    onSuccess: (response) => {
      // Store token first, then update state
      localStorage.setItem("token", response.token);
      setUser(transformUser(response.user), response.token);
      // Set the query data directly instead of invalidating to avoid race condition
      queryClient.setQueryData(["me"], { user: response.user });
      router.push("/");
    },
  });

  const handleLogout = () => {
    localStorage.removeItem("token");
    logout();
    queryClient.clear();
    router.push("/");
  };

  // Determine if we're still checking auth status
  // - If not hydrated yet, we're still loading (waiting for localStorage)
  // - If no token after hydration, we're not loading (user is simply not authenticated)
  // - If there's a token, we're loading until the query finishes (use isFetching to catch revalidation)
  const isCheckingAuth = !_hasHydrated || (!!token && (isLoadingUser || isFetching));

  return {
    user,
    token,
    isAuthenticated,
    isAuthVerified, // True only after hydration + successful /me API call
    isLoading: isCheckingAuth,
    hasHydrated: _hasHydrated, // Expose hydration state for debugging
    signIn: signInMutation.mutate,
    signInAsync: signInMutation.mutateAsync,
    signInError: signInMutation.error,
    isSigningIn: signInMutation.isPending,
    signUp: signUpMutation.mutate,
    signUpAsync: signUpMutation.mutateAsync,
    signUpError: signUpMutation.error,
    isSigningUp: signUpMutation.isPending,
    signInAnonymous: anonymousSignInMutation.mutate,
    isSigningInAnonymous: anonymousSignInMutation.isPending,
    signInWithWallet: walletSignInMutation.mutate,
    isSigningInWithWallet: walletSignInMutation.isPending,
    logout: handleLogout,
  };
}
