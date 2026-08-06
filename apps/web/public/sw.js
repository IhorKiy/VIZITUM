// Minimal service worker: lets the field zone's pages load with zero
// connectivity, not just the data on them (the IndexedDB stores in
// apps/web/lib already cover the data — see field-db.ts). Registered from
// route-snapshot-writer.tsx's sibling in field/layout.tsx, production only
// (see that file's own comment for why).
//
// Deliberately narrow. Two things only:
//
//   1. A failed full-page navigation into the field zone falls back to a
//      cached, static, tenant-agnostic shell (offline.html) instead of the
//      browser's own "no internet" page. That shell reads today's route back
//      out of IndexedDB itself — this worker moves no application data, only
//      bytes for a page to boot from.
//   2. Static assets under /_next/static/ are cached the first time they are
//      fetched and served from cache after that. No precache manifest, no
//      build step: those URLs are content-hashed in a production build, so a
//      cached response for one is valid forever — a new deploy just requests
//      different URLs.
//
// Everything else passes through untouched — in particular, no API/JSON/RSC
// response is ever cached here. The IndexedDB snapshot is the one data cache;
// a second one with its own invalidation is how offline apps rot.
//
// What this does not cover: a cold start with no network.
//
// Measured on a real iPhone (iOS 18.7.9, standalone Home Screen install) —
// docs/runbooks/field-offline-iphone-test.md scenario T2b is the record, and
// T2a the warm one that passes. Point 1 above holds only for a browsing
// context this worker already controls — a warm app that loses signal and
// reloads gets offline.html, first try. An app that was force-quit (or that
// iOS evicted from memory, which is the same thing from here) and is then
// launched offline gets Safari's own error page instead, and reloading from
// that page does not recover. A plain Safari tab fails identically, so it is
// not about the standalone display mode.
//
// The worker is not broken in that state and this is not a scope bug: with
// the app warm, registration is `activated`, this file is the controller at
// scope `/`, vizitum-shell-v1 holds /offline.html, and an offline fetch of a
// /_next/static/ chunk is served from vizitum-static-v1 — the fetch handler
// runs fine with no network. WebKit simply fails the *launch* navigation
// before dispatching it here, so no branch below gets a say. Nothing in this
// file can fix that: it is reached too late.
//
// What was measured here is the behavior above. The mechanism is inferred
// from that plus long-standing reports of the same shape against WebKit —
// the provisional load failing at the network layer (NSURLErrorDomain -1009)
// with the worker never consulted — whose only documented workaround is
// WKWebView-only (load a local HTML document first, then navigate). A Home
// Screen install has no equivalent lever, which is why this is recorded
// rather than worked around.
//
// So the honest promise is "a warm app that walks into a dead zone", not "a
// cold launch with no signal". The plan doc, module-map and the runbook's
// T2a/T2b all say so now; don't restore the stronger claim without a real
// device re-test, and note that apps/web/e2e/field-offline-shell.spec.ts
// cannot settle it either way (Chromium does not reproduce the failure).
//
// Two separate caches, not one: the shell cache holds exactly one entry
// (offline.html) that must never be evicted, and the static cache is capped
// and trimmed — sharing a cache would risk a trim deleting the one file the
// whole fallback depends on.
const SHELL_CACHE_NAME = "vizitum-shell-v1";
const STATIC_CACHE_NAME = "vizitum-static-v1";
const OFFLINE_URL = "/offline.html";

// Bounds how much of this device's storage quota old builds' chunks can
// hold onto. The same origin's IndexedDB stores recordings and photos that
// cannot be recreated — a quota eviction triggered by static assets
// accumulating forever, across every past deploy, is a worse outcome than
// occasionally re-fetching one that got trimmed.
//
// Eviction is still oldest-by-insertion-order (see trimStaticCache), not
// LRU — the worker's scope is the whole origin, so this cache also holds
// admin/manager/platform chunks, and insertion order alone would evict the
// shared framework bundles every zone re-fetches first, keeping only
// whichever page happened to load last. Rather than touching entries on a
// hit to approximate LRU, the limit is sized so trimming essentially never
// fires in normal use: a full production build of every zone in this app is
// ~50 static files (`find apps/web/.next/static -type f | wc -l` after
// `npm run web:build`), so 200 comfortably covers several overlapping
// deploys' worth of chunks before the wrong-order eviction could ever bite.
const MAX_STATIC_CACHE_ENTRIES = 200;

// Matches /{tenantSlug}/field, /{tenantSlug}/field/anything — never
// /platform, the marketing pages, or /{tenantSlug}/admin|manager|operations,
// since "field" only ever appears as this literal second path segment for
// field-zone routes.
const FIELD_ZONE_PATH = /^\/[^/]+\/field(\/|$)/;
const STATIC_ASSET_PATH = /^\/_next\/static\//;

// Last-resort bytes for the one case that should never happen but must
// still not throw: install's own cache.add(OFFLINE_URL) not having landed
// (or the cache having been cleared some other way) by the time a
// navigation actually fails. respondWith() requires a real Response — handing
// it `undefined` throws instead of falling back at all.
function fallbackOfflineResponse() {
  return new Response(
    "<!doctype html><title>Offline</title><p>Offline, and this device has no cached fallback page either.</p>",
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// Called once per cache miss that succeeds (see the fetch handler below),
// never on a hit — so its O(n) cache.keys() listing runs at most once per
// distinct static asset URL this device ever requests through the worker,
// not per request. Deliberately not gated behind a counter or an "only
// every Nth miss" check: distinct-URL misses are already rare relative to
// hits (a given URL is fetched at most once for as long as it stays
// cached), and the cap above is sized so the listing is usually a no-op
// anyway.
async function trimStaticCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_STATIC_CACHE_ENTRIES;

  if (excess <= 0) return;

  // Cache.keys() order isn't formally specified, but is insertion order in
  // practice — good enough for a coarse bound; this is not trying to be a
  // precise LRU.
  await Promise.all(
    keys.slice(0, excess).map((request) => cache.delete(request)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name !== SHELL_CACHE_NAME && name !== STATIC_CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // `mode === "navigate"` is why the field zone's links are plain anchors
  // rather than `next/link`: an anchor produces a document navigation and
  // reaches this branch, a client-side RSC fetch does not and never sees the
  // cached shell. That constraint lives in the components, where it is
  // invisible from here — `tests/web-field-zone-anchors.test.ts` holds the two
  // together, and CLAUDE.md's frontend section states it (audit F32).
  if (
    event.request.method === "GET" &&
    event.request.mode === "navigate" &&
    FIELD_ZONE_PATH.test(url.pathname)
  ) {
    // Network-first: the common, online case is untouched. Only a genuinely
    // failed fetch (no network at all — the same signal this codebase's own
    // outbox queues already treat as authoritative, see report-send-outcome.ts)
    // falls through to the cached shell; a real error response from the
    // server is left alone rather than being read as "offline".
    event.respondWith(
      fetch(event.request).catch(() =>
        caches
          .open(SHELL_CACHE_NAME)
          .then((cache) => cache.match(OFFLINE_URL))
          .then((response) => response ?? fallbackOfflineResponse()),
      ),
    );
    return;
  }

  if (event.request.method === "GET" && STATIC_ASSET_PATH.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);

        if (cached) return cached;

        const response = await fetch(event.request);

        if (response.ok) {
          await cache.put(event.request, response.clone());
          await trimStaticCache(cache);
        }

        return response;
      }),
    );
  }
});
