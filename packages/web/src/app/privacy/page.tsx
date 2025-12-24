import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "NoChat Privacy Policy - Learn how we protect your data with end-to-end encryption.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Header */}
        <header className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">Privacy Policy</h1>
          <p className="text-muted-foreground">Last updated: December 22, 2024</p>
        </header>

        {/* Content */}
        <div className="space-y-10 text-foreground/90">
          {/* Introduction */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Introduction</h2>
            <p className="leading-relaxed">
              NoChat (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your privacy.
              This Privacy Policy explains how we collect, use, and safeguard your information when you
              use our secure messaging and video conferencing application.
            </p>
          </section>

          {/* Our Privacy Promise */}
          <section className="glass rounded-xl p-6 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Our Privacy Promise</h2>
            <p className="leading-relaxed mb-4">
              NoChat is built on a <strong>zero-knowledge architecture</strong>. This means:
            </p>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Your messages are end-to-end encrypted</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>We cannot read your messages or calls</strong> - not now, not ever</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>We cannot share message content because we simply do not have access to it</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Even with a court order, we cannot provide message content - it is encrypted with keys only you and your recipients hold</span>
              </li>
            </ul>
          </section>

          {/* End-to-End Encryption Explained */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">End-to-End Encryption Explained</h2>
            <p className="leading-relaxed mb-4">
              NoChat uses end-to-end encryption (E2EE) for all messages and calls. Here&apos;s what that means for you:
            </p>
            <ul className="space-y-3 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Messages are encrypted on your device before being sent</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Only the intended recipients can decrypt and read your messages</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Your private encryption keys never leave your device</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Video calls are encrypted peer-to-peer using WebRTC</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Our servers only see encrypted data that looks like random noise</span>
              </li>
            </ul>
          </section>

          {/* Information We Collect */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Information We Collect</h2>

            <h3 className="text-lg font-medium mt-6 mb-3">Information You Provide</h3>
            <ul className="space-y-2 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Account Information:</strong> If you create an account, we store your email address (optional) or a randomly generated anonymous identifier</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Username:</strong> A display name you choose (optional)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Public Cryptographic Keys:</strong> Used for E2EE - these do not reveal your content</span>
              </li>
            </ul>

            <h3 className="text-lg font-medium mt-6 mb-3">Anonymous Usage</h3>
            <p className="text-foreground/80 leading-relaxed">
              You can use NoChat anonymously without creating an account. In this case, we only store
              a temporary session identifier that is deleted when you leave. <strong>No phone number is ever required.</strong>
            </p>

            <h3 className="text-lg font-medium mt-6 mb-3">Automatically Collected Information</h3>
            <ul className="space-y-2 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Device Information:</strong> Device type and operating system for app functionality only</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Crash Reports:</strong> Anonymous crash data to improve stability (no personal information or message content included)</span>
              </li>
            </ul>
          </section>

          {/* Information We Do NOT Collect */}
          <section className="glass rounded-xl p-6 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Information We Do NOT Collect</h2>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Phone numbers - never required</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Message content - E2EE means we cannot read it</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Call audio or video content - encrypted and peer-to-peer</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Location data</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Contact lists from your device</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Advertising identifiers or tracking IDs</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Browsing history</span>
              </li>
            </ul>
          </section>

          {/* How We Use Information */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">How We Use Information</h2>
            <p className="mb-4">We use the limited information we collect to:</p>
            <ul className="space-y-2 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Provide and maintain the service</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Deliver encrypted messages to intended recipients</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Improve app stability through anonymous crash reports</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Respond to support requests (only if you contact us)</span>
              </li>
            </ul>
          </section>

          {/* Data Sharing */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Data Sharing</h2>
            <p className="leading-relaxed mb-4">
              <strong>We do not sell your data.</strong> We do not use your data for advertising.
              We do not share your data with data brokers or marketing companies.
            </p>
            <p className="leading-relaxed mb-4">We may share limited data with:</p>
            <ul className="space-y-3 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Infrastructure Providers:</strong> Cloud services that host our servers (they cannot access encrypted content)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Legal Requests:</strong> We will comply with valid legal requests, but we can only provide encrypted data that we cannot decrypt. We cannot provide message content.</span>
              </li>
            </ul>
          </section>

          {/* Data Retention */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Data Retention</h2>
            <ul className="space-y-2 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Encrypted Messages:</strong> Stored until you delete them</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Account Information:</strong> Retained until account deletion</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Crash Reports:</strong> Retained for 90 days, then automatically deleted</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Anonymous Sessions:</strong> Deleted when you leave</span>
              </li>
            </ul>
          </section>

          {/* Your Rights */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Your Rights</h2>
            <p className="mb-4">You have the right to:</p>
            <ul className="space-y-2 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Access your account data</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Delete your account and all associated data</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Export your data</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Opt out of crash reporting</span>
              </li>
            </ul>
          </section>

          {/* Account Deletion */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Account Deletion</h2>
            <p className="leading-relaxed">
              You can delete your account at any time through the app settings or by visiting our{" "}
              <Link href="/delete-account" className="text-primary hover:underline">
                account deletion page
              </Link>
              . When you delete your account, all your data is permanently removed from our servers.
              This action cannot be undone.
            </p>
          </section>

          {/* Children&apos;s Privacy */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Children&apos;s Privacy</h2>
            <p className="leading-relaxed">
              NoChat is not intended for users under 13 years of age. We do not knowingly collect
              personal information from children under 13. If you are a parent or guardian and believe
              your child has provided us with personal information, please contact us.
            </p>
          </section>

          {/* Changes to This Policy */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Changes to This Policy</h2>
            <p className="leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of significant
              changes via the app or email (if you provided one). The &quot;Last updated&quot; date at
              the top of this page indicates when the policy was last revised.
            </p>
          </section>

          {/* Contact Us */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Contact Us</h2>
            <p className="leading-relaxed">
              Questions about this Privacy Policy? Contact us at:{" "}
              <a href="mailto:privacy@nochat.io" className="text-primary hover:underline">
                privacy@nochat.io
              </a>
            </p>
          </section>
        </div>

        {/* Footer */}
        <footer className="mt-12 pt-8 border-t border-border">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <Link href="/" className="text-primary hover:underline">
              &larr; Back to NoChat
            </Link>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <Link href="/terms" className="hover:text-foreground transition-colors">
                Terms of Service
              </Link>
              <Link href="/delete-account" className="hover:text-foreground transition-colors">
                Delete Account
              </Link>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-6">
            NoChat - Private by Design
          </p>
        </footer>
      </div>
    </div>
  );
}
