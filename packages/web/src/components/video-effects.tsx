"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Sparkles, Image, Ban, Palette } from "lucide-react";

export type BackgroundEffect =
  | "none"
  | "blur-light"
  | "blur-heavy"
  | "gradient-purple"
  | "gradient-blue"
  | "gradient-sunset"
  | "custom";

interface VideoEffectsProps {
  currentEffect: BackgroundEffect;
  onEffectChange: (effect: BackgroundEffect) => void;
  customBackground?: string;
  onCustomBackgroundChange?: (url: string) => void;
}

const effects: { id: BackgroundEffect; label: string; icon: React.ReactNode; preview: string }[] = [
  { id: "none", label: "None", icon: <Ban className="w-4 h-4" />, preview: "bg-secondary" },
  { id: "blur-light", label: "Light Blur", icon: <Sparkles className="w-4 h-4" />, preview: "bg-secondary/50 backdrop-blur-sm" },
  { id: "blur-heavy", label: "Heavy Blur", icon: <Sparkles className="w-4 h-4" />, preview: "bg-secondary/30 backdrop-blur-xl" },
  { id: "gradient-purple", label: "Purple", icon: <Palette className="w-4 h-4" />, preview: "bg-gradient-to-br from-purple-900 via-violet-800 to-purple-900" },
  { id: "gradient-blue", label: "Blue", icon: <Palette className="w-4 h-4" />, preview: "bg-gradient-to-br from-blue-900 via-cyan-800 to-blue-900" },
  { id: "gradient-sunset", label: "Sunset", icon: <Palette className="w-4 h-4" />, preview: "bg-gradient-to-br from-orange-600 via-pink-600 to-purple-700" },
];

export function VideoEffectsSelector({
  currentEffect,
  onEffectChange,
}: VideoEffectsProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="w-12 h-12 rounded-full"
        >
          <Sparkles className="w-5 h-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" side="top" align="center">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h4 className="font-medium">Video Effects</h4>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {effects.map((effect) => (
              <button
                key={effect.id}
                onClick={() => onEffectChange(effect.id)}
                className={cn(
                  "relative flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all",
                  currentEffect === effect.id
                    ? "border-primary bg-primary/10"
                    : "border-transparent hover:bg-secondary/50"
                )}
              >
                <div className={cn(
                  "w-12 h-8 rounded-md overflow-hidden",
                  effect.preview
                )}>
                  {effect.id.startsWith("blur") && (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-4 h-4 rounded-full bg-primary/50" />
                    </div>
                  )}
                </div>
                <span className="text-xs text-center">{effect.label}</span>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Hook to apply video effects using canvas
export function useVideoEffects(
  videoStream: MediaStream | null,
  effect: BackgroundEffect
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null);

  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.paused || video.ended) {
      animationRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      animationRef.current = requestAnimationFrame(processFrame);
      return;
    }

    // Set canvas size to match video
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
    }

    // Draw the video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Apply effects based on selection
    if (effect === "blur-light" || effect === "blur-heavy") {
      // Apply blur filter
      const blurAmount = effect === "blur-light" ? 5 : 15;
      ctx.filter = `blur(${blurAmount}px)`;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.filter = "none";

      // Draw a "person" silhouette area without blur (simplified - real implementation would use ML)
      // For now, we'll just draw the center portion without blur as a placeholder
      const centerX = canvas.width * 0.2;
      const centerY = canvas.height * 0.1;
      const personWidth = canvas.width * 0.6;
      const personHeight = canvas.height * 0.9;

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(
        canvas.width / 2,
        canvas.height * 0.4,
        personWidth / 2,
        personHeight / 2,
        0,
        0,
        Math.PI * 2
      );
      ctx.clip();
      ctx.filter = "none";
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else if (effect.startsWith("gradient-")) {
      // Create gradient background
      let gradient: CanvasGradient;

      if (effect === "gradient-purple") {
        gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, "#581c87");
        gradient.addColorStop(0.5, "#6d28d9");
        gradient.addColorStop(1, "#581c87");
      } else if (effect === "gradient-blue") {
        gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, "#1e3a8a");
        gradient.addColorStop(0.5, "#0891b2");
        gradient.addColorStop(1, "#1e3a8a");
      } else {
        gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, "#ea580c");
        gradient.addColorStop(0.5, "#db2777");
        gradient.addColorStop(1, "#7c3aed");
      }

      // Fill background with gradient
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw person on top (simplified - draws center ellipse)
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(
        canvas.width / 2,
        canvas.height * 0.5,
        canvas.width * 0.3,
        canvas.height * 0.45,
        0,
        0,
        Math.PI * 2
      );
      ctx.clip();
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    animationRef.current = requestAnimationFrame(processFrame);
  }, [effect]);

  useEffect(() => {
    if (!videoStream || effect === "none") {
      setProcessedStream(videoStream);
      return;
    }

    // Create hidden video element
    const video = document.createElement("video");
    video.srcObject = videoStream;
    video.muted = true;
    video.playsInline = true;
    videoRef.current = video;

    // Create canvas for processing
    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;

    video.play().then(() => {
      // Start the animation loop
      animationRef.current = requestAnimationFrame(processFrame);

      // Capture the canvas as a stream
      const stream = canvas.captureStream(30);

      // Add audio tracks from original stream
      const audioTracks = videoStream.getAudioTracks();
      audioTracks.forEach(track => stream.addTrack(track));

      setProcessedStream(stream);
    });

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      video.pause();
      video.srcObject = null;
    };
  }, [videoStream, effect, processFrame]);

  // If no effect, return original stream
  if (effect === "none") {
    return videoStream;
  }

  return processedStream;
}

// Component that wraps video with effects applied
export function EffectedVideo({
  stream,
  effect,
  muted = false,
  isLocal = false,
  className,
}: {
  stream: MediaStream | null;
  effect: BackgroundEffect;
  muted?: boolean;
  isLocal?: boolean;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const processedStream = useVideoEffects(stream, effect);

  useEffect(() => {
    if (videoRef.current && processedStream) {
      videoRef.current.srcObject = processedStream;
    }
  }, [processedStream]);

  if (!stream) {
    return (
      <div className={cn("bg-secondary flex items-center justify-center", className)}>
        <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
          <span className="text-3xl font-bold text-primary">?</span>
        </div>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className={cn(
        "w-full h-full object-cover",
        isLocal && "transform scale-x-[-1]",
        className
      )}
    />
  );
}
