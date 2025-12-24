"use client";

import { useEffect, useState } from "react";

const GITHUB_OWNER = "CatsMeow492";
const GITHUB_REPO = "nochat.io";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
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

  // Fetch releases
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
        const desktopRelease = releases.find((r) =>
          r.tag_name.startsWith("desktop-v")
        );

        if (!desktopRelease) {
          setError(true);
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

        setDownloadInfo({
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
