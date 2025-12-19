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
    default: "NoChat - Secure P2P Communication",
    template: "%s | NoChat",
  },
  description:
    "Zero-trust, post-quantum encrypted peer-to-peer video conferencing and messaging.",
  keywords: [
    "secure chat",
    "e2ee",
    "end-to-end encryption",
    "video conferencing",
    "post-quantum",
    "privacy",
    "p2p",
  ],
  authors: [{ name: "NoChat" }],
  openGraph: {
    title: "NoChat - Secure P2P Communication",
    description:
      "Zero-trust, post-quantum encrypted peer-to-peer video conferencing and messaging.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "NoChat - Secure P2P Communication",
    description:
      "Zero-trust, post-quantum encrypted peer-to-peer video conferencing and messaging.",
  },
  robots: {
    index: true,
    follow: true,
  },
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
