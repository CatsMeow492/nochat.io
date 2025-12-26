"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Check, X, Loader2, UserPlus, Shield, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useInviteInfo } from "@/hooks/use-contacts";
import { useAuth } from "@/hooks";

export default function InviteAcceptPage() {
  const router = useRouter();
  const params = useParams();
  const code = params?.code as string;
  const { user, isLoading: authLoading } = useAuth();
  const { info, loading, error, acceptInvite } = useInviteInfo(code);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (!user) {
      // Redirect to sign in with return URL
      router.push(`/signin?redirect=/invite/${code}`);
      return;
    }

    try {
      setAccepting(true);
      setAcceptError(null);
      await acceptInvite();
      setAccepted(true);
    } catch (err) {
      setAcceptError(
        err instanceof Error ? err.message : "Failed to accept invite"
      );
    } finally {
      setAccepting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading invite...</p>
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <X className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Invalid Invite</h1>
          <p className="text-muted-foreground mb-6">
            This invite link is invalid or has expired.
          </p>
          <Button asChild>
            <Link href="/">Return Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!info.is_valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <X className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Invite Expired</h1>
          <p className="text-muted-foreground mb-6">
            This invite link has expired or reached its maximum number of uses.
          </p>
          <Button asChild>
            <Link href="/">Return Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8 text-green-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Contact Added!</h1>
          <p className="text-muted-foreground mb-6">
            You are now connected with{" "}
            <span className="font-medium text-foreground">
              {info.user.display_name}
            </span>
          </p>
          <div className="flex flex-col gap-3">
            <Button onClick={() => router.push("/chat" as any)}>
              Start Chatting
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">Return Home</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <h1 className="text-2xl font-bold gradient-text">NoChat</h1>
          </Link>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Shield className="w-4 h-4" />
            End-to-end encrypted
          </div>
        </div>

        {/* Invite Card */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-6">
          <div className="text-center">
            <Avatar className="w-20 h-20 mx-auto mb-4">
              <AvatarFallback className="bg-primary/20 text-primary text-2xl">
                {info.user.display_name?.[0]?.toUpperCase() ||
                  info.user.username?.[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-xl font-semibold">
              {info.user.display_name || info.user.username}
            </h2>
            <p className="text-muted-foreground">@{info.user.username}</p>
          </div>

          <div className="text-center">
            <p className="text-muted-foreground">
              has invited you to connect on NoChat
            </p>
          </div>

          {acceptError && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">
              {acceptError}
            </div>
          )}

          <div className="space-y-3">
            <Button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full gap-2"
              size="lg"
            >
              {accepting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              {user ? "Accept Invite" : "Sign in to Accept"}
            </Button>

            {!user && (
              <p className="text-xs text-muted-foreground text-center">
                Don't have an account?{" "}
                <Link
                  href={`/signup?redirect=/invite/${code}`}
                  className="text-primary hover:underline"
                >
                  Sign up
                </Link>
              </p>
            )}
          </div>

          {/* Invite details */}
          {(info.expires_at || info.remaining_uses !== undefined) && (
            <div className="pt-4 border-t border-border">
              <div className="flex justify-between text-sm">
                {info.expires_at && (
                  <span className="text-muted-foreground">
                    Expires: {new Date(info.expires_at).toLocaleDateString()}
                  </span>
                )}
                {info.remaining_uses !== undefined && (
                  <span className="text-muted-foreground">
                    {info.remaining_uses} uses remaining
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
