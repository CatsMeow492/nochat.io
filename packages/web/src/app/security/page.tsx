import { Metadata } from "next";
import Link from "next/link";
import { Shield, Lock, Key, Eye, Server, Code } from "lucide-react";

export const metadata: Metadata = {
  title: "Security",
  description: "NoChat Security - Learn about our end-to-end encryption, zero-knowledge architecture, and security practices.",
};

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Header */}
        <header className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">Security</h1>
          <p className="text-muted-foreground text-lg">
            How NoChat protects your communications
          </p>
        </header>

        {/* Content */}
        <div className="space-y-10 text-foreground/90">
          {/* Overview */}
          <section className="glass rounded-xl p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-semibold mb-4">Security First</h2>
                <p className="leading-relaxed">
                  NoChat is built from the ground up with security as a core principle, not an afterthought.
                  Our zero-knowledge architecture ensures that your private communications remain private,
                  even from us.
                </p>
              </div>
            </div>
          </section>

          {/* End-to-End Encryption */}
          <section>
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Lock className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold pt-2">End-to-End Encryption</h2>
            </div>
            <p className="leading-relaxed mb-4">
              All messages and calls on NoChat are protected with end-to-end encryption (E2EE).
              This means:
            </p>
            <ul className="space-y-3 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Messages are encrypted on your device before being sent</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Only you and your intended recipients can decrypt and read messages</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>NoChat servers only see encrypted data that looks like random noise</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Even if our servers were compromised, attackers could not read your messages</span>
              </li>
            </ul>
          </section>

          {/* Encryption Details */}
          <section>
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Key className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold pt-2">Cryptographic Standards</h2>
            </div>
            <p className="leading-relaxed mb-4">
              We use industry-standard cryptographic algorithms:
            </p>
            <div className="glass rounded-xl p-6 space-y-4">
              <div>
                <h3 className="font-semibold mb-2">Message Encryption</h3>
                <ul className="space-y-2 text-sm text-foreground/80">
                  <li className="flex items-start gap-3">
                    <span className="text-primary mt-1">&#8226;</span>
                    <span><strong>AES-256-GCM</strong> for symmetric encryption</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-primary mt-1">&#8226;</span>
                    <span><strong>P-256 ECDH</strong> for key exchange</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-primary mt-1">&#8226;</span>
                    <span><strong>HKDF-SHA256</strong> for key derivation</span>
                  </li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Identity & Signatures</h3>
                <ul className="space-y-2 text-sm text-foreground/80">
                  <li className="flex items-start gap-3">
                    <span className="text-primary mt-1">&#8226;</span>
                    <span><strong>P-256 ECDSA</strong> for digital signatures</span>
                  </li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Video & Audio Calls</h3>
                <ul className="space-y-2 text-sm text-foreground/80">
                  <li className="flex items-start gap-3">
                    <span className="text-primary mt-1">&#8226;</span>
                    <span><strong>WebRTC</strong> with DTLS-SRTP encryption</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-primary mt-1">&#8226;</span>
                    <span>Peer-to-peer connections when possible</span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* Zero Knowledge */}
          <section>
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Eye className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold pt-2">Zero-Knowledge Architecture</h2>
            </div>
            <p className="leading-relaxed mb-4">
              NoChat operates on a zero-knowledge principle. This means we have designed our systems
              so that we cannot access your private data even if we wanted to:
            </p>
            <ul className="space-y-3 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Private keys never leave your device</strong> - encryption and decryption happen locally</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>No backdoors</strong> - there is no master key or special access</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Subpoena-resistant</strong> - even with a court order, we cannot provide message content because we do not have access to it</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Minimal metadata</strong> - we collect only what is necessary to deliver messages</span>
              </li>
            </ul>
          </section>

          {/* Server Security */}
          <section>
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Server className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold pt-2">Infrastructure Security</h2>
            </div>
            <p className="leading-relaxed mb-4">
              Our servers are protected with multiple layers of security:
            </p>
            <ul className="space-y-3 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>All network traffic is encrypted with TLS 1.3</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Regular security audits and penetration testing</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Encrypted database storage</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Strict access controls and monitoring</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Automatic security updates</span>
              </li>
            </ul>
          </section>

          {/* Open Source */}
          <section>
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Code className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold pt-2">Open Source</h2>
            </div>
            <p className="leading-relaxed mb-4">
              NoChat is open source, which means anyone can verify our security claims:
            </p>
            <ul className="space-y-3 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Full source code available on{" "}
                  <a
                    href="https://github.com/kindlyrobotics/nochat"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    GitHub
                  </a>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Security researchers can audit our cryptographic implementations</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Community contributions help identify and fix vulnerabilities</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Transparency builds trust</span>
              </li>
            </ul>
          </section>

          {/* Reporting Vulnerabilities */}
          <section className="glass rounded-xl p-6 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Report a Vulnerability</h2>
            <p className="leading-relaxed mb-4">
              We take security seriously and appreciate responsible disclosure. If you discover
              a security vulnerability, please report it to us:
            </p>
            <p className="leading-relaxed">
              <a href="mailto:security@nochat.io" className="text-primary hover:underline">
                security@nochat.io
              </a>
            </p>
            <p className="text-sm text-muted-foreground mt-4">
              We commit to acknowledging reports within 48 hours and providing regular updates
              on our progress toward a fix.
            </p>
          </section>

          {/* Best Practices */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Security Best Practices</h2>
            <p className="leading-relaxed mb-4">
              While NoChat protects your communications, you can further enhance your security:
            </p>
            <ul className="space-y-3 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Keep your app and device software up to date</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Use a strong, unique password if you create an account</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Verify contact identities through a separate channel when possible</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Be cautious of links and files from unknown sources</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Use device-level security features like screen lock and biometrics</span>
              </li>
            </ul>
          </section>
        </div>

        {/* Footer */}
        <footer className="mt-12 pt-8 border-t border-border">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <Link href="/" className="text-primary hover:underline">
              &larr; Back to NoChat
            </Link>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <Link href="/privacy" className="hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">
                Terms of Service
              </Link>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-6">
            NoChat - Security by Design
          </p>
        </footer>
      </div>
    </div>
  );
}
