"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks";
import { useAuthStore } from "@/stores";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// OAuth provider icons
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const { signIn, isSigningIn, signInError, signInAnonymous, isSigningInAnonymous } = useAuth();
  const { setUser } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  // Detect Tauri desktop app after hydration
  // In Tauri v2, __TAURI_INTERNALS__ is always present
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__;
    setIsDesktop(isTauri);
    if (isTauri) {
      console.log("Running in Tauri desktop app");
    }
  }, []);

  // Listen for OAuth callbacks from Tauri deep links
  useEffect(() => {
    if (!isDesktop) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<string>("oauth-callback", async (event) => {
          const url = event.payload;
          console.log("Received OAuth callback:", url);

          // Parse the URL to get token or error
          const urlObj = new URL(url);
          const token = urlObj.searchParams.get("token");
          const error = urlObj.searchParams.get("error");

          if (error) {
            setOauthError(decodeURIComponent(error));
            setOauthLoading(null);
            return;
          }

          if (token) {
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              const response = await invoke<{
                success: boolean;
                user?: any;
                token?: string;
                error?: string;
              }>("handle_oauth_callback", { token });

              console.log("OAuth response:", response);
              if (response.success && response.user) {
                // Update auth store
                // Note: Tauri uses camelCase for JSON serialization
                setUser(
                  {
                    id: response.user.id,
                    username: response.user.username,
                    email: response.user.email,
                    isAnonymous: response.user.isAnonymous ?? false,
                    walletAddress: response.user.walletAddress,
                    createdAt: response.user.createdAt,
                  },
                  response.token!
                );
                localStorage.setItem("token", response.token!);
                console.log("User authenticated, redirecting to /");
                router.push("/");
              } else {
                console.log("OAuth failed:", response.error);
                setOauthError(response.error || "Failed to sign in");
              }
            } catch (err) {
              console.error("OAuth callback error:", err);
              setOauthError("Failed to complete sign in");
            }
          }

          setOauthLoading(null);
        });
      } catch (err) {
        console.error("Failed to set up OAuth listener:", err);
      }
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [isDesktop, router, setUser]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    signIn({ email, password });
  };

  const handleOAuthSignIn = async (provider: "google" | "github" | "apple") => {
    setOauthError(null);

    if (isDesktop) {
      // Use Tauri command for desktop OAuth
      setOauthLoading(provider);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("start_oauth", { provider });
        // The result will come via the deep link callback
      } catch (err) {
        console.error("Failed to start OAuth:", err);
        setOauthError("Failed to start sign in");
        setOauthLoading(null);
      }
    } else {
      // Redirect to backend OAuth endpoint for web
      window.location.href = `${API_URL}/api/auth/oauth/${provider}`;
    }
  };

  return (
    <div className="min-h-screen min-h-dvh flex items-center justify-center p-4 w-full max-w-full">
      <div className="w-full max-w-md space-y-6 mx-auto">
        {/* Back Button */}
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="gap-2 text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>

        <Card className="glass border-border">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl gradient-text">Welcome Back</CardTitle>
            <CardDescription>
              {isDesktop ? "Sign in with your account" : "Sign in to your NoChat account"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Desktop: OAuth-only UI */}
            {isDesktop ? (
              <div className="space-y-4">
                {/* Error Message */}
                {oauthError && (
                  <p className="text-sm text-destructive text-center">
                    {oauthError}
                  </p>
                )}

                {/* OAuth Buttons - Vertical Stack for Desktop */}
                <div className="space-y-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start gap-3 h-12"
                    onClick={() => handleOAuthSignIn("google")}
                    disabled={!!oauthLoading}
                  >
                    {oauthLoading === "google" ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <GoogleIcon className="w-5 h-5" />
                    )}
                    Continue with Google
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start gap-3 h-12"
                    onClick={() => handleOAuthSignIn("github")}
                    disabled={!!oauthLoading}
                  >
                    {oauthLoading === "github" ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <GitHubIcon className="w-5 h-5" />
                    )}
                    Continue with GitHub
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start gap-3 h-12"
                    onClick={() => handleOAuthSignIn("apple")}
                    disabled={!!oauthLoading}
                  >
                    {oauthLoading === "apple" ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <AppleIcon className="w-5 h-5" />
                    )}
                    Continue with Apple
                  </Button>
                </div>

                {/* Divider */}
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                {/* Anonymous Sign In */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => signInAnonymous()}
                  disabled={isSigningInAnonymous}
                >
                  {isSigningInAnonymous ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    "Continue Anonymously"
                  )}
                </Button>

                {/* Sign Up Link */}
                <p className="mt-6 text-center text-sm text-muted-foreground">
                  Don&apos;t have an account?{" "}
                  <Link
                    href="/signup"
                    className="text-primary hover:underline"
                  >
                    Sign up
                  </Link>
                </p>
              </div>
            ) : (
              /* Web: Full form with email/password */
              <>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Email Field */}
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium">
                      Email
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>

                  {/* Password Field */}
                  <div className="space-y-2">
                    <label htmlFor="password" className="text-sm font-medium">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 pr-10"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Error Message */}
                  {(signInError || oauthError) && (
                    <p className="text-sm text-destructive">
                      {oauthError || signInError?.message || "Invalid credentials"}
                    </p>
                  )}

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isSigningIn}
                  >
                    {isSigningIn ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      "Sign In"
                    )}
                  </Button>

                  {/* Divider */}
                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">or continue with</span>
                    </div>
                  </div>

                  {/* OAuth Buttons */}
                  <div className="grid grid-cols-3 gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => handleOAuthSignIn("google")}
                      disabled={!!oauthLoading}
                    >
                      {oauthLoading === "google" ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <GoogleIcon className="w-5 h-5" />
                      )}
                      <span className="sr-only">Sign in with Google</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => handleOAuthSignIn("github")}
                      disabled={!!oauthLoading}
                    >
                      {oauthLoading === "github" ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <GitHubIcon className="w-5 h-5" />
                      )}
                      <span className="sr-only">Sign in with GitHub</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => handleOAuthSignIn("apple")}
                      disabled={!!oauthLoading}
                    >
                      {oauthLoading === "apple" ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <AppleIcon className="w-5 h-5" />
                      )}
                      <span className="sr-only">Sign in with Apple</span>
                    </Button>
                  </div>

                  {/* Divider */}
                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">or</span>
                    </div>
                  </div>

                  {/* Anonymous Sign In */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => signInAnonymous()}
                    disabled={isSigningInAnonymous}
                  >
                    {isSigningInAnonymous ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      "Continue Anonymously"
                    )}
                  </Button>
                </form>

                {/* Sign Up Link */}
                <p className="mt-6 text-center text-sm text-muted-foreground">
                  Don&apos;t have an account?{" "}
                  <Link
                    href="/signup"
                    className="text-primary hover:underline"
                  >
                    Sign up
                  </Link>
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Security Note */}
        <p className="text-xs text-center text-muted-foreground">
          <Lock className="w-3 h-3 inline mr-1" />
          Your data is encrypted end-to-end. We never see your messages.
        </p>
      </div>
    </div>
  );
}
