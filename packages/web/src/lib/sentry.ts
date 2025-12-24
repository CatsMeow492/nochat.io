/**
 * Sentry Error Tracking Configuration
 *
 * Privacy-first configuration for NoChat's crash reporting.
 * This module initializes Sentry with strict privacy controls to ensure
 * no PII (personally identifiable information) is captured.
 *
 * IMPORTANT: NoChat is a privacy-focused application. This configuration:
 * - Does NOT capture user emails
 * - Does NOT capture IP addresses
 * - Does NOT capture message content
 * - Only captures technical error data (stack traces, browser info, etc.)
 */

import * as Sentry from "@sentry/react";

/**
 * List of errors to ignore - these are noisy and not actionable
 */
const IGNORED_ERRORS = [
  // Browser resize observer noise
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  // Network errors (expected in offline scenarios)
  "Network request failed",
  "Failed to fetch",
  "Load failed",
  "NetworkError",
  // WebRTC errors that are expected during normal operation
  "ICE connection failed",
  // User-initiated cancellations
  "AbortError",
  "The operation was aborted",
  // Browser extension interference
  "Extension context invalidated",
];

/**
 * Patterns to scrub from error messages and breadcrumbs
 * These patterns help prevent accidental PII leakage
 */
const PII_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email addresses
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, // IPv4 addresses
  /\b([a-f0-9]{1,4}:){7}[a-f0-9]{1,4}\b/gi, // IPv6 addresses
];

/**
 * Scrub potential PII from a string
 */
function scrubPII(text: string | undefined): string | undefined {
  if (!text) return text;

  let scrubbed = text;
  for (const pattern of PII_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, "[REDACTED]");
  }
  return scrubbed;
}

/**
 * Check if running in production environment
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Initialize Sentry error tracking
 *
 * Should be called once at application startup.
 * Only initializes in production to avoid noise during development.
 */
export function initSentry(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  // Only initialize in production with a valid DSN
  if (!isProduction()) {
    console.log("[Sentry] Skipping initialization in development mode");
    return;
  }

  if (!dsn) {
    console.warn(
      "[Sentry] No DSN configured. Set NEXT_PUBLIC_SENTRY_DSN environment variable."
    );
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0",

    // Performance Monitoring
    // Sample 10% of transactions for performance monitoring
    tracesSampleRate: 0.1,

    // Session Replay (disabled by default for privacy)
    // Can be enabled with reduced sample rate if needed
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // CRITICAL: Disable default PII collection
    // This prevents automatic collection of IP addresses
    sendDefaultPii: false,

    // Filter out noisy, non-actionable errors
    ignoreErrors: IGNORED_ERRORS,

    // Scrub URLs that might contain sensitive data
    denyUrls: [
      // Chrome extensions
      /extensions\//i,
      /^chrome:\/\//i,
      /^chrome-extension:\/\//i,
      // Firefox extensions
      /^moz-extension:\/\//i,
      // Safari extensions
      /^safari-extension:\/\//i,
    ],

    // Process events before sending to scrub any remaining PII
    beforeSend(event, hint) {
      // Remove any user data that might have been collected
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
        // Only keep anonymous identifier if needed for grouping
        event.user = event.user.id ? { id: event.user.id } : undefined;
      }

      // Scrub exception messages
      if (event.exception?.values) {
        for (const exception of event.exception.values) {
          if (exception.value) {
            exception.value = scrubPII(exception.value);
          }
        }
      }

      // Scrub message if present
      if (event.message) {
        event.message = scrubPII(event.message);
      }

      // Remove request body data (might contain message content)
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        // Scrub query strings that might contain PII
        if (event.request.query_string) {
          event.request.query_string = "[REDACTED]";
        }
      }

      // Scrub breadcrumb data
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
          if (breadcrumb.message) {
            breadcrumb.message = scrubPII(breadcrumb.message);
          }
          // Remove any data that might contain message content
          if (breadcrumb.data) {
            // Keep only safe metadata
            const safeData: Record<string, unknown> = {};
            const safeKeys = [
              "method",
              "status_code",
              "url",
              "from",
              "to",
              "level",
            ];
            for (const key of safeKeys) {
              if (key in breadcrumb.data) {
                safeData[key] = breadcrumb.data[key];
              }
            }
            // Scrub URLs in breadcrumb data
            if (typeof safeData.url === "string") {
              // Remove query parameters which might contain sensitive data
              try {
                const url = new URL(safeData.url);
                url.search = "";
                safeData.url = url.toString();
              } catch {
                // If URL parsing fails, redact the whole thing
                safeData.url = "[REDACTED]";
              }
            }
            breadcrumb.data = safeData;
          }
          return breadcrumb;
        });
      }

      // Remove extra data that might contain chat messages or sensitive info
      if (event.extra) {
        const safeExtras = ["browser", "device", "os", "runtime"];
        const filtered: Record<string, unknown> = {};
        for (const key of safeExtras) {
          if (key in event.extra) {
            filtered[key] = event.extra[key];
          }
        }
        event.extra = filtered;
      }

      // Remove contexts that might leak sensitive info
      if (event.contexts) {
        // Keep only technical contexts
        const safeContexts = ["browser", "device", "os", "runtime", "trace"];
        for (const key of Object.keys(event.contexts)) {
          if (!safeContexts.includes(key)) {
            delete event.contexts[key];
          }
        }
      }

      return event;
    },

    // Process breadcrumbs before adding to prevent PII capture
    beforeBreadcrumb(breadcrumb) {
      // Filter out breadcrumbs that might contain message content
      if (breadcrumb.category === "console") {
        // Only keep error and warning level console messages
        if (
          breadcrumb.level !== "error" &&
          breadcrumb.level !== "warning"
        ) {
          return null;
        }
        // Scrub the message
        if (breadcrumb.message) {
          breadcrumb.message = scrubPII(breadcrumb.message);
        }
      }

      // Filter out XHR/fetch breadcrumbs for messaging endpoints
      if (breadcrumb.category === "xhr" || breadcrumb.category === "fetch") {
        const url = breadcrumb.data?.url as string | undefined;
        if (url) {
          // Filter out messaging-related endpoints to prevent content leakage
          if (
            url.includes("/messages") ||
            url.includes("/conversations") ||
            url.includes("/signaling")
          ) {
            return null;
          }
        }
      }

      return breadcrumb;
    },
  });

  console.log("[Sentry] Initialized with privacy-safe configuration");
}

/**
 * Set anonymous user ID for error grouping
 *
 * Only sets an anonymous identifier - no PII is stored.
 * Call this after user authentication if you want to group errors by user.
 *
 * @param userId - Anonymous user identifier (UUID recommended)
 */
export function setSentryUser(userId: string): void {
  if (!isProduction()) return;

  Sentry.setUser({
    id: userId,
    // Explicitly do not set email, username, or ip_address
  });
}

/**
 * Clear user from Sentry context (call on logout)
 */
export function clearSentryUser(): void {
  if (!isProduction()) return;

  Sentry.setUser(null);
}

/**
 * Capture a custom error with additional context
 *
 * Use this for errors that need specific handling or additional metadata.
 * Ensure no message content or PII is included in the context.
 *
 * @param error - The error to capture
 * @param context - Additional context (avoid including PII)
 */
export function captureError(
  error: Error,
  context?: Record<string, unknown>
): void {
  if (!isProduction()) {
    console.error("[Sentry] Would capture error:", error, context);
    return;
  }

  // Sanitize context to remove potential PII
  const safeContext = context
    ? Object.fromEntries(
        Object.entries(context).filter(([key]) => {
          const unsafeKeys = [
            "message",
            "content",
            "email",
            "username",
            "password",
            "token",
            "ip",
          ];
          return !unsafeKeys.some((unsafe) =>
            key.toLowerCase().includes(unsafe)
          );
        })
      )
    : undefined;

  Sentry.captureException(error, {
    extra: safeContext,
  });
}

/**
 * Add a breadcrumb for debugging
 *
 * Breadcrumbs help trace the user journey leading to an error.
 * Avoid including message content or PII.
 *
 * @param message - Description of the action (no PII)
 * @param category - Category for grouping (e.g., 'navigation', 'action')
 * @param data - Additional data (no PII)
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>
): void {
  if (!isProduction()) return;

  Sentry.addBreadcrumb({
    message: scrubPII(message),
    category,
    data,
    level: "info",
  });
}

// Re-export Sentry's ErrorBoundary for convenience
export { ErrorBoundary as SentryErrorBoundary } from "@sentry/react";
