"use client";

import { useEffect } from "react";

import ukMessages from "../messages/uk.json";
import { reportError } from "../lib/error-reporting";

import "./globals.css";

// Rendered when the root layout itself crashes, outside the
// NextIntlClientProvider — the tenant locale is unresolvable here, so the
// copy is pinned to the uk dictionary the same way the marketing landing
// pins its locale (see CLAUDE.md, frontend i18n section).
const messages = ukMessages.common.globalError;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void reportError({
      exception: error,
      mechanism: "global-error",
      platform: "javascript",
      tags: { digest: error.digest },
      request: {
        url:
          typeof window === "undefined" ? undefined : window.location.pathname,
      },
    });
  }, [error]);

  return (
    <html lang="uk">
      <body>
        <main
          style={{
            display: "grid",
            placeContent: "center",
            gap: "1rem",
            minHeight: "100vh",
            textAlign: "center",
            padding: "2rem",
          }}
        >
          <h1>{messages.title}</h1>
          <p>{messages.description}</p>
          <button type="button" onClick={() => reset()}>
            {messages.reload}
          </button>
        </main>
      </body>
    </html>
  );
}
