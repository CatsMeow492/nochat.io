import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "NoChat Terms of Service - Read the terms and conditions for using our secure messaging platform.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Header */}
        <header className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">Terms of Service</h1>
          <p className="text-muted-foreground">Last updated: December 22, 2024</p>
        </header>

        {/* Content */}
        <div className="space-y-10 text-foreground/90">
          {/* Agreement to Terms */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Agreement to Terms</h2>
            <p className="leading-relaxed">
              By accessing or using NoChat, you agree to be bound by these Terms of Service
              (&quot;Terms&quot;). If you do not agree to these Terms, you may not access or use
              our service. These Terms apply to all visitors, users, and others who access or use NoChat.
            </p>
          </section>

          {/* Description of Service */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Description of Service</h2>
            <p className="leading-relaxed mb-4">
              NoChat provides end-to-end encrypted messaging and video calling services. Key aspects of our service:
            </p>
            <ul className="space-y-3 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>All communications are end-to-end encrypted</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>We cannot access, read, or moderate your message content</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Video calls are peer-to-peer and encrypted</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Anonymous usage is available without registration</span>
              </li>
            </ul>
          </section>

          {/* Your Account */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Your Account</h2>
            <p className="leading-relaxed mb-4">
              When you create an account with us, you must provide accurate information and keep it up to date.
              You are responsible for:
            </p>
            <ul className="space-y-3 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Maintaining the security of your account and password</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>All activities that occur under your account</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Not sharing your account credentials with others</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Notifying us immediately of any unauthorized use</span>
              </li>
            </ul>
            <p className="leading-relaxed mt-4 text-foreground/80">
              You must be at least 13 years old to use NoChat. By using our service, you represent
              that you meet this age requirement.
            </p>
          </section>

          {/* Acceptable Use */}
          <section className="glass rounded-xl p-6 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Acceptable Use</h2>
            <p className="leading-relaxed mb-4">
              You agree NOT to use NoChat to:
            </p>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Engage in illegal activities or promote illegal content</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Harass, abuse, threaten, or harm others</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Send spam, unsolicited messages, or bulk communications</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Distribute malware, viruses, or other malicious content</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Attempt to circumvent security measures or exploit vulnerabilities</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Impersonate other individuals or entities</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-destructive mt-1">&#10005;</span>
                <span>Interfere with the proper operation of the service</span>
              </li>
            </ul>
            <p className="leading-relaxed mt-4 text-sm text-muted-foreground">
              Note: Due to end-to-end encryption, we cannot monitor or access message content.
              Users are responsible for their own communications.
            </p>
          </section>

          {/* Content Ownership */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Content Ownership</h2>
            <ul className="space-y-3 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>You retain full ownership of all content you create and share through NoChat</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>You grant NoChat a limited license solely to transmit your encrypted content to intended recipients</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>We cannot access, use, or view your encrypted content</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>You are solely responsible for the content you send and share</span>
              </li>
            </ul>
          </section>

          {/* Privacy */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Privacy</h2>
            <p className="leading-relaxed">
              Your use of NoChat is also governed by our{" "}
              <Link href="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              , which describes how we collect, use, and protect your information.
              Our privacy-first approach means we collect minimal data and cannot access
              your encrypted communications.
            </p>
          </section>

          {/* Intellectual Property */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Intellectual Property</h2>
            <p className="leading-relaxed">
              NoChat and its original content, features, and functionality are owned by NoChat
              and are protected by international copyright, trademark, and other intellectual
              property laws. You may not copy, modify, distribute, sell, or lease any part
              of our service without prior written consent.
            </p>
          </section>

          {/* Third-Party Services */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Third-Party Services</h2>
            <p className="leading-relaxed">
              NoChat may contain links to third-party websites or services that are not owned
              or controlled by NoChat. We have no control over, and assume no responsibility for,
              the content, privacy policies, or practices of any third-party websites or services.
            </p>
          </section>

          {/* Termination */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Termination</h2>
            <p className="leading-relaxed mb-4">
              We may terminate or suspend your access immediately, without prior notice or liability, for any reason,
              including but not limited to a breach of these Terms.
            </p>
            <p className="leading-relaxed">
              You may delete your account at any time through the app settings or by visiting our{" "}
              <Link href="/delete-account" className="text-primary hover:underline">
                account deletion page
              </Link>
              . Upon termination, your right to use the service will immediately cease.
            </p>
          </section>

          {/* Disclaimers */}
          <section className="glass rounded-xl p-6 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Disclaimers</h2>
            <p className="leading-relaxed mb-4">
              NoChat is provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; without warranties
              of any kind, whether express or implied. We do not warrant that:
            </p>
            <ul className="space-y-3 text-foreground/80">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>The service will be uninterrupted, timely, secure, or error-free</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Results obtained from the service will be accurate or reliable</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Defects in the operation or functionality will be corrected</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>The service is free of viruses or other harmful components</span>
              </li>
            </ul>
          </section>

          {/* Limitation of Liability */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Limitation of Liability</h2>
            <p className="leading-relaxed">
              To the maximum extent permitted by applicable law, in no event shall NoChat, its affiliates,
              officers, directors, employees, agents, or licensors be liable for any indirect, incidental,
              special, consequential, or punitive damages, including but not limited to loss of profits,
              data, use, goodwill, or other intangible losses, resulting from:
            </p>
            <ul className="space-y-2 text-foreground/80 mt-4">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Your access to or use of (or inability to access or use) the service</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Any conduct or content of any third party on the service</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Any content obtained from the service</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-1">&#8226;</span>
                <span>Unauthorized access, use, or alteration of your transmissions or content</span>
              </li>
            </ul>
          </section>

          {/* Indemnification */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Indemnification</h2>
            <p className="leading-relaxed">
              You agree to defend, indemnify, and hold harmless NoChat and its officers, directors,
              employees, and agents from any claims, damages, obligations, losses, or expenses arising
              from your use of the service or your violation of these Terms.
            </p>
          </section>

          {/* Governing Law */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Governing Law</h2>
            <p className="leading-relaxed">
              These Terms shall be governed and construed in accordance with the laws of the
              United States, without regard to its conflict of law provisions. Our failure to
              enforce any right or provision of these Terms will not be considered a waiver of those rights.
            </p>
          </section>

          {/* Changes to Terms */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Changes to Terms</h2>
            <p className="leading-relaxed">
              We reserve the right to modify or replace these Terms at any time at our sole discretion.
              If a revision is material, we will provide at least 30 days&apos; notice prior to any new
              terms taking effect. What constitutes a material change will be determined at our sole discretion.
              By continuing to access or use our service after those revisions become effective, you agree
              to be bound by the revised terms.
            </p>
          </section>

          {/* Severability */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Severability</h2>
            <p className="leading-relaxed">
              If any provision of these Terms is held to be unenforceable or invalid, such provision
              will be changed and interpreted to accomplish the objectives of such provision to the
              greatest extent possible under applicable law, and the remaining provisions will continue
              in full force and effect.
            </p>
          </section>

          {/* Contact Us */}
          <section>
            <h2 className="text-xl sm:text-2xl font-semibold mb-4">Contact Us</h2>
            <p className="leading-relaxed">
              If you have any questions about these Terms, please contact us at:{" "}
              <a href="mailto:legal@nochat.io" className="text-primary hover:underline">
                legal@nochat.io
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
              <Link href="/privacy" className="hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              <Link href="/delete-account" className="hover:text-foreground transition-colors">
                Delete Account
              </Link>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-6">
            NoChat - Your conversations, your privacy
          </p>
        </footer>
      </div>
    </div>
  );
}
