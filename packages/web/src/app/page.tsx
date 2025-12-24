"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Debug logging for Tauri
async function debugLog(message: string) {
  if (typeof window !== 'undefined' && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("debug_log", { message: `[LandingPage] ${message}` });
    } catch {
      // Ignore
    }
  }
}
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth, useDownload } from "@/hooks";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores";
import {
  Lock,
  Shield,
  Video,
  MessageSquare,
  Users,
  UserX,
  EyeOff,
  Smartphone,
  Globe,
  CheckCircle2,
  Download,
  Monitor,
  Apple,
} from "lucide-react";
import { DownloadButtons } from "@/components/download-buttons";

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
  const { isAuthVerified, isLoading, hasHydrated, token } = useAuth();
  const { setUser } = useAuthStore();
  const [isStartingMeeting, setIsStartingMeeting] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [meetingCode, setMeetingCode] = useState("");
  const meetingRedirectRef = useRef(false);

  // Debug logging
  useEffect(() => {
    debugLog(`Auth state - hasHydrated: ${hasHydrated}, token: ${!!token}, isLoading: ${isLoading}, isAuthVerified: ${isAuthVerified}`);
  }, [hasHydrated, token, isLoading, isAuthVerified]);

  useEffect(() => {
    // Only redirect if auth has been verified via API call in this session
    // This prevents redirect when there's a stale token in localStorage
    // Skip redirect if we're in the process of starting/joining a meeting
    // Authenticated users should be redirected to the chat interface
    if (isAuthVerified && !meetingRedirectRef.current) {
      debugLog("isAuthVerified is true, redirecting to chat...");
      // Use client-side navigation to avoid full page reload
      // This preserves React state and avoids hydration issues
      // Cast needed due to catch-all route typing
      router.push("/chat" as any);
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
      icon: Lock,
      title: "End-to-End Encrypted",
      description:
        "Messages are only readable by you and your recipient. We cannot access your conversations.",
    },
    {
      icon: UserX,
      title: "No Phone Number",
      description:
        "Use NoChat anonymously. No personal information required to get started.",
    },
    {
      icon: Video,
      title: "Video & Audio Calls",
      description:
        "Crystal-clear, fully encrypted peer-to-peer calls. No data passes through our servers.",
    },
    {
      icon: EyeOff,
      title: "Zero Knowledge",
      description:
        "We cannot read your messages, even if we wanted to. Your keys never leave your device.",
    },
  ];

  const trustIndicators = [
    { icon: Shield, text: "E2EE by default" },
    { icon: Globe, text: "Open source" },
    { icon: Lock, text: "Zero-trust architecture" },
  ];

  // Get download info for direct downloads
  const { platform, getDownloadUrl, getPlatformName, loading: downloadLoading } = useDownload();
  const PlatformIcon = platform === "macos" ? Apple : platform === "windows" ? Monitor : Download;
  const downloadUrl = getDownloadUrl();
  const platformName = getPlatformName();

  return (
    <main className="min-h-screen min-h-dvh flex flex-col w-full max-w-full overflow-x-hidden">
      {/* Header / Navigation */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold gradient-text">NoChat</span>
          </div>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
              Features
            </a>
            <a href="#security" className="text-muted-foreground hover:text-foreground transition-colors">
              Security
            </a>
            <a href="#download" className="text-muted-foreground hover:text-foreground transition-colors">
              Download
            </a>
            <Link href="/signin" className="text-muted-foreground hover:text-foreground transition-colors">
              Sign In
            </Link>
          </nav>

          {/* Download Button */}
          <div className="flex items-center gap-3">
            <Button
              variant="default"
              size="sm"
              className="gap-2 hidden sm:flex"
              disabled={downloadLoading}
              asChild
            >
              <a href={downloadUrl} download>
                <PlatformIcon className="w-4 h-4" />
                {downloadLoading ? "Loading..." : `Download for ${platformName}`}
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="sm:hidden"
              asChild
            >
              <a href={downloadUrl} download>
                <Download className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-16 sm:py-24">
        <div className="w-full max-w-4xl mx-auto text-center space-y-8 sm:space-y-10">
          {/* Logo/Brand */}
          <div className="space-y-6">
            <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight">
              <span className="gradient-text">Private conversations.</span>
              <br />
              <span className="text-foreground">Finally.</span>
            </h1>
            <p className="text-lg sm:text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto px-2">
              Encrypted messaging and video calls that{" "}
              <span className="text-foreground font-medium">no one can intercept</span>.
              Not hackers. Not governments.{" "}
              <span className="text-foreground font-medium">Not even us.</span>
            </p>
          </div>

          {/* Trust Indicators */}
          <div className="flex flex-wrap justify-center gap-4 sm:gap-6 pt-2">
            {trustIndicators.map((item) => (
              <div
                key={item.text}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <item.icon className="w-4 h-4 text-primary" />
                <span>{item.text}</span>
              </div>
            ))}
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col gap-4 justify-center pt-4 px-2 max-w-md mx-auto">
            {/* Start Meeting - Primary Action */}
            <Button
              size="lg"
              onClick={handleStartMeeting}
              disabled={isStartingMeeting || isLoading}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 sm:px-8 py-6 text-lg w-full"
            >
              <Video className="w-5 h-5" />
              {isStartingMeeting ? "Starting..." : "Start Secure Meeting"}
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
              <MessageSquare className="w-4 h-4" />
              Sign in for secure messaging
            </Button>
          </div>

          {/* Trust Badge */}
          <p className="text-sm text-muted-foreground pt-2">
            No account required. No data collected. No compromises.
          </p>

          {/* Download CTA in Hero */}
          <div className="pt-4">
            <a
              href={downloadUrl}
              download
              className="inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-colors text-sm font-medium group"
            >
              <Download className="w-4 h-4" />
              <span>Download for {platformName} for the best experience</span>
              <span className="group-hover:translate-x-1 transition-transform">→</span>
            </a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-16 sm:py-24 px-4 border-t border-border bg-card/30 scroll-mt-16">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">
              Privacy is a right, not a feature
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto px-2">
              NoChat is built from the ground up with security and privacy at its core.
              No tracking. No ads. No compromises.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="glass rounded-xl p-6 space-y-4 hover:border-primary/30 transition-colors"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works / Security Section */}
      <section id="security" className="py-16 sm:py-24 px-4 border-t border-border scroll-mt-16">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">
              Zero-knowledge architecture
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto px-2">
              Your messages are encrypted on your device before they ever leave.
              Even our servers only see encrypted data they cannot read.
            </p>
          </div>

          <div className="space-y-6">
            <div className="glass rounded-xl p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-primary" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">End-to-end encryption</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    All messages and calls use state-of-the-art encryption. Your private keys
                    are generated and stored only on your device, never on our servers.
                  </p>
                </div>
              </div>
            </div>

            <div className="glass rounded-xl p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-primary" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">No personal data required</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Unlike other messaging apps, NoChat does not require your phone number,
                    email, or any personal information. Create an account anonymously and
                    start chatting.
                  </p>
                </div>
              </div>
            </div>

            <div className="glass rounded-xl p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-primary" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Open source & auditable</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Our code is open source on GitHub. Security researchers and anyone
                    can verify our claims. Transparency builds trust.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* App Download / CTA Section */}
      <section id="download" className="py-16 sm:py-24 px-4 border-t border-border bg-card/30 scroll-mt-16">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">
            Get NoChat
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-xl mx-auto mb-8 px-2">
            Available on macOS, Windows, and Linux. Take your private conversations
            with you everywhere.
          </p>

          {/* Desktop Downloads */}
          <div className="mb-8">
            <DownloadButtons />
          </div>

          {/* Mobile App Store Badges - Placeholders */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
            {/* iOS App Store Badge Placeholder */}
            <a
              href="#"
              className="inline-flex items-center gap-3 glass rounded-xl px-6 py-4 hover:border-primary/30 transition-colors group opacity-60"
              aria-label="Download on the App Store (Coming Soon)"
            >
              <Smartphone className="w-8 h-8 text-muted-foreground group-hover:text-foreground transition-colors" />
              <div className="text-left">
                <p className="text-xs text-muted-foreground">Coming soon on</p>
                <p className="text-base font-semibold">App Store</p>
              </div>
            </a>

            {/* Google Play Badge Placeholder */}
            <a
              href="#"
              className="inline-flex items-center gap-3 glass rounded-xl px-6 py-4 hover:border-primary/30 transition-colors group opacity-60"
              aria-label="Get it on Google Play (Coming Soon)"
            >
              <Smartphone className="w-8 h-8 text-muted-foreground group-hover:text-foreground transition-colors" />
              <div className="text-left">
                <p className="text-xs text-muted-foreground">Coming soon on</p>
                <p className="text-base font-semibold">Google Play</p>
              </div>
            </a>
          </div>

          {/* Web App CTA */}
          <Button
            size="lg"
            onClick={() => router.push("/signin")}
            variant="outline"
            className="gap-2 px-8 py-6 text-lg"
          >
            <Globe className="w-5 h-5" />
            Use NoChat on Web
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 sm:py-12 px-4 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            {/* Brand & Copyright */}
            <div className="text-center sm:text-left">
              <p className="text-lg font-semibold gradient-text mb-1">NoChat</p>
              <p className="text-xs text-muted-foreground">
                &copy; {new Date().getFullYear()} NoChat. Privacy is a right, not a feature.
              </p>
            </div>

            {/* Footer Links */}
            <nav className="flex flex-wrap justify-center gap-4 sm:gap-6 text-sm text-muted-foreground">
              <Link
                href="/privacy"
                className="hover:text-foreground transition-colors"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="hover:text-foreground transition-colors"
              >
                Terms of Service
              </Link>
              <Link
                href="/security"
                className="hover:text-foreground transition-colors"
              >
                Security
              </Link>
              <a
                href="https://github.com/CatsMeow492/nochat.io"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                GitHub
              </a>
            </nav>
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
