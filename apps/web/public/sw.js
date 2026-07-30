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
const MAX_STATIC_CACHE_ENTRIES = 80;

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
