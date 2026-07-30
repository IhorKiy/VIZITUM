// Minimal service worker: lets the field zone's pages load with zero
// connectivity, not just the data on them (the IndexedDB stores in
// apps/web/lib already cover the data — see field-db.ts). Registered from
// route-snapshot-writer.tsx's sibling in field/layout.tsx.
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
//      build step: those URLs are content-hashed, so a cached response for
//      one is valid forever — a new deploy just requests different URLs.
//
// Everything else passes through untouched — in particular, no API/JSON/RSC
// response is ever cached here. The IndexedDB snapshot is the one data cache;
// a second one with its own invalidation is how offline apps rot.
const CACHE_NAME = "vizitum-shell-v1";
const OFFLINE_URL = "/offline.html";

// Matches /{tenantSlug}/field, /{tenantSlug}/field/anything — never
// /platform, the marketing pages, or /{tenantSlug}/admin|manager|operations,
// since "field" only ever appears as this literal second path segment for
// field-zone routes.
const FIELD_ZONE_PATH = /^\/[^/]+\/field(\/|$)/;
const STATIC_ASSET_PATH = /^\/_next\/static\//;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

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
        caches.open(CACHE_NAME).then((cache) => cache.match(OFFLINE_URL)),
      ),
    );
    return;
  }

  if (event.request.method === "GET" && STATIC_ASSET_PATH.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);

        if (cached) return cached;

        const response = await fetch(event.request);

        if (response.ok) cache.put(event.request, response.clone());

        return response;
      }),
    );
  }
});
