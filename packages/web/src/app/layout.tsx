import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "NoChat - Private Conversations. Finally.",
    template: "%s | NoChat",
  },
  description:
    "End-to-end encrypted messaging and video calls. No phone number required. Zero-knowledge architecture means we can never read your messages.",
  keywords: [
    "secure messaging",
    "encrypted chat",
    "e2ee",
    "end-to-end encryption",
    "video conferencing",
    "encrypted video calls",
    "privacy messaging",
    "anonymous chat",
    "no phone number",
    "zero knowledge",
    "private messaging",
    "secure video calls",
  ],
  authors: [{ name: "NoChat" }],
  creator: "NoChat",
  publisher: "NoChat",
  metadataBase: new URL("https://nochat.io"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "NoChat - Private Conversations. Finally.",
    description:
      "End-to-end encrypted messaging and video calls. No phone number required. Zero-knowledge architecture means we can never read your messages.",
    type: "website",
    locale: "en_US",
    url: "https://nochat.io",
    siteName: "NoChat",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "NoChat - Secure, Private Messaging",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NoChat - Private Conversations. Finally.",
    description:
      "End-to-end encrypted messaging and video calls. No phone number required. Zero-knowledge architecture.",
    images: ["/og-image.png"],
    creator: "@nochat",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    // Add these when you have the verification codes
    // google: "your-google-verification-code",
    // yandex: "your-yandex-verification-code",
  },
  category: "technology",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0a0a0f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
