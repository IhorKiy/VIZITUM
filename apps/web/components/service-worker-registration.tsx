"use client";

import { useEffect } from "react";

// Production only, plus an explicit opt-in for the E2E harness — see
// isServiceWorkerEnabled. `next dev`'s /_next/static/ chunks are not the
// same kind of immutable-by-URL asset a production build produces — the
// cache-first strategy in sw.js assumes a given URL's content never
// changes, which only a production build's content-hashed filenames
// actually keep. Registering in an ordinary dev session risks this repo's
// own known failure mode: a stale cached chunk surviving a code change that
// a plain reload should have picked up.
function isServiceWorkerEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return true;

  // playwright.config.ts sets this for its own dev-server run specifically,
  // since field-offline-shell.spec.ts needs the real worker registered to
  // verify its behavior — same shape as isDemoFallbackEnabled's explicit
  // override in demo-mode.ts.
  return ["1", "true", "yes", "on"].includes(
    (process.env.NEXT_PUBLIC_ENABLE_SERVICE_WORKER ?? "").trim().toLowerCase(),
  );
}

// Registers apps/web/public/sw.js — see that file for what it actually does
// (a minimal navigation fallback + static-asset cache, nothing else). Mounted
// here rather than gated on a session: registration only needs to happen
// once per browser to cover every later navigation in this scope, cold or
// not, signed in or not — the worker's own fetch handler is what actually
// decides whether a request is its concern.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!isServiceWorkerEnabled()) return;
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}
