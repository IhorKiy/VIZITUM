"use client";

import { useEffect } from "react";

// Registers apps/web/public/sw.js — see that file for what it actually does
// (a minimal navigation fallback + static-asset cache, nothing else). Mounted
// here rather than gated on a session: registration only needs to happen
// once per browser to cover every later navigation in this scope, cold or
// not, signed in or not — the worker's own fetch handler is what actually
// decides whether a request is its concern.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}
