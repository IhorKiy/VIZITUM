# Task: Offline resilience for the field zone — local drafts, deferred sync, offline visit start

## Context

VIZITUM is a multi-tenant field-visit SaaS: NestJS API at repo root (`src/`), Next.js App Router frontend in `apps/web` (Next 16, React 19), PostgreSQL via Prisma, S3-compatible storage (R2) for audio/photos. Read `CLAUDE.md` and `AGENTS.md` first, then `docs/reference/module-map.md`, `api-reference.md`, `data-model.md`.

Why this exists: field reps report that 2–3 of ~15 daily locations have no connectivity (pharmacy basements, malls, villages). Today that means they cannot start a visit, cannot record voice, cannot save a report — and a failed upload **loses the dictated audio outright**. Offline is a working condition, not a feature.

Current state (verified against code; re-verify, the branch may have moved):

- **Every field-zone page is a server component** with a hard dependency on the live API for first paint: `apps/web/app/[tenantSlug]/field/page.tsx` awaits four API calls; `field/visits/[visitId]/page.tsx` awaits five before the rep can type.
- **Visit start is a server action** (`startVisitAction` in `field/locations/[locationId]/page.tsx`) → `POST /visits` → server-generated visit id → server `redirect`. No retry, no queue. `Visit.routeItemId` has a `@@unique` constraint (`prisma/schema.prisma`), so a naive replay of a route-linked start collides.
- **Voice recording** lives in `apps/web/components/field-visit-report-form.tsx` (`"use client"`, MediaRecorder, 5-min cap). The blob exists only in an in-memory ref. Upload path: `registerFieldReportAudioAction` → `POST /visits/:id/notes/audio/register` (creates `StorageObject` purpose `temporary_audio`, `expiresAt` +24h, plus a `VisitNote` row) → presigned PUT direct to S3 → synchronous transcription/extraction (`POST /visits/:id/ai/field-report-transcriptions`, `src/modules/ai/ai.service.ts`). **Any failure discards the blob** (`setError` + back to form). The problem photo (`handlePhotoSelected`) is lost the same way.
- **Report confirm** is one-shot and non-idempotent: `confirmFieldReportAction` → `POST /visits/:id/reports/confirm` → `visits.service.ts` `confirmReport` locks the visit to `completed`. A retry after a timeout is unsafe. The confirm payload itself is small JSON (`fieldReport {...}` + extraction fields) — it queues fine; only audio/photo bytes are large.
- **All form state is React `useState`** — a reload, killed tab, or backgrounded phone loses the whole report. `ReportStatus.draft` / `VisitStatus.draft` exist in the schema but the field flow never writes them.
- **Zero client-side persistence anywhere in `apps/web`**: no localStorage/IndexedDB/service worker/PWA manifest (`apps/web/public/` is empty). All API fetches are `cache: "no-store"` with no timeout/retry.
- `apps/web/components/field-voice-note-recorder.tsx` is a dead second recorder implementation with no callers — delete it when touching this area.

## Target design (decided, do not re-litigate)

The goal is **not** a full offline-first rewrite. The field zone stays server-rendered where that works; we add a client-side durability layer ("nothing is ever lost") and a deferred-send outbox ("it arrives when the network does"). Three phases, each shippable on its own, in this order.

### Phase 1 — Nothing is ever lost (local draft persistence)

1. **IndexedDB draft store** in `apps/web/lib/` (new module, e.g. `offline-drafts.ts`). Hand-rolled thin wrapper or the tiny `idb` package — no heavy sync frameworks (no Replicache/WatermelonDB/RxDB). One DB per browser, records keyed by `{tenantSlug, userId, visitId}`. Store three record kinds: `formDraft` (the report form state JSON), `audioBlob` (the recorded Blob + mime + duration), `photoBlob`.
2. **Persist eagerly**: audio blob is written to IndexedDB the moment recording stops, *before* any upload attempt; form state is written on every change (debounced ~1s); photo on selection. Upload success does **not** delete the local audio until transcription has succeeded and the form is populated (or the rep dismisses it).
3. **Restore on open**: when `field-visit-report-form.tsx` mounts and a draft exists for this visit, hydrate the form from it and show a dismissible "draft restored" notice. If a stored audio blob was never successfully uploaded, show it with a replay control and a "retry upload & transcribe" button instead of silently dropping it.
4. **Failure UX**: on register/PUT/transcribe failure the error notice changes from "it failed" to "saved on this device — retry when you have signal", with an explicit retry button. Same for the photo.
5. **Cleanup**: delete the visit's records after successful report confirm; also run a sweep on field-home mount deleting records older than 14 days. On logout, clear all records for that tenant+user (shared-device hygiene; document the residual risk — IndexedDB is not encrypted at rest).
6. **Retry re-signs, it never re-registers** (corrected after reading the backend; the earlier draft of this plan had it backwards). `POST /visits/:id/notes/audio/register` is *not* idempotent: it creates a `StorageObject` **and** a `VisitNote` row per call, with no dedupe and no unique constraint, so retrying through it leaves one more of each on the visit every attempt — plus an R2 key the cleanup worker never sweeps, since it only collects `temporary_audio` whose status is `expired` and nothing in the field-report flow ever sets that. The problem-photo endpoint is no better: it expires its predecessors but still creates a new row, and confirming a report against a *stale* photo id resurrects a dead row pointing at bytes that are gone.

   The retry-safe path needs no backend change: `POST /storage/objects/:id/upload-url` re-signs the PUT for the object registration already created (a field rep passes `assertCanWriteStorageObject` for `temporary_audio`/`visit_attachment` they own). So: register once, keep the object id, and re-sign on every retry. The URL minted at registration cannot be replayed — it expires after 300 s.

   Two consequences to preserve: never put an object id into the persisted draft before its bytes are confirmed in storage (otherwise confirm can reference nothing), and check the server's size caps client-side at capture (audio 50 MB, photo 10 MB) so an oversized file fails once instead of on every retry.

### Phase 2 — Deferred report send (outbox)

1. **Outbox queue** in the same IndexedDB module: ordered records `{id, tenantSlug, userId, kind, payload, idempotencyKey, createdAt, attempts, lastError}`. First supported kind: `confirmReport`.
2. **Idempotent confirm (backend)**: add a client-supplied `clientRequestId` (UUID) to `POST /visits/:id/reports/confirm`. Store it on `Report` (nullable unique column, migration). Replay with the same id returns the existing report as success (200, not 409). A confirm for an already-completed visit with a *different* id keeps failing as today. Tenancy invariant as always: tenant from `RequestContext`, never from the payload.
3. **Submit path change**: the form's submit writes the confirm payload to the outbox first, then tries to flush immediately. Online happy path is unchanged from the rep's point of view (submit → success → redirect). If the flush fails with a network-level error (`status: 0` / fetch throw), the rep sees "report saved on device, will send automatically" and returns to the route screen; the visit shows a "pending send" badge. HTTP-level errors (validation, 4xx) are surfaced immediately as today — they will not succeed on retry.
4. **Flush triggers** (no Background Sync API — iOS Safari doesn't support it): on app/tab open, on `online` event, on field-home mount, and after each successful flush of a prior item. Sequential, oldest first; per-item backoff. A small client component in the field layout (`field/layout.tsx`) owns the flusher and renders a persistent "N unsent" indicator with a manual "send now".
5. **Audio follows the report**: if the rep confirmed manually while offline, the stored audio still uploads when online (register → PUT), attached to the visit as a `VisitNote` for the record. **No AI extraction runs post-confirm** — the confirmed report is immutable; transcription-into-form remains an online-only convenience. Manual confirm must remain a fully working path (hard product requirement, see CLAUDE.md).
6. **Session expiry during flush**: a 401 pauses the queue and surfaces "sign in to send N saved reports"; the queue survives re-login (records are keyed by tenant+user, and login lands back in the field zone).

### Phase 3 — Offline visit start + readable route

1. **Client-generated visit ids**: `POST /visits` accepts an optional client UUID (`clientVisitId`, stored as the row id or a unique column — decide against the existing id strategy in the schema) plus a client-supplied `startedAt`. New outbox kind `startVisit`. The visit detail route must render for a visit id that only exists locally: restructure `field/visits/[visitId]/page.tsx` so the form works from a local "pending visit" record (products list and voice hint come from the phase-3 cache below; assortment panel degrades to hidden when offline).
2. **`routeItemId` uniqueness**: on sync, a `startVisit` replay or a race with an online-started visit for the same route item must resolve deterministically — server returns the existing visit for that route item and the client re-keys its local records to it. Design this before coding; it is the trickiest correctness point.
3. **Today-route snapshot**: on every successful field-home render, a small client component snapshots the route + locations payload (already fetched by the server component — pass it down) into IndexedDB. A client fallback renders the snapshot with a "offline — data as of HH:MM" banner when the live render fails. Implementation constraint: the page stays a server component; the fallback is a client boundary that reads the snapshot. Getting the *page itself* to load offline needs a service worker that serves a cached app shell — add a minimal SW + `manifest.json` (installable PWA) that precaches the field-zone shell and falls back to it for field-zone navigations only. Keep the SW dumb: navigation fallback + static assets, **no** API response caching (the snapshot in IndexedDB is the data cache; two caching layers with different invalidation is how offline apps rot).
4. **Confirm-before-start visits stay out of scope**: cancel visit, tasks, announcements, assortment edits, location insights — all remain online-only. The offline surface is exactly: open app → see today's route → start visit → record/keep audio → fill form → confirm → everything syncs later.

## Non-goals (explicitly out of scope, list as follow-ups in the PR description)

- Full offline-first data layer / generic sync engine / conflict resolution beyond the `routeItemId` case.
- Offline support for manager/admin/operations zones, tasks, planning, assortment, insights, cancel-visit.
- Encrypting IndexedDB contents at rest.
- Push notifications, periodic background sync (unsupported on iOS anyway).
- Native app wrappers.

## Suggested execution order

Ship as a stacked series of small PRs, one phase boundary = one merged, releasable state:

1. **PR 1 (Phase 1a)**: IndexedDB module + form-draft persist/restore + cleanup + i18n strings. No backend changes.
2. **PR 2 (Phase 1b, part 1 — shipped)**: keep the recorded audio and the picked photo addressable after a failed upload, with a retry that re-signs the same storage object (see item 6 above), client-side size caps, and the recorder-lifecycle fixes that retry UI would otherwise widen (no unmount teardown → live microphone after navigating away; no `error` listener; a double-tap between `stop()` and its async `stop` event clearing the chunk array; a stuck `isRecording` disabling the manual form, which must always stay available). Deletes dead `field-voice-note-recorder.tsx` plus its orphaned `common.recorder` messages and CSS.
3. **PR 3 (Phase 1b, part 2)**: make those pending bytes survive a reload — a *separate* IndexedDB object store (`report-drafts` is cleared on sign-out and swept by age, and unsent work must not be), storing `ArrayBuffer` + mime rather than a `Blob` (WebKit can purge the file behind a stored Blob, which surfaces only at retry as a zero-length upload), resolving writes on `transaction.oncomplete` rather than request success, and a visible state when IndexedDB is unavailable (private browsing) instead of the silent no-op that is right for a convenience draft and wrong for a queue. Note iOS Safari evicts script-writable storage after 7 days without a Home Screen install — the UI must not promise more retention than that.
4. **PR 4 (Phase 2 backend)**: `clientRequestId` on confirm — migration, service logic, tests. Update `docs/reference/api-reference.md` + `data-model.md` in the same change (hard convention).
5. **PR 5 (Phase 2 frontend)**: outbox + flusher + pending-send UI + deferred audio attach.
6. **PR 6 (Phase 3 backend)**: client visit id + `startedAt` + route-item conflict resolution, tests first.
7. **PR 7 (Phase 3 frontend)**: `startVisit` outbox kind + locally-pending visit screen.
8. **PR 8 (Phase 3 shell)**: route snapshot + offline fallback render + minimal SW/manifest.

## Verification

- Backend: new `tests/*.test.ts` per behavior (idempotent confirm replay, second-register dedupe, client visit id, route-item conflict resolution) — plain node runner, services instantiated directly. Existing tests stay green (`npm run test`).
- Frontend: `npm run web:typecheck`, `npm run web:build`, `npm run web:i18n:check` after every PR. Every new user-visible string (notices, badges, retry buttons, banner) goes through `apps/web/messages/{en,uk}.json` with real Ukrainian translations.
- E2E: Playwright (`npm run web:e2e`) can simulate offline via `context.setOffline(true)`. Add e2e specs for the two money paths: (a) record → kill upload (offline) → reload → draft+audio restored → go online → retry succeeds; (b) fill form → confirm offline → report queued → go online → auto-flush → report visible in history exactly once.
- Manual walk on a real phone (iOS Safari specifically) with airplane mode: the flush-on-open path, IndexedDB eviction behavior, and MediaRecorder mime fallback are exactly the things emulation lies about.
- Idempotency spot-check: flush the same outbox item twice against a live server; exactly one `Report` row.

## Rough sizing

- Phase 1: small-to-medium — a few days; one new lib module + surgery inside `field-visit-report-form.tsx` (which is already 1.2k lines; extract the persistence hooks rather than growing it).
- Phase 2: medium — backend idempotency is a day with tests; the outbox/flusher/UI is a few days.
- Phase 3: the big one — client visit ids and the conflict rule touch core visit invariants; the SW/shell work is fiddly to verify. Budget a week-plus and do it last; phases 1–2 already remove the data-loss pain that motivated all of this.

## Working notes

- Trust the code over this snapshot; file line numbers above will drift.
- The manual report-confirmation flow must remain fully functional at every intermediate state — hard product requirement (CLAUDE.md).
- All new inputs get `maxLength` from `INPUT_LIMITS` (`apps/web/lib/input-limits.ts`); back-navigation follows the `BackLink`/`backOrigin` conventions if any new screen appears.
- Tenancy invariant everywhere: tenant id from `RequestContext`, never from client payloads — including every new endpoint parameter added here.
- Don't let the SW cache API responses or non-field pages; keep its scope narrow so the rest of the app keeps today's behavior exactly.
- Server actions cannot run offline by definition — every code path that must work offline has to live in client components calling `fetch` against the API (or queueing), not in `"use server"` actions. Audit each touched flow for this; it is the most common way this refactor silently fails.
