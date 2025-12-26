import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support - NoChat",
  description: "Get help with NoChat - FAQs, troubleshooting, and contact information.",
};

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Header */}
        <header className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">Support</h1>
          <p className="text-muted-foreground">Get help with NoChat Messenger</p>
        </header>

        {/* Content */}
        <div className="space-y-10 text-foreground/90">
          {/* Contact */}
          <section className="glass rounded-xl p-6 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Contact Us</h2>
            <p className="leading-relaxed mb-4">
              Need help? We&apos;re here for you. Reach out to our support team:
            </p>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#9993;</span>
                <span>
                  <strong>Email:</strong>{" "}
                  <a href="mailto:support@nochat.io" className="text-primary hover:underline">
                    support@nochat.io
                  </a>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#128172;</span>
                <span>
                  <strong>Response Time:</strong> We typically respond within 24 hours
                </span>
              </li>
            </ul>
          </section>

          {/* Getting Started */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Getting Started</h2>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50">
                <h3 className="font-medium mb-2">Starting a Video Meeting</h3>
                <p className="text-foreground/80">
                  Tap &quot;Start Meeting&quot; on the home screen to create a new meeting room.
                  Share the room link with others to invite them to join your secure video call.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <h3 className="font-medium mb-2">Joining a Meeting</h3>
                <p className="text-foreground/80">
                  Tap &quot;Join Meeting&quot; and enter the meeting code or paste the meeting link
                  you received. You&apos;ll connect directly to the encrypted video call.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <h3 className="font-medium mb-2">Sending Messages</h3>
                <p className="text-foreground/80">
                  Start a conversation from the chat tab. All messages are end-to-end encrypted,
                  meaning only you and your recipient can read them.
                </p>
              </div>
            </div>
          </section>

          {/* FAQ */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Frequently Asked Questions</h2>
            <div className="space-y-6">
              <div>
                <h3 className="font-medium mb-2">Is NoChat really private?</h3>
                <p className="text-foreground/80 leading-relaxed">
                  Yes. NoChat uses end-to-end encryption (E2EE) for all messages and calls.
                  This means your communications are encrypted on your device before being sent,
                  and only the intended recipient can decrypt them. We cannot read your messages.
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-2">Do I need to create an account?</h3>
                <p className="text-foreground/80 leading-relaxed">
                  No. You can use NoChat anonymously for video meetings without creating an account.
                  Creating an account is optional and enables additional features like persistent
                  chat history and contacts.
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-2">Is a phone number required?</h3>
                <p className="text-foreground/80 leading-relaxed">
                  No. Unlike other messaging apps, NoChat never requires a phone number.
                  You can sign up with just an email address, or use the app completely anonymously.
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-2">How do video calls work?</h3>
                <p className="text-foreground/80 leading-relaxed">
                  Video calls use WebRTC technology with peer-to-peer encryption. Your video and
                  audio streams go directly between participants without passing through our servers,
                  ensuring maximum privacy.
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-2">Can I delete my account?</h3>
                <p className="text-foreground/80 leading-relaxed">
                  Yes. You can delete your account at any time from the app settings or by visiting
                  our{" "}
                  <Link href="/delete-account" className="text-primary hover:underline">
                    account deletion page
                  </Link>
                  . All your data will be permanently removed.
                </p>
              </div>
            </div>
          </section>

          {/* Troubleshooting */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Troubleshooting</h2>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50">
                <h3 className="font-medium mb-2">Video or audio not working?</h3>
                <ul className="text-foreground/80 space-y-1 text-sm">
                  <li>&#8226; Check that you&apos;ve granted camera and microphone permissions</li>
                  <li>&#8226; Make sure no other app is using your camera or microphone</li>
                  <li>&#8226; Try refreshing the page or restarting the app</li>
                  <li>&#8226; Check your internet connection</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <h3 className="font-medium mb-2">Can&apos;t connect to a meeting?</h3>
                <ul className="text-foreground/80 space-y-1 text-sm">
                  <li>&#8226; Verify the meeting link or code is correct</li>
                  <li>&#8226; Check your internet connection</li>
                  <li>&#8226; If using a VPN, try disabling it temporarily</li>
                  <li>&#8226; Try using a different browser</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <h3 className="font-medium mb-2">Messages not sending?</h3>
                <ul className="text-foreground/80 space-y-1 text-sm">
                  <li>&#8226; Check your internet connection</li>
                  <li>&#8226; Make sure you&apos;re signed in to your account</li>
                  <li>&#8226; Try refreshing the page or restarting the app</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Security */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Security Information</h2>
            <p className="leading-relaxed mb-4">
              NoChat is built with security as a core principle. Learn more about our security practices:
            </p>
            <ul className="space-y-2 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <Link href="/security" className="hover:text-primary transition-colors">
                  Security Overview
                </Link>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <Link href="/privacy" className="hover:text-primary transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>
                  Report security issues:{" "}
                  <a href="mailto:security@nochat.io" className="text-primary hover:underline">
                    security@nochat.io
                  </a>
                </span>
              </li>
            </ul>
          </section>

          {/* App Versions */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Download NoChat</h2>
            <p className="leading-relaxed mb-4">
              NoChat is available on all major platforms:
            </p>
            <ul className="space-y-2 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Web:</strong> Use NoChat directly in your browser at nochat.io</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>iOS:</strong> Coming soon to the App Store</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Android:</strong> Coming soon to Google Play</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span><strong>Desktop:</strong> Download for macOS, Windows, and Linux</span>
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
            NoChat - Private by Design
          </p>
        </footer>
      </div>
    </div>
  );
}
