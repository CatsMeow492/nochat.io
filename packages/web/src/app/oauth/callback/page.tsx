"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores";
import { api } from "@/lib/api";

function OAuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser } = useAuthStore();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      const token = searchParams.get("token");
      const errorParam = searchParams.get("error");

      if (errorParam) {
        setStatus("error");
        setError(decodeURIComponent(errorParam));
        return;
      }

      if (!token) {
        setStatus("error");
        setError("No authentication token received");
        return;
      }

      try {
        // Store the token
        localStorage.setItem("token", token);

        // Fetch user data to validate the token and get user info
        const response = await api.getMe();

        if (response?.user) {
          // Transform and set user in store
          const user = {
            id: response.user.id,
            username: response.user.username,
            email: response.user.email,
            isAnonymous: response.user.is_anonymous ?? false,
            walletAddress: response.user.wallet_address,
            createdAt: response.user.created_at,
          };
          setUser(user, token);
          setStatus("success");

          // Redirect to home after a brief success message
          setTimeout(() => {
            router.push("/");
          }, 1000);
        } else {
          throw new Error("Invalid user data received");
        }
      } catch (err) {
        console.error("OAuth callback error:", err);
        localStorage.removeItem("token");
        setStatus("error");
        setError("Failed to complete sign in. Please try again.");
      }
    };

    handleCallback();
  }, [searchParams, router, setUser]);

  return (
    <div className="min-h-screen min-h-dvh flex items-center justify-center p-4 w-full max-w-full">
      <Card className="glass border-border w-full max-w-md">
        <CardHeader className="text-center">
          {status === "loading" && (
            <>
              <div className="flex justify-center mb-4">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
              </div>
              <CardTitle className="text-2xl gradient-text">Signing you in...</CardTitle>
              <CardDescription>
                Please wait while we complete your authentication.
              </CardDescription>
            </>
          )}

          {status === "success" && (
            <>
              <div className="flex justify-center mb-4">
                <CheckCircle className="w-12 h-12 text-green-500" />
              </div>
              <CardTitle className="text-2xl gradient-text">Welcome!</CardTitle>
              <CardDescription>
                You&apos;ve been signed in successfully. Redirecting...
              </CardDescription>
            </>
          )}

          {status === "error" && (
            <>
              <div className="flex justify-center mb-4">
                <AlertCircle className="w-12 h-12 text-destructive" />
              </div>
              <CardTitle className="text-2xl text-destructive">Sign In Failed</CardTitle>
              <CardDescription className="text-destructive/80">
                {error || "An error occurred during sign in."}
              </CardDescription>
            </>
          )}
        </CardHeader>

        {status === "error" && (
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={() => router.push("/signin")}
              className="w-full"
            >
              Try Again
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/")}
              className="w-full"
            >
              Go Home
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen min-h-dvh flex items-center justify-center p-4 w-full max-w-full">
      <Card className="glass border-border w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
          </div>
          <CardTitle className="text-2xl gradient-text">Loading...</CardTitle>
          <CardDescription>
            Please wait...
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <OAuthCallbackContent />
    </Suspense>
  );
}
