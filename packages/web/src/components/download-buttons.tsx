"use client";

import { Button } from "@/components/ui/button";
import { Apple, Monitor, Download } from "lucide-react";
import { useDownload } from "@/hooks";

export function DownloadButtons() {
  const { downloadInfo, loading, error, platform, releasesUrl } = useDownload();

  if (loading) {
    return (
      <div className="flex flex-col gap-4 justify-center items-center">
        <div className="animate-pulse flex gap-4">
          <div className="w-48 h-14 bg-muted rounded-xl" />
          <div className="w-48 h-14 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !downloadInfo) {
    // Fallback: direct link to GitHub releases
    return (
      <div className="flex flex-col items-center gap-4">
        <Button size="lg" asChild className="gap-3 px-8 py-6 text-lg">
          <a href={releasesUrl} target="_blank" rel="noopener noreferrer">
            <Download className="w-5 h-5" />
            Download Desktop App
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          Available for macOS, Windows, and Linux
        </p>
      </div>
    );
  }

  // Get the primary download based on user's platform
  const primaryDownload =
    platform === "macos"
      ? downloadInfo.macos
      : platform === "windows"
        ? downloadInfo.windows
        : platform === "linux"
          ? downloadInfo.linux
          : downloadInfo.macos; // Default to macOS

  const primaryPlatformName =
    platform === "macos"
      ? "macOS"
      : platform === "windows"
        ? "Windows"
        : platform === "linux"
          ? "Linux"
          : "macOS";

  const PrimaryIcon =
    platform === "macos" ? Apple : platform === "windows" ? Monitor : Download;

  return (
    <div className="space-y-6">
      {/* Primary Download Button */}
      {primaryDownload && (
        <div className="flex flex-col items-center gap-2">
          <Button
            size="lg"
            asChild
            className="gap-3 bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg"
          >
            <a href={primaryDownload.url} download>
              <PrimaryIcon className="w-5 h-5" />
              Download for {primaryPlatformName}
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">
            v{downloadInfo.version} &middot; {primaryDownload.size}
          </p>
        </div>
      )}

      {/* Other Platform Downloads */}
      <div className="flex flex-wrap justify-center gap-4">
        {downloadInfo.macos && platform !== "macos" && (
          <a
            href={downloadInfo.macos.url}
            download
            className="inline-flex items-center gap-3 glass rounded-xl px-5 py-3 hover:border-primary/30 transition-colors group text-sm"
          >
            <Apple className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            <div className="text-left">
              <p className="font-medium">macOS</p>
              <p className="text-xs text-muted-foreground">
                {downloadInfo.macos.size}
              </p>
            </div>
          </a>
        )}

        {downloadInfo.windows && platform !== "windows" && (
          <a
            href={downloadInfo.windows.url}
            download
            className="inline-flex items-center gap-3 glass rounded-xl px-5 py-3 hover:border-primary/30 transition-colors group text-sm"
          >
            <Monitor className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            <div className="text-left">
              <p className="font-medium">Windows</p>
              <p className="text-xs text-muted-foreground">
                {downloadInfo.windows.size}
              </p>
            </div>
          </a>
        )}

        {downloadInfo.linux && platform !== "linux" && (
          <a
            href={downloadInfo.linux.url}
            download
            className="inline-flex items-center gap-3 glass rounded-xl px-5 py-3 hover:border-primary/30 transition-colors group text-sm"
          >
            <Download className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            <div className="text-left">
              <p className="font-medium">Linux</p>
              <p className="text-xs text-muted-foreground">
                {downloadInfo.linux.size}
              </p>
            </div>
          </a>
        )}
      </div>
    </div>
  );
}
