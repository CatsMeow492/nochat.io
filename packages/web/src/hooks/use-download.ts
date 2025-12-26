"use client";

import { useEffect, useState } from "react";

const GITHUB_OWNER = "CatsMeow492";
const GITHUB_REPO = "nochat.io";
const CACHE_KEY = "nochat-download-info";
const CACHE_TTL = 1000 * 60 * 60; // 1 hour cache

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

interface CachedDownloadInfo {
  data: DownloadInfo;
  timestamp: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export interface DownloadInfo {
  version: string;
  macos?: { url: string; size: string };
  windows?: { url: string; size: string };
  linux?: { url: string; size: string };
}

export type Platform = "macos" | "windows" | "linux" | null;

// Fallback URLs in case GitHub API is rate limited
// These are updated whenever we know the current release version
const FALLBACK_VERSION = "1.0.10";
const FALLBACK_BASE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/desktop-v${FALLBACK_VERSION}`;
const FALLBACK_DOWNLOAD_INFO: DownloadInfo = {
  version: FALLBACK_VERSION,
  macos: { url: `${FALLBACK_BASE_URL}/NoChat_${FALLBACK_VERSION}_universal.dmg`, size: "~30 MB" },
  windows: { url: `${FALLBACK_BASE_URL}/NoChat_${FALLBACK_VERSION}_x64-setup.exe`, size: "~30 MB" },
  linux: { url: `${FALLBACK_BASE_URL}/NoChat_${FALLBACK_VERSION}_amd64.AppImage`, size: "~90 MB" },
};

function getCachedInfo(): DownloadInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const parsed: CachedDownloadInfo = JSON.parse(cached);
    // Check if cache is still valid
    if (Date.now() - parsed.timestamp < CACHE_TTL) {
      return parsed.data;
    }
    // Cache expired
    localStorage.removeItem(CACHE_KEY);
    return null;
  } catch {
    return null;
  }
}

function setCachedInfo(info: DownloadInfo): void {
  if (typeof window === "undefined") return;
  try {
    const cached: CachedDownloadInfo = {
      data: info,
      timestamp: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // Ignore storage errors
  }
}

export function useDownload() {
  const [downloadInfo, setDownloadInfo] = useState<DownloadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [platform, setPlatform] = useState<Platform>(null);

  // Detect platform
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

  // Fetch releases with caching
  useEffect(() => {
    async function fetchLatestRelease() {
      // Try cache first
      const cached = getCachedInfo();
      if (cached) {
        setDownloadInfo(cached);
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=10`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch releases");
        }

        const releases: Release[] = await response.json();
        const desktopRelease = releases.find((r) =>
          r.tag_name.startsWith("desktop-v")
        );

        if (!desktopRelease) {
          // Use fallback if no release found
          setDownloadInfo(FALLBACK_DOWNLOAD_INFO);
          setLoading(false);
          return;
        }

        const version = desktopRelease.tag_name.replace("desktop-v", "");

        const macosAsset = desktopRelease.assets.find(
          (a) => a.name.includes("universal") && a.name.endsWith(".dmg")
        );
        const windowsAsset = desktopRelease.assets.find(
          (a) => a.name.includes("x64-setup") && a.name.endsWith(".exe")
        );
        const linuxAsset = desktopRelease.assets.find((a) =>
          a.name.endsWith(".AppImage")
        );

        const info: DownloadInfo = {
          version,
          macos: macosAsset
            ? { url: macosAsset.browser_download_url, size: formatBytes(macosAsset.size) }
            : undefined,
          windows: windowsAsset
            ? { url: windowsAsset.browser_download_url, size: formatBytes(windowsAsset.size) }
            : undefined,
          linux: linuxAsset
            ? { url: linuxAsset.browser_download_url, size: formatBytes(linuxAsset.size) }
            : undefined,
        };

        // Cache the result
        setCachedInfo(info);
        setDownloadInfo(info);
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch releases:", err);
        // Use fallback on error (e.g., rate limited)
        setDownloadInfo(FALLBACK_DOWNLOAD_INFO);
        setLoading(false);
      }
    }

    fetchLatestRelease();
  }, []);

  // Get download URL for current platform
  const getDownloadUrl = (): string => {
    if (!downloadInfo) {
      return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
    }

    const platformDownload =
      platform === "macos"
        ? downloadInfo.macos
        : platform === "windows"
          ? downloadInfo.windows
          : platform === "linux"
            ? downloadInfo.linux
            : downloadInfo.macos; // Default to macOS

    return platformDownload?.url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  };

  const getPlatformName = (): string => {
    return platform === "macos"
      ? "macOS"
      : platform === "windows"
        ? "Windows"
        : platform === "linux"
          ? "Linux"
          : "Desktop";
  };

  return {
    downloadInfo,
    loading,
    error,
    platform,
    getDownloadUrl,
    getPlatformName,
    releasesUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
  };
}
