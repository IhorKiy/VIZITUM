"use client";

import { useEffect } from "react";

import { reportError } from "../lib/error-reporting";

// Mounted once in the root layout; registers global browser handlers so
// uncaught exceptions and unhandled promise rejections reach Sentry.
// Renders nothing.
export function ErrorMonitor() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      void reportError({
        exception: event.error ?? event.message,
        mechanism: "onerror",
        platform: "javascript",
        request: { url: window.location.pathname },
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      void reportError({
        exception: event.reason,
        mechanism: "onunhandledrejection",
        platform: "javascript",
        request: { url: window.location.pathname },
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
