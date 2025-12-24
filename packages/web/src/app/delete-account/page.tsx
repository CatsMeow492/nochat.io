"use client";

import { Metadata } from "next";
import { useState } from "react";

export default function DeleteAccountPage() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In production, this would send the deletion request to the backend
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0a0f] to-[#1a1a2e] text-white">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-4">Delete Your Account</h1>
        <p className="text-gray-400 mb-8">
          We&apos;re sorry to see you go. Please read the information below before proceeding.
        </p>

        {!submitted ? (
          <>
            <div className="bg-[#1a1a2e] border border-gray-800 rounded-lg p-6 mb-8">
              <h2 className="text-xl font-semibold mb-4">What happens when you delete your account:</h2>
              <ul className="list-disc list-inside space-y-2 text-gray-300">
                <li>Your profile and account information will be permanently deleted</li>
                <li>Your message history will be removed from our servers</li>
                <li>Your cryptographic keys will be deleted</li>
                <li>You will be logged out of all devices</li>
                <li>This action cannot be undone</li>
              </ul>
            </div>

            <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-6 mb-8">
              <h3 className="text-yellow-400 font-semibold mb-2">Important Note</h3>
              <p className="text-gray-300">
                Messages you&apos;ve sent to others may still appear on their devices,
                as NoChat uses end-to-end encryption and we don&apos;t have access to
                messages stored on user devices.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-2">
                  Confirm your email address
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
                <label htmlFor="reason" className="block text-sm font-medium mb-2">
                  Why are you leaving? (optional)
                </label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Help us improve by sharing your feedback..."
                  rows={4}
                  className="w-full px-4 py-3 bg-[#0a0a0f] border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 text-white placeholder-gray-500 resize-none"
                />
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
                  className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition-colors"
                >
                  Delete My Account
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="bg-green-900/20 border border-green-600/30 rounded-lg p-8 text-center">
            <div className="text-4xl mb-4">&#10003;</div>
            <h2 className="text-2xl font-semibold mb-4">Deletion Request Received</h2>
            <p className="text-gray-300 mb-6">
              We&apos;ve received your account deletion request. Your account and all associated
              data will be permanently deleted within 30 days. You will receive a confirmation
              email once the process is complete.
            </p>
            <a
              href="/"
              className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Return to Home
            </a>
          </div>
        )}

        <div className="mt-12 pt-8 border-t border-gray-800">
          <p className="text-gray-400 text-sm">
            For any questions about data deletion, please contact us at{" "}
            <a href="mailto:privacy@nochat.io" className="text-blue-400 hover:underline">
              privacy@nochat.io
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
