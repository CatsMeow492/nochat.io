"use client";

import { useState } from "react";

export default function DataDeletionPage() {
  const [email, setEmail] = useState("");
  const [dataType, setDataType] = useState("all");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In production, this would send the deletion request to the backend
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0a0f] to-[#1a1a2e] text-white">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-4">Request Data Deletion</h1>
        <p className="text-gray-400 mb-8">
          You have the right to request deletion of your personal data. Use this form
          to submit a data deletion request.
        </p>

        {!submitted ? (
          <>
            <div className="bg-[#1a1a2e] border border-gray-800 rounded-lg p-6 mb-8">
              <h2 className="text-xl font-semibold mb-4">What data can be deleted:</h2>
              <ul className="list-disc list-inside space-y-2 text-gray-300">
                <li><strong>Account Data:</strong> Your profile, email, and account settings</li>
                <li><strong>Message History:</strong> Encrypted messages stored on our servers</li>
                <li><strong>Cryptographic Keys:</strong> Your public keys stored for E2EE</li>
                <li><strong>Usage Data:</strong> Any analytics or logs associated with your account</li>
              </ul>
            </div>

            <div className="bg-blue-900/20 border border-blue-600/30 rounded-lg p-6 mb-8">
              <h3 className="text-blue-400 font-semibold mb-2">Privacy by Design</h3>
              <p className="text-gray-300">
                NoChat collects minimal data by design. All your messages are end-to-end
                encrypted, meaning we cannot read their contents. When you delete your data,
                we remove everything we have access to on our servers.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-2">
                  Email address associated with your account
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email address"
                  className="w-full px-4 py-3 bg-[#0a0a0f] border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 text-white placeholder-gray-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  What data would you like to delete?
                </label>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="dataType"
                      value="all"
                      checked={dataType === "all"}
                      onChange={(e) => setDataType(e.target.value)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span>Delete all data and my account</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="dataType"
                      value="messages"
                      checked={dataType === "messages"}
                      onChange={(e) => setDataType(e.target.value)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span>Delete only message history (keep account)</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="dataType"
                      value="usage"
                      checked={dataType === "usage"}
                      onChange={(e) => setDataType(e.target.value)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span>Delete only usage/analytics data (keep account)</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-4">
                <a
                  href="/"
                  className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-center transition-colors"
                >
                  Cancel
                </a>
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="bg-green-900/20 border border-green-600/30 rounded-lg p-8 text-center">
            <div className="text-4xl mb-4">&#10003;</div>
            <h2 className="text-2xl font-semibold mb-4">Request Received</h2>
            <p className="text-gray-300 mb-6">
              We&apos;ve received your data deletion request. We will process your request
              within 30 days as required by applicable data protection regulations.
              You will receive a confirmation email once the deletion is complete.
            </p>
            <a
              href="/"
              className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Return to Home
            </a>
          </div>
        )}

        <div className="mt-12 pt-8 border-t border-gray-800 space-y-4">
          <p className="text-gray-400 text-sm">
            For questions about your data or this process, contact us at{" "}
            <a href="mailto:privacy@nochat.io" className="text-blue-400 hover:underline">
              privacy@nochat.io
            </a>
          </p>
          <p className="text-gray-500 text-sm">
            See our{" "}
            <a href="/privacy" className="text-blue-400 hover:underline">
              Privacy Policy
            </a>{" "}
            for more information about how we handle your data.
          </p>
        </div>
      </div>
    </div>
  );
}
