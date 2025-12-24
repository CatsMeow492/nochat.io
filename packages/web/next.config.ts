import type { NextConfig } from "next";

// Check if building for static export (mobile or desktop)
const isStaticExport =
  process.env.CAPACITOR_BUILD === "true" || process.env.TAURI_BUILD === "true";

const nextConfig: NextConfig = {
  // Output configuration for Capacitor/Tauri builds
  // Use "standalone" for Vercel/server deployment, "export" for mobile/desktop
  output: isStaticExport ? "export" : "standalone",

  // Required for static export (Capacitor/Tauri)
  images: {
    unoptimized: isStaticExport,
  },

  // Strict mode for development
  reactStrictMode: true,

  // Enable typed routes (moved from experimental in Next.js 16)
  typedRoutes: true,

  // Environment variables exposed to the browser
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },

  // Security headers (also in vercel.json for Vercel deployment)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=self, microphone=self, geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
