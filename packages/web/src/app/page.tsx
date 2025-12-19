"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores";
import {
  Lock,
  Shield,
  Video,
  MessageSquare,
  Zap,
  ChevronRight,
  Users,
} from "lucide-react";

// Generate a simple meeting code (8 chars)
function generateMeetingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default function LandingPage() {
  const router = useRouter();
  const { isAuthVerified, isLoading } = useAuth();
  const { setUser } = useAuthStore();
  const [isStartingMeeting, setIsStartingMeeting] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [meetingCode, setMeetingCode] = useState("");
  const meetingRedirectRef = useRef(false);

  useEffect(() => {
    // Only redirect if auth has been verified via API call in this session
    // This prevents redirect when there's a stale token in localStorage
    // Skip redirect if we're in the process of starting/joining a meeting
    if (isAuthVerified && !meetingRedirectRef.current) {
      router.push("/chat");
    }
  }, [isAuthVerified, router]);

  // Start a new meeting as anonymous user
  const handleStartMeeting = async () => {
    setIsStartingMeeting(true);
    meetingRedirectRef.current = true; // Prevent redirect to /chat
    try {
      // Create anonymous user
      const response = await api.signInAnonymous();
      localStorage.setItem("token", response.token);
      setUser(
        {
          id: response.user.id,
          username: response.user.username,
          email: response.user.email,
          isAnonymous: response.user.is_anonymous ?? true,
          walletAddress: response.user.wallet_address,
          createdAt: response.user.created_at,
        },
        response.token
      );

      // Generate room ID and redirect
      const roomId = generateMeetingCode();
      router.push(`/meeting/${roomId}`);
    } catch (error) {
      console.error("Failed to start meeting:", error);
      meetingRedirectRef.current = false;
      setIsStartingMeeting(false);
    }
  };

  // Join an existing meeting
  const handleJoinMeeting = async () => {
    if (!meetingCode.trim()) return;

    meetingRedirectRef.current = true; // Prevent redirect to /chat
    try {
      // Create anonymous user for joining
      const response = await api.signInAnonymous();
      localStorage.setItem("token", response.token);
      setUser(
        {
          id: response.user.id,
          username: response.user.username,
          email: response.user.email,
          isAnonymous: response.user.is_anonymous ?? true,
          walletAddress: response.user.wallet_address,
          createdAt: response.user.created_at,
        },
        response.token
      );

      // Navigate to the meeting
      router.push(`/meeting/${meetingCode.trim().toUpperCase()}`);
    } catch (error) {
      console.error("Failed to join meeting:", error);
      meetingRedirectRef.current = false;
    }
  };

  const features = [
    {
      icon: Shield,
      title: "Post-Quantum Security",
      description:
        "Protected against future quantum computing threats with ML-KEM and ML-DSA algorithms.",
    },
    {
      icon: Lock,
      title: "Zero-Trust E2EE",
      description:
        "End-to-end encryption where the server never sees your content. Your keys, your data.",
    },
    {
      icon: Video,
      title: "P2P Video Calls",
      description:
        "Direct peer-to-peer video conferencing with no data passing through central servers.",
    },
    {
      icon: MessageSquare,
      title: "Secure Messaging",
      description:
        "Double Ratchet protocol ensures forward secrecy and break-in recovery for all messages.",
    },
  ];

  return (
    <main className="min-h-screen min-h-dvh flex flex-col w-full max-w-full overflow-x-hidden">
      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-12 sm:py-20">
        <div className="w-full max-w-4xl mx-auto text-center space-y-6 sm:space-y-8">
          {/* Logo/Brand */}
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight">
              <span className="gradient-text">NoChat</span>
            </h1>
            <p className="text-lg sm:text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto px-2">
              Secure peer-to-peer communication that no one can intercept.
              <span className="text-foreground font-medium">
                {" "}
                Not even us.
              </span>
            </p>
          </div>

          {/* CTA Buttons - Video Meeting Focus */}
          <div className="flex flex-col gap-4 justify-center pt-4 px-2 max-w-md mx-auto">
            {/* Start Meeting - Primary Action */}
            <Button
              size="lg"
              onClick={handleStartMeeting}
              disabled={isStartingMeeting || isLoading}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 sm:px-8 py-6 text-lg w-full"
            >
              <Video className="w-5 h-5" />
              {isStartingMeeting ? "Starting..." : "Start Meeting"}
            </Button>

            {/* Join Meeting */}
            <Button
              size="lg"
              variant="outline"
              onClick={() => setJoinDialogOpen(true)}
              className="gap-2 px-6 sm:px-8 py-6 text-lg border-border hover:bg-secondary w-full"
            >
              <Users className="w-5 h-5" />
              Join Meeting
            </Button>

            {/* Divider */}
            <div className="flex items-center gap-4 my-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Sign In for registered users */}
            <Button
              size="lg"
              variant="ghost"
              onClick={() => router.push("/signin")}
              className="gap-2 text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="w-4 h-4" />
              Sign in for secure messaging
            </Button>
          </div>

          {/* Trust Badge */}
          <p className="text-sm text-muted-foreground pt-4">
            No account required. No data collected. No compromises.
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-12 sm:py-20 px-4 border-t border-border bg-card/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">
              Security by Design
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto px-2">
              Built from the ground up with quantum-resistant cryptography and
              zero-trust architecture.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="glass rounded-xl p-6 space-y-4 hover:border-primary/30 transition-colors"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 sm:py-8 px-4 border-t border-border">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
            &copy; {new Date().getFullYear()} NoChat. Privacy is a right, not a
            feature.
          </p>
          <div className="flex gap-4 sm:gap-6 text-xs sm:text-sm text-muted-foreground">
            <a
              href="https://github.com/CatsMeow492/nochat.io"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>

      {/* Join Meeting Dialog */}
      <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join a Meeting</DialogTitle>
            <DialogDescription>
              Enter the meeting code shared with you to join an existing meeting.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Enter meeting code (e.g., ABC12345)"
              value={meetingCode}
              onChange={(e) => setMeetingCode(e.target.value.toUpperCase())}
              className="font-mono text-lg text-center tracking-wider"
              maxLength={12}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleJoinMeeting();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setJoinDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleJoinMeeting}
              disabled={!meetingCode.trim()}
              className="gap-2"
            >
              <Video className="w-4 h-4" />
              Join
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
