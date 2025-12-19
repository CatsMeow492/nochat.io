"use client";

import { useEffect, useRef, useState } from "react";
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
  Play,
  Link2,
} from "lucide-react";
import { useMeeting } from "@/hooks/use-meeting";
import { useAuth } from "@/hooks";
import { cn } from "@/lib/utils";

function VideoTile({
  stream,
  muted = false,
  label,
  isLocal = false,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  isLocal?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative aspect-video bg-secondary/50 rounded-xl overflow-hidden">
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
      <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-black/50 text-white text-sm">
        {label}
      </div>
    </div>
  );
}

export default function MeetingPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const { user, isLoading: isAuthLoading } = useAuth();
  const [copied, setCopied] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);

  const {
    localStream,
    remoteStreams,
    state,
    isMuted,
    isVideoOff,
    connect,
    disconnect,
    startMeeting,
    toggleMute,
    toggleVideo,
  } = useMeeting(roomId);

  // Generate shareable link
  const meetingLink = typeof window !== "undefined"
    ? `${window.location.origin}/meeting/${roomId}`
    : "";

  const copyLink = async () => {
    await navigator.clipboard.writeText(meetingLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoin = async () => {
    await connect();
    setHasJoined(true);
  };

  const handleLeave = () => {
    disconnect();
    router.push("/");
  };

  const handleStartMeeting = () => {
    startMeeting();
  };

  // Show loading while checking auth
  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
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
                className="w-full py-6 text-lg gap-2"
              >
                <Video className="w-5 h-5" />
                Join Meeting
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

        {/* Video Grid */}
        <div className="flex-1 p-4 overflow-auto">
          {state.error ? (
            <div className="h-full flex items-center justify-center">
              <Card className="p-6 max-w-md text-center space-y-4">
                <p className="text-destructive">{state.error}</p>
                <Button variant="outline" onClick={() => router.push("/")}>
                  Go Back
                </Button>
              </Card>
            </div>
          ) : (
            <div className="grid gap-4 h-full" style={{
              gridTemplateColumns: remoteStreams.size === 0
                ? "1fr"
                : remoteStreams.size === 1
                  ? "repeat(2, 1fr)"
                  : "repeat(auto-fit, minmax(300px, 1fr))",
            }}>
              {/* Local video */}
              <VideoTile
                stream={localStream}
                muted
                label={user?.username || "You"}
                isLocal
              />

              {/* Remote videos */}
              {Array.from(remoteStreams.entries()).map(([peerId, stream]) => (
                <VideoTile
                  key={peerId}
                  stream={stream}
                  label={`Peer ${peerId.slice(0, 8)}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Controls */}
        <footer className="flex items-center justify-center gap-4 px-4 py-4 border-t border-border bg-card/50">
          {/* Start Meeting (for initiator when waiting) */}
          {state.isInitiator && state.userCount > 1 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="default"
                  size="lg"
                  onClick={handleStartMeeting}
                  className="gap-2"
                >
                  <Play className="w-5 h-5" />
                  Start Call
                </Button>
              </TooltipTrigger>
              <TooltipContent>Start the video call with all participants</TooltipContent>
            </Tooltip>
          )}

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
