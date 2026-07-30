# Task: Offline resilience for the field zone — local drafts, deferred sync, offline visit start

## Status (updated after phases 1–2 and phase 3 backend shipped)

**Done and merged into `main`**: nothing a rep produces offline is lost, and a
confirmed report or a started visit is safe to retry. That is phases 1 and 2 in
full, plus phase 3's backend half. See "What's already built" below for the
exact file map — read that before touching anything, several of the plans in
the sections further down are now **stale** (kept for historical context, not
as instructions).

**Not done**: phase 3's frontend half (a visit screen that renders for a
visit only the device knows about, and a `startVisit` outbox kind) and the
cached-route-shell/service-worker piece. See "What's next" below.

**Two known gaps, not yet fixed** — read these before starting new work, they
are the most likely place a next session should look first:

1. **Cancelling a visit strands unsent work.** `handleSubmit`'s confirm path
   deletes both pending-media kinds and the draft on success, but the cancel
   path (`CancelVisitModal` → `cancelVisitAction` →
   `VisitsService.cancelVisit`) deletes none of them. Worse, since the outbox
   shipped (#145): a rep can confirm a report offline (queued), then cancel
   the same visit before the queue flushes; the flush then hits `confirmReport`'s
   409 `VISIT_NOT_ACTIVE` guard, the outbox marks the entry `rejectedAt` and
   stops auto-retrying it, and the banner tells the rep to "open the visit and
   save it again" — but the visit is cancelled and locked, so the form never
   renders and that instruction cannot be followed. The entry is stuck in the
   unsent count forever. A task chip for this exists in this session
   (title: "Fix: cancelling a visit breaks unsent work") — check whether it is
   still open before re-describing it from scratch.
2. **Real-phone verification has never been done.** Every PR in this series
   was verified against the real API/DB from a desktop browser (no
   microphone), plus unit tests. Nobody has run the audio-capture path, the
   IndexedDB 7-day eviction, or a cold-start outbox flush on an actual iOS
   Safari with airplane mode. Do this before calling the offline story
   release-ready — iOS is exactly where the emulated checks lie.

## Context

VIZITUM is a multi-tenant field-visit SaaS: NestJS API at repo root (`src/`), Next.js App Router frontend in `apps/web` (Next 16, React 19), PostgreSQL via Prisma, S3-compatible storage (R2) for audio/photos. Read `CLAUDE.md` and `AGENTS.md` first, then `docs/reference/module-map.md`, `api-reference.md`, `data-model.md`.

Why this exists: field reps report that 2–3 of ~15 daily locations have no connectivity (pharmacy basements, malls, villages). Today that means they cannot start a visit, cannot record voice, cannot save a report — and a failed upload **loses the dictated audio outright**. Offline is a working condition, not a feature.

## What's already built

Everything below is real, merged, and documented in `docs/reference/module-map.md` — re-read that file for the current, authoritative description of each module rather than trusting the historical design notes further down this document, which describe intent at the time and have since drifted from the shipped shape in several places (the store layout, the retry rule, and the persistence hooks all ended up different from the original plan).

**Phase 1 — nothing is lost** (PRs #140, #141, #143, plus hardening in #146):
- Three IndexedDB stores behind one shared connection module, `apps/web/lib/field-db.ts`: `report-drafts` (typed form state, cleared on sign-out, swept after 14 days), `pending-media` (recorded/photographed bytes, survives sign-out, swept after 7 days — matches iOS Safari's storage eviction window), `report-outbox` (queued confirms, survives sign-out, never swept).
- Persistence logic lives in `apps/web/lib/use-field-report-persistence.ts` (`useFieldReportDraft`, `usePendingCaptures`) — extracted from `field-visit-report-form.tsx` once that file passed 1,800 lines. `apps/web/lib/offline-drafts.ts` is the storage layer underneath it; `apps/web/lib/field-report-draft.ts` is the pure, browser-free draft shape/validation.
- Retry rule: `apps/web/lib/storage-retry.ts`'s `isStorageObjectGone` — a retry re-signs the same storage object rather than re-registering, and only a real ruling about the object (a `STORAGE_OBJECT_*` code or bare 404) is read as "actually gone." No answer at all (the dead-zone case) must not be read that way, or a flaky connection leaves duplicate storage objects — and, for audio, duplicate `VisitNote` rows — on the visit.
- `field-voice-note-recorder.tsx` (the dead second recorder) is deleted.

**Phase 2 — deferred send** (PRs #144, #145):
- `Report.clientRequestId` (nullable, `@@unique([tenantId, clientRequestId])`) makes `POST /visits/:visitId/reports/confirm` safe to retry: a replay returns the first attempt's report untouched, a token reused on a different visit is a 409, a race between two flushes resolves to the winner's report.
- `apps/web/lib/report-outbox.ts` + `report-outbox-flush.ts` + `report-send-outcome.ts`: the client-side queue, its flush loop, and the pure classification of what a failed send means (queue vs. surface-now vs. ask-to-sign-in). Flushed from `apps/web/components/report-outbox-indicator.tsx`, mounted in `apps/web/app/[tenantSlug]/field/layout.tsx` so one sender persists across field-zone navigation. No Background Sync — iOS Safari doesn't have it — so flush triggers are app-open, tab-visible, the `online` event, and a manual "send now".

**Phase 3, backend half only** (PR #147):
- `Visit.clientVisitId` (nullable, `@@unique([tenantId, clientVisitId])`) — a device-minted id that makes `POST /visits` safe to retry and doubles as a resolvable id (every visit lookup matches either `id` or `clientVisitId`, so a URL built offline keeps working after sync).
- The route-slot conflict rule in `VisitsService.createVisit`/`resolveRouteItemLink`: `Visit.routeItemId` is unique across every status, so a deferred start can arrive to find the stop's slot already taken. Four cases handled: replay of the same client id → return that visit; the rep's own still-open visit on that stop → adopt it (re-key onto it); a `completed`/`cancelled` visit on that stop → create a new, unlinked visit (adopting would attach a report to a closed visit); another rep's open visit → same, unlinked (never adopt a colleague's visit).
- `startedAt` is bounded (7 days back, 1 hour of clock-skew slack ahead) rather than trusted verbatim.
- **Not yet built**: the frontend that would actually use any of this. `field/locations/[locationId]/page.tsx`'s `startVisitAction` still does a plain server-action `POST /visits` with no client id, no queue, and no offline path. See "What's next."

**Separately, a real production bug** (PR #148, unrelated to the offline effort but found while investigating it): `temporary_audio`/`temporary_transcript` storage objects were never actually deleted from R2 by any code path — the cleanup sweep required `status: "expired"`, which the field-report flow never set, and the two writers that did set it also stamped `deletedAt` in the same update, which excluded them from the sweep's own filter. Fixed: one rule for all three temporary purposes (past `expiresAt`, `deletedAt: null`, any status), and `deletedAt` now means exactly one thing — the sweep actually deleted the bytes.

## What's next

In priority order:

1. **Fix the cancel-visit gap** (see "known gaps" above). Small, self-contained, no design decisions left — the pattern to follow is already in the codebase: `apps/web/components/field-menu.tsx`'s sign-out handler awaits `clearDrafts()` *before* submitting, specifically because firing it and not waiting loses the race with navigation. The cancel action needs the same shape: await deleting this visit's pending media and outbox entry before the cancel request goes out. Decide too whether cancelling a visit that has unsent work queued should warn the rep first, naming what gets discarded — that's a product judgment call, not just a bug fix.
2. **Real-phone pass** (see "known gaps" above) — do this before phase 3 frontend, not after. It may surface problems in the already-shipped stores that are cheaper to fix now than after building more on top of them.
3. **Phase 3 frontend**: give `startVisitAction` a client-generated `clientVisitId`, queue the start the same way a confirm is queued (new outbox kind or a parallel queue — decide based on how much `report-outbox.ts` can actually share), and make `field/visits/[visitId]/page.tsx` render for a visit that exists only locally (server component today; needs a client-rendered fallback path, same shape as the pending-media/draft restore already does for the report form itself).
4. **Route snapshot + minimal service worker** — lowest priority, the one piece that starts touching infrastructure (a `manifest.json`, an SW scope) rather than just this one screen's data flow. Don't start this until 1–3 are done; it depends on the visit screen already working offline.

## Target design (original plan — much of Phase 1–2 shipped differently than described here; treat as historical context, not instructions)

The goal is **not** a full offline-first rewrite. The field zone stays server-rendered where that works; we add a client-side durability layer ("nothing is ever lost") and a deferred-send outbox ("it arrives when the network does").

### Phase 3 — Offline visit start + readable route (the part still open)

1. **Client-generated visit ids**: done on the backend (`Visit.clientVisitId`, see above). Frontend still needs: mint the id in `startVisitAction`, queue the create the same way a confirm is queued, and handle the response (existing visit returned on replay/adopt, or a freshly created one).
2. **The visit detail route must render for a visit id that only exists locally**: restructure `field/visits/[visitId]/page.tsx` so the form can work from a local "pending visit" record when the server hasn't seen it yet (products list and voice hint would need a route-level cache; assortment panel degrades to hidden when offline). This is the biggest remaining design gap — nothing has decided yet how a server component route shows a client-only-known visit.
3. **Today-route snapshot**: on every successful field-home render, snapshot the route + locations payload into IndexedDB (a fourth store, or reuse `field-db.ts`'s pattern). A client fallback renders the snapshot with an "offline — data as of HH:MM" banner when the live render fails. Getting the *page itself* to load offline needs a service worker serving a cached app shell — a minimal SW + `manifest.json` that precaches the field-zone shell and falls back to it for field-zone navigations only, with **no** API response caching (the IndexedDB snapshot is the data cache; two caching layers with different invalidation is how offline apps rot).
4. **Confirm-before-start visits stay out of scope**: tasks, announcements, assortment edits, location insights — all remain online-only. The offline surface is exactly: open app → see today's route (from snapshot if offline) → start visit → record/keep audio → fill form → confirm → everything syncs later.

## Non-goals (still true)

- Full offline-first data layer / generic sync engine / conflict resolution beyond the `routeItemId` case.
- Offline support for manager/admin/operations zones, tasks, planning, assortment, insights, cancel-visit (cancel-visit itself stays online-only; only its interaction with already-queued work needs fixing, see gap #1 above).
- Encrypting IndexedDB contents at rest (accepted risk, documented in `module-map.md`).
- Push notifications, periodic background sync (unsupported on iOS anyway).
- Native app wrappers.

## Verification conventions established so far (follow these for phase 3 frontend too)

- Every PR verified against the real NestJS API + Postgres via a browser preview, not just unit tests — a local S3-mock stand-in was used for storage-dependent flows (the worktree's R2 credentials are placeholders). Idempotency was proven by hand-seeding a duplicate outbox/confirm attempt and checking the database directly, not just asserting on a stub.
- Backend: plain `node --test` files instantiating services directly with stubbed Prisma (see `tests/report-confirm-idempotency.test.ts`, `tests/offline-visit-start.test.ts` for the current shape).
- Frontend: `npm run web:typecheck`, `web:build`, `web:i18n:check`, `format:check` after every change. Every new user-visible string goes through `apps/web/messages/{en,uk}.json` with a real Ukrainian translation, not a stub.
- E2E: `apps/web/e2e/field-pending-media.spec.ts` is the pattern to extend — it aborts every PUT so the same assertions hold whether the environment has S3 configured or not (CI has none), and it owns a dedicated seeded tenant because two specs starting visits on the same seeded stop collide on `Visit.routeItemId`'s uniqueness.
- Migrations: generate and verify against a **throwaway** database, never the shared dev one (`docker exec -i vizitum-postgres psql -U postgres -c "CREATE DATABASE vizitum_scratch"`, apply, `prisma migrate status` to confirm no drift, drop it after). Render does not run migrations on deploy — every migration in this series needs manual application in production before its code ships.
- Docs: `docs/reference/api-reference.md`, `data-model.md`, `module-map.md`, `executable-spec.md` updated in the same PR as the code — hard project convention, checked by nothing automated, so it's easy to skip by accident.

## Working notes

- **`docs/` is not in the project's Prettier scope** (`format:check`'s globs are `src/**` and `apps/web/**` only). Never run `prettier --write` on a file under `docs/` — it will reformat whole Markdown tables and turn a one-line content diff into hundreds of lines of noise. This has happened twice in this series; if you need to edit a table in these docs, edit it by hand or with a script that touches only the target cell/row.
- The manual report-confirmation flow must remain fully functional at every intermediate state — hard product requirement (CLAUDE.md).
- All new inputs get `maxLength` from `INPUT_LIMITS` (`apps/web/lib/input-limits.ts`); back-navigation follows the `BackLink`/`backOrigin` conventions if any new screen appears.
- Tenancy invariant everywhere: tenant id from `RequestContext`, never from client payloads — including every endpoint touched here.
- Server actions cannot run offline by definition — every code path that must work offline has to live in client components calling `fetch` against the API (or queueing), not in `"use server"` actions.
- Worktree hygiene: confirm the branch you land on is actually free (per `CLAUDE.md`'s "Worktree slots" section) before starting — several sessions have worked this repo in parallel, and a stale branch name is not a guarantee the worktree is idle.
