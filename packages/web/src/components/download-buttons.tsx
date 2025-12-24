"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Apple, Monitor, Download } from "lucide-react";

// GitHub repository info
const GITHUB_OWNER = "CatsMeow492";
const GITHUB_REPO = "nochat.io";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface Release {
  tag_name: string;
  name: string;
  assets: ReleaseAsset[];
}

interface DownloadInfo {
  version: string;
  macos?: { url: string; size: string };
  windows?: { url: string; size: string };
  linux?: { url: string; size: string };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function DownloadButtons() {
  const [downloadInfo, setDownloadInfo] = useState<DownloadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchLatestRelease() {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=10`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch releases");
        }

        const releases: Release[] = await response.json();

        // Find the latest desktop release (tag starts with desktop-v)
        const desktopRelease = releases.find((r) =>
          r.tag_name.startsWith("desktop-v")
        );

        if (!desktopRelease) {
          setError(true);
          setLoading(false);
          return;
        }

        const version = desktopRelease.tag_name.replace("desktop-v", "");

        // Find assets for each platform
        const macosAsset = desktopRelease.assets.find(
          (a) => a.name.includes("universal") && a.name.endsWith(".dmg")
        );
        const windowsAsset = desktopRelease.assets.find(
          (a) => a.name.includes("x64-setup") && a.name.endsWith(".exe")
        );
        const linuxAsset = desktopRelease.assets.find((a) =>
          a.name.endsWith(".AppImage")
        );

        setDownloadInfo({
          version,
          macos: macosAsset
            ? {
                url: macosAsset.browser_download_url,
                size: formatBytes(macosAsset.size),
              }
            : undefined,
          windows: windowsAsset
            ? {
                url: windowsAsset.browser_download_url,
                size: formatBytes(windowsAsset.size),
              }
            : undefined,
          linux: linuxAsset
            ? {
                url: linuxAsset.browser_download_url,
                size: formatBytes(linuxAsset.size),
              }
            : undefined,
        });
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch releases:", err);
        setError(true);
        setLoading(false);
      }
    }

    fetchLatestRelease();
  }, []);

  // Detect user's platform
  const [platform, setPlatform] = useState<"macos" | "windows" | "linux" | null>(
    null
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      const userAgent = navigator.userAgent.toLowerCase();
      if (userAgent.includes("mac")) {
        setPlatform("macos");
      } else if (userAgent.includes("win")) {
        setPlatform("windows");
      } else if (userAgent.includes("linux")) {
        setPlatform("linux");
      }
    }
  }, []);

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
    return (
      <div className="text-center text-muted-foreground">
        <p className="text-sm">Desktop apps coming soon!</p>
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
