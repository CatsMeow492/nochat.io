import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Android Beta Testing - NoChat",
  description: "Join the NoChat Android beta testing program and help shape the future of private messaging.",
};

export default function BetaPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Header */}
        <header className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">Android Beta Testing</h1>
          <p className="text-muted-foreground">Help us build the most private messaging app on Android</p>
        </header>

        {/* Content */}
        <div className="space-y-10 text-foreground/90">
          {/* Hero Section */}
          <section className="glass rounded-xl p-6 sm:p-8 border border-primary/20">
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">We Need Your Help!</h2>
            <p className="leading-relaxed mb-4">
              NoChat is launching on Android and we&apos;re looking for beta testers to help us
              ensure the best possible experience. As a beta tester, you&apos;ll get early access
              to NoChat on Android and help shape its development.
            </p>
            <div className="flex flex-wrap gap-3">
              <span className="px-3 py-1 bg-primary/20 text-primary rounded-full text-sm">Early Access</span>
              <span className="px-3 py-1 bg-primary/20 text-primary rounded-full text-sm">Free Forever</span>
              <span className="px-3 py-1 bg-primary/20 text-primary rounded-full text-sm">Help Shape the App</span>
            </div>
          </section>

          {/* How to Join */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">How to Join the Beta</h2>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50">
                <div className="flex items-start gap-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary text-background rounded-full flex items-center justify-center font-bold">1</span>
                  <div>
                    <h3 className="font-medium mb-2">Send Us Your Email</h3>
                    <p className="text-foreground/80 mb-3">
                      Email us with the Google/Gmail account you use on your Android device.
                      This is the email linked to Google Play on your phone.
                    </p>
                    <a
                      href="mailto:support@nochat.io?subject=Android%20Beta%20Tester%20Signup&body=Hi%2C%0A%0AI%27d%20like%20to%20join%20the%20NoChat%20Android%20beta%20testing%20program.%0A%0AMy%20Google%20account%20email%3A%20%5BYOUR_GMAIL_HERE%5D%0A%0AThanks!"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-background rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      <span>&#9993;</span> Email support@nochat.io
                    </a>
                  </div>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <div className="flex items-start gap-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary text-background rounded-full flex items-center justify-center font-bold">2</span>
                  <div>
                    <h3 className="font-medium mb-2">Receive Your Invitation</h3>
                    <p className="text-foreground/80">
                      We&apos;ll add you to our tester list and send you an invitation email from Google Play.
                      This usually takes less than 24 hours.
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <div className="flex items-start gap-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary text-background rounded-full flex items-center justify-center font-bold">3</span>
                  <div>
                    <h3 className="font-medium mb-2">Accept &amp; Download</h3>
                    <p className="text-foreground/80">
                      Click the link in your invitation email to opt-in, then download NoChat from Google Play.
                      You&apos;re all set!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* What to Expect */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">What to Expect</h2>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50">
                <h3 className="font-medium mb-2">Early Features</h3>
                <p className="text-foreground/80">
                  Get access to new features before they&apos;re publicly released. You&apos;ll be among
                  the first to try end-to-end encrypted messaging, secure video calls, and more on Android.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <h3 className="font-medium mb-2">Your Feedback Matters</h3>
                <p className="text-foreground/80">
                  Found a bug? Have a suggestion? Your feedback directly shapes the app.
                  Beta testers have a real impact on what we build next.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <h3 className="font-medium mb-2">Privacy First</h3>
                <p className="text-foreground/80">
                  Even in beta, your privacy is protected. All messages are end-to-end encrypted,
                  and we never collect personal data beyond what&apos;s needed to run the service.
                </p>
              </div>
            </div>
          </section>

          {/* About NoChat */}
          <section className="glass rounded-xl p-6 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Why NoChat?</h2>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#128274;</span>
                <span><strong>End-to-End Encryption:</strong> All messages and calls are encrypted so only you and your recipients can read them</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#128683;</span>
                <span><strong>No Phone Number Required:</strong> Sign up with just an email or use anonymously</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#128187;</span>
                <span><strong>Cross-Platform:</strong> Works on Android, iOS, Web, and Desktop</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#127760;</span>
                <span><strong>Free Forever:</strong> No ads, no tracking, no premium tier</span>
              </li>
            </ul>
          </section>

          {/* FAQ */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">FAQ</h2>
            <div className="space-y-6">
              <div>
                <h3 className="font-medium mb-2">Is the beta free?</h3>
                <p className="text-foreground/80">
                  Yes! NoChat is completely free, including the beta program. There are no premium
                  features or in-app purchases.
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-2">Will my data be safe?</h3>
                <p className="text-foreground/80">
                  Absolutely. We use the same security standards in beta as in production.
                  All messages are end-to-end encrypted.
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-2">Can I use the same account on multiple devices?</h3>
                <p className="text-foreground/80">
                  Yes! Your NoChat account works across Android, iOS, web, and desktop.
                  Sign in anywhere to access your conversations.
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-2">How long does the beta last?</h3>
                <p className="text-foreground/80">
                  The closed beta runs until we&apos;re confident the app is ready for everyone.
                  Beta testers will automatically transition to the public release.
                </p>
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="text-center py-8">
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Ready to Join?</h2>
            <a
              href="mailto:support@nochat.io?subject=Android%20Beta%20Tester%20Signup&body=Hi%2C%0A%0AI%27d%20like%20to%20join%20the%20NoChat%20Android%20beta%20testing%20program.%0A%0AMy%20Google%20account%20email%3A%20%5BYOUR_GMAIL_HERE%5D%0A%0AThanks!"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-background rounded-lg hover:bg-primary/90 transition-colors text-lg font-medium"
            >
              <span>&#9993;</span> Join the Android Beta
            </a>
            <p className="text-muted-foreground mt-4 text-sm">
              We&apos;ll add you within 24 hours
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
              <Link href="/privacy" className="hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              <Link href="/support" className="hover:text-foreground transition-colors">
                Support
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
