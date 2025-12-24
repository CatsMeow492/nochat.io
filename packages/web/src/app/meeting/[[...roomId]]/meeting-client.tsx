"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Users,
  Copy,
  Check,
  Link2,
} from "lucide-react";
import { useMeeting } from "@/hooks/use-meeting";
import { useAuth } from "@/hooks";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores";
import { cn } from "@/lib/utils";
import {
  VideoEffectsSelector,
  useVideoEffects,
  type BackgroundEffect,
} from "@/components/video-effects";

// Corner positions for the PiP window
type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

// Remote video tile component
function VideoTile({
  stream,
  muted = false,
  label,
  isLocal = false,
  className,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  isLocal?: boolean;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamIdRef = useRef<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    // Only update if stream actually changed (compare by stream.id)
    if (streamIdRef.current === stream.id) {
      return;
    }
    streamIdRef.current = stream.id;

    console.log(`[VideoTile] Setting srcObject for ${label}, stream id: ${stream.id}, tracks:`, stream.getTracks().map(t => t.kind));
    video.srcObject = stream;

    // Use onloadedmetadata to ensure video is ready before playing
    const handleLoadedMetadata = () => {
      console.log(`[VideoTile] Metadata loaded for ${label}, attempting play`);
      video.play().catch(err => {
        console.warn(`[VideoTile] Play failed for ${label}:`, err);
      });
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    // Also try to play immediately in case metadata is already loaded
    if (video.readyState >= 1) {
      video.play().catch(() => {});
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [stream, label]);

  return (
    <div className={cn("relative bg-secondary/50 rounded-xl overflow-hidden", className)}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={cn(
            "w-full h-full object-cover",
            isLocal && "transform scale-x-[-1]"
          )}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-3xl font-bold text-primary">
              {label[0]?.toUpperCase() || "?"}
            </span>
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/50 text-white text-xs">
        {label}
      </div>
    </div>
  );
}

// Draggable Picture-in-Picture local video component
function LocalVideoPiP({
  stream,
  label,
  isMuted,
  isVideoOff,
}: {
  stream: MediaStream | null;
  label: string;
  isMuted: boolean;
  isVideoOff: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Calculate which corner is closest to the current position
  const snapToCorner = useCallback((clientX: number, clientY: number) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const isLeft = clientX < viewportWidth / 2;
    const isTop = clientY < viewportHeight / 2;

    if (isTop && isLeft) return "top-left";
    if (isTop && !isLeft) return "top-right";
    if (!isTop && isLeft) return "bottom-left";
    return "bottom-right";
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    // Visual feedback could be added here
  }, [isDragging]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    setCorner(snapToCorner(e.clientX, e.clientY));
  }, [isDragging, snapToCorner]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    const touch = e.changedTouches[0];
    setCorner(snapToCorner(touch.clientX, touch.clientY));
  }, [isDragging, snapToCorner]);

  // Click to cycle through corners
  const handleClick = () => {
    const corners: Corner[] = ["bottom-right", "bottom-left", "top-left", "top-right"];
    const currentIndex = corners.indexOf(corner);
    const nextIndex = (currentIndex + 1) % corners.length;
    setCorner(corners[nextIndex]);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("touchend", handleTouchEnd);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        window.removeEventListener("touchend", handleTouchEnd);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchEnd]);

  const cornerStyles: Record<Corner, string> = {
    "top-left": "top-20 left-4",
    "top-right": "top-20 right-4",
    "bottom-left": "bottom-24 left-4",
    "bottom-right": "bottom-24 right-4",
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute z-20 w-40 h-28 sm:w-48 sm:h-32 rounded-xl overflow-hidden shadow-lg border-2 border-primary/30 cursor-move transition-all duration-300 ease-out",
        cornerStyles[corner],
        isDragging && "opacity-75 scale-105"
      )}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onClick={handleClick}
    >
      {stream && !isVideoOff ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover transform scale-x-[-1]"
        />
      ) : (
        <div className="w-full h-full bg-secondary flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-xl font-bold text-primary">
              {label[0]?.toUpperCase() || "?"}
            </span>
          </div>
        </div>
      )}
      {/* Label and status indicators */}
      <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between">
        <span className="px-1.5 py-0.5 rounded bg-black/50 text-white text-xs">
          {label}
        </span>
        <div className="flex gap-1">
          {isMuted && (
            <span className="p-1 rounded bg-red-500/80">
              <MicOff className="w-3 h-3 text-white" />
            </span>
          )}
          {isVideoOff && (
            <span className="p-1 rounded bg-red-500/80">
              <VideoOff className="w-3 h-3 text-white" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MeetingClient() {
  const params = useParams();
  const router = useRouter();
  // Handle optional catch-all route - roomId can be undefined, string, or string[]
  const roomIdParam = params.roomId;
  const roomId = Array.isArray(roomIdParam) ? roomIdParam[0] : roomIdParam;

  const { user, isLoading: isAuthLoading } = useAuth();
  const { setUser } = useAuthStore();
  const [copied, setCopied] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [backgroundEffect, setBackgroundEffect] = useState<BackgroundEffect>("none");

  const {
    localStream,
    remoteStreams,
    state,
    isMuted,
    isVideoOff,
    connect,
    disconnect,
    toggleMute,
    toggleVideo,
  } = useMeeting(roomId || "");

  // Apply video effects to local stream
  const processedLocalStream = useVideoEffects(localStream, backgroundEffect);

  // Generate shareable link
  const meetingLink = typeof window !== "undefined" && roomId
    ? `${window.location.origin}/meeting/${roomId}`
    : "";

  const copyLink = async () => {
    if (!meetingLink) return;
    await navigator.clipboard.writeText(meetingLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoin = async () => {
    if (!roomId) return;
    setIsJoining(true);
    try {
      let userId = user?.id;

      // If user is not authenticated, sign in anonymously first
      if (!userId) {
        const response = await api.signInAnonymous();
        localStorage.setItem("token", response.token);
        userId = response.user.id;
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
      }
      // Pass userId directly to avoid race conditions with store updates
      await connect(userId);
      setHasJoined(true);
    } catch (error) {
      console.error("Failed to join meeting:", error);
    } finally {
      setIsJoining(false);
    }
  };

  const handleLeave = () => {
    disconnect();
    router.push("/");
  };

  // Show loading while checking auth
  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // No room ID - redirect to home or show error
  if (!roomId) {
    return (
      <TooltipProvider>
        <main className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-md text-center space-y-6">
            <h1 className="text-2xl font-bold">No Meeting ID</h1>
            <p className="text-muted-foreground">
              Please use a valid meeting link or create a new meeting from the home page.
            </p>
            <Button onClick={() => router.push("/")}>
              Go to Home
            </Button>
          </div>
        </main>
      </TooltipProvider>
    );
  }

  // Pre-join lobby
  if (!hasJoined) {
    return (
      <TooltipProvider>
        <main className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-2xl space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold">
                <span className="gradient-text">NoChat</span> Meeting
              </h1>
              <p className="text-muted-foreground">
                Secure peer-to-peer video conferencing
              </p>
            </div>

            {/* Meeting Code Display */}
            <Card className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Link2 className="w-4 h-4" />
                <span>Meeting Code</span>
              </div>
              <div className="flex gap-2">
                <Input
                  value={roomId}
                  readOnly
                  className="font-mono text-lg bg-secondary/50"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={copyLink}
                      className="shrink-0"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {copied ? "Copied!" : "Copy meeting link"}
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this code or link with others to invite them to the meeting.
              </p>
            </Card>

            {/* Join Button */}
            <div className="flex flex-col gap-3">
              <Button
                size="lg"
                onClick={handleJoin}
                disabled={isJoining}
                className="w-full py-6 text-lg gap-2"
              >
                <Video className="w-5 h-5" />
                {isJoining ? "Joining..." : "Join Meeting"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push("/")}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
            </div>

            {/* Info */}
            <p className="text-center text-xs text-muted-foreground">
              Your camera and microphone will be requested when you join.
              <br />
              All communication is end-to-end encrypted.
            </p>
          </div>
        </main>
      </TooltipProvider>
    );
  }

  // In-meeting view
  return (
    <TooltipProvider>
      <main className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold gradient-text">NoChat</h1>
            <span className="text-sm text-muted-foreground font-mono">
              {roomId.slice(0, 8)}...
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="w-4 h-4" />
              <span>{state.userCount}</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={copyLink}>
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy meeting link</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* Main Video Area */}
        <div className="flex-1 relative overflow-hidden">
          {state.error ? (
            <div className="h-full flex items-center justify-center p-4">
              <Card className="p-6 max-w-md text-center space-y-4">
                <p className="text-destructive">{state.error}</p>
                <Button variant="outline" onClick={() => router.push("/")}>
                  Go Back
                </Button>
              </Card>
            </div>
          ) : remoteStreams.size === 0 ? (
            /* No remote participants - show waiting state with local video centered */
            <div className="h-full flex items-center justify-center p-4">
              <div className="text-center space-y-6">
                <div className="w-64 h-48 sm:w-80 sm:h-60 mx-auto">
                  <VideoTile
                    stream={processedLocalStream}
                    muted
                    label={user?.username || "You"}
                    isLocal
                    className="w-full h-full"
                  />
                </div>
                <p className="text-muted-foreground text-sm">
                  Your video preview. Waiting for others to join...
                </p>
              </div>
            </div>
          ) : (
            /* Remote participants - show them in main area with local PiP */
            <>
              {/* Remote video grid - takes full space */}
              <div className="h-full p-4">
                <div className={cn(
                  "h-full grid gap-4",
                  remoteStreams.size === 1 && "place-items-center",
                  remoteStreams.size === 2 && "grid-cols-2",
                  remoteStreams.size >= 3 && "grid-cols-2 lg:grid-cols-3"
                )}>
                  {Array.from(remoteStreams.entries()).map(([peerId, stream]) => (
                    <VideoTile
                      key={peerId}
                      stream={stream}
                      label={`Peer ${peerId.slice(0, 8)}`}
                      className={cn(
                        "w-full",
                        remoteStreams.size === 1 ? "max-w-4xl h-full max-h-[70vh]" : "aspect-video"
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Local video PiP - draggable to corners */}
              <LocalVideoPiP
                stream={processedLocalStream}
                label={user?.username || "You"}
                isMuted={isMuted}
                isVideoOff={isVideoOff}
              />
            </>
          )}
        </div>

        {/* Controls */}
        <footer className="flex items-center justify-center gap-4 px-4 py-4 border-t border-border bg-card/50">
          {/* Mute */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isMuted ? "destructive" : "secondary"}
                size="icon"
                className="w-12 h-12 rounded-full"
                onClick={toggleMute}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isMuted ? "Unmute" : "Mute"}</TooltipContent>
          </Tooltip>

          {/* Video */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isVideoOff ? "destructive" : "secondary"}
                size="icon"
                className="w-12 h-12 rounded-full"
                onClick={toggleVideo}
              >
                {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isVideoOff ? "Turn on camera" : "Turn off camera"}</TooltipContent>
          </Tooltip>

          {/* Effects */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <VideoEffectsSelector
                  currentEffect={backgroundEffect}
                  onEffectChange={setBackgroundEffect}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>Video effects</TooltipContent>
          </Tooltip>

          {/* Leave */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                size="icon"
                className="w-12 h-12 rounded-full"
                onClick={handleLeave}
              >
                <PhoneOff className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Leave meeting</TooltipContent>
          </Tooltip>
        </footer>

        {/* Connection status */}
        {!state.isConnected && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-muted-foreground">Connecting...</p>
            </div>
          </div>
        )}

        {/* Waiting for others */}
        {state.isConnected && state.userCount === 1 && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10">
            <Card className="px-4 py-3 flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
              <span className="text-sm">Waiting for others to join...</span>
              <Button variant="ghost" size="sm" onClick={copyLink} className="gap-1">
                <Copy className="w-3 h-3" />
                Share
              </Button>
            </Card>
          </div>
        )}
      </main>
    </TooltipProvider>
  );
}
