# Task: Offline resilience for the field zone — local drafts, deferred sync, offline visit start

## Status (updated after phases 1–2, phase 3, both cancel-visit gap fixes, and the outbox phantom-replay fix)

**Done and merged into `main`**: nothing a rep produces offline is lost, a
confirmed report or a started visit is safe to retry — including, now, a
queued start whose adopt outcome the server has already answered but whose
local rekey hasn't landed yet — cancelling a visit no longer strands whatever
was queued for it, and a visit can now be started with no signal at all,
worked on before it ever syncs, and cancelled again without ever having
reached the server. That is phases 1, 2 and 3 in full, plus both cancel-visit
gap fixes and the outbox phantom-replay fix. See "What's already built" below
for the exact file map — read it before touching anything, several of the
plans in the sections further down are now **stale** (kept for historical
context, not as instructions).

**Not done**: the cached-route-shell/service-worker piece that would let the
field zone's *pages themselves* load with zero connectivity, not just the
data on them. See "What's next" below.

**Known gaps, not yet fixed** — read these before starting new work, in the
order a next session should pick them up:

1. **Real-phone verification has never been done.** Every PR in this series
   was verified against the real API/DB from a desktop browser (no
   microphone), plus unit tests and, since the cancel-visit fix, one
   Playwright spec per gap closed that way. Nobody has run the audio-capture
   path, the IndexedDB 7-day eviction, a cold-start outbox flush, or starting
   a visit in airplane mode on an actual iOS Safari. Do this before calling
   the offline story release-ready — iOS is exactly where the emulated
   checks lie.
2. **A rep who stays on the "still syncing" screen while the adopt case
   resolves can leave a harmless orphaned draft behind.** Confirmed once by
   hand while verifying the adopt case (see the "Also fixed"/"Phase 3"
   entries below): `visit-start-outbox-flush.ts`'s rekey moves the draft to
   the resolved visit's real id, but `pending-visit-report.tsx` keeps the
   report form mounted on the *old* id for as long as the rep stays on that
   screen, and that form's own debounced write (`use-field-report-persistence.ts`)
   has no way to know the id it is writing under was just rekeyed out from
   under it. The 15s poll added after finding this bounds the window — it
   did not exist when the duplicate was first observed — but does not
   structurally close it: one more keystroke landing in that window still
   resurrects the old-key draft moments after the rekey moved it. No data
   loss either way — the rekeyed copy under the real id is what the rep
   actually sees once the redirect fires — just an inert, orphaned duplicate
   under an id nothing will ever navigate to again, swept after 14 days like
   any other stale draft. Properly closing it needs the mounted form to
   learn its underlying visit id changed mid-flight, which today's
   props-down, one-way data flow into `FieldVisitReportForm` doesn't
   support; not attempted here as disproportionate to a self-healing,
   no-data-loss quirk — noted for whoever next touches this path. The
   abandon flow added since has a smaller sibling of exactly this shape,
   documented in `abandon-visit-start.ts` and for the same structural
   reason: cancelling a never-synced visit *from the report screen* deletes
   the draft, and that screen's own unmount flush can write one final copy
   back under an id nothing will ever navigate to again. Same non-
   consequence, same 14-day sweep; only reachable if the rep typed something
   before cancelling, since an empty draft is not written back at all.
3. **An outbox entry left unresolved can still misfire on retry if the world
   changed underneath it while it waited.** One narrow variant, found by
   review rather than by hitting it: a queued start that gets a genuine
   *rejection* (not just queued) after a confirm has already been queued
   against it would leave that confirm stuck — it needs a real 400 on the
   start itself, which a UUID `clientVisitId` and a same-cycle `startedAt`
   make very hard to hit in practice. Flagged in case a real-phone pass
   (item 1) proves otherwise; not attempted here as disproportionate to how
   narrow the window is. (Its sibling variant — a phantom replay after an
   unresolved adopt minting a second, unwanted visit — was closed; see
   "Also fixed" below.)

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

**Phase 3 — offline visit start** (backend in PR #147, frontend this session):
- `Visit.clientVisitId` (nullable, `@@unique([tenantId, clientVisitId])`) — a device-minted id that makes `POST /visits` safe to retry and doubles as a resolvable id (every visit lookup matches either `id` or `clientVisitId`, so a URL built offline keeps working after sync).
- The route-slot conflict rule in `VisitsService.createVisit`/`resolveRouteItemLink`: `Visit.routeItemId` is unique across every status, so a deferred start can arrive to find the stop's slot already taken. Four cases handled: replay of the same client id → return that visit; the rep's own still-open visit on that stop → adopt it (the response comes back under that visit's own id — the client-minted id is never written anywhere); a `completed`/`cancelled` visit on that stop → create a new, unlinked visit (adopting would attach a report to a closed visit); another rep's open visit → same, unlinked (never adopt a colleague's visit).
- `startedAt` is bounded (7 days back, 1 hour of clock-skew slack ahead) rather than trusted verbatim.
- Frontend: `apps/web/components/start-visit-control.tsx` replaced the plain `<form action={startVisitAction}>` — mints the client id, queues the create (`apps/web/lib/visit-start-outbox.ts`, a fourth IndexedDB store), attempts it eagerly, and navigates to the server's real id if that resolves now or the client id if it has to queue (self-healing forever after via the dual-id lookup above, for three of the four backend outcomes). `apps/web/app/[tenantSlug]/field/visits/[visitId]/page.tsx` renders `apps/web/components/pending-visit-report.tsx` instead of a flat "not found" when the server does not know the id yet — real products and the voice hint fetched fresh (tenant-scoped, neither needs the visit to exist), the shelf-check matrix stays empty until the route-snapshot piece below exists. `apps/web/lib/visit-start-outbox-flush.ts` resolves a queued start by rekeying the draft, pending media and any already-queued confirm from the client id to the real one — load-bearing specifically for the adopt outcome, which is why `visit-start-outbox.ts`'s entries are never deleted on success, only marked resolved (`module-map.md` has the full reasoning and the file map). The location card also checks that same queue before offering "Start visit" again, so backing out and re-tapping while still offline can't mint a second id for an unlinked visit (the route-linked case self-corrects server-side either way, via the same adopt rule) — the "Start visit" button stays disabled for the brief window before that local check itself resolves, so a rapid double-tap can't slip through before the check has an answer. An eager attempt that succeeds immediately also marks its own outbox entry resolved on the spot rather than leaving that to the next background flush (found by review: without this, a rep who starts online, finishes the whole visit and returns to the same location card without a hard reload — so the layout never remounts to flush anything — could see "Continue visit, still syncing" for a visit that has been done for a while).

**Separately, a real production bug** (PR #148, unrelated to the offline effort but found while investigating it): `temporary_audio`/`temporary_transcript` storage objects were never actually deleted from R2 by any code path — the cleanup sweep required `status: "expired"`, which the field-report flow never set, and the two writers that did set it also stamped `deletedAt` in the same update, which excluded them from the sweep's own filter. Fixed: one rule for all three temporary purposes (past `expiresAt`, `deletedAt: null`, any status), and `deletedAt` now means exactly one thing — the sweep actually deleted the bytes.

**Also fixed: cancelling a visit no longer strands unsent work** (closes known gap #1 from the previous version of this doc): `CancelVisitModal` now checks, each time it opens, whether the visit has pending media or a queued outbox entry, and shows an inline notice naming which before the rep commits — a report already confirmed offline outranks a bare recording/photo in that notice, since losing a finished report costs more. On submit it awaits deleting the visit's pending media (both kinds) and its outbox entry before the cancel request goes out — same shape as `field-menu.tsx`'s sign-out handler, and for the same reason: firing it and not waiting loses the race with the redirect. Deliberately does **not** touch the draft (what the rep typed but never confirmed): the report form mounted beside the modal owns it through its own hook, which rewrites the draft on its own unmount regardless of what deleted it in the meantime, so deleting it from the modal would just lose that race and resurrect it (see `use-field-report-persistence.ts`'s entry in `module-map.md`). New in `offline-drafts.ts` / `report-outbox.ts`: `hasPendingMediaBytes`, `hasReportOutboxEntryForVisit`, `deleteReportOutboxEntryForVisit` — `module-map.md` has the detail. Verified two ways: `apps/web/e2e/field-cancel-visit.spec.ts` (Playwright, own seeded tenant, PUT aborted the same way `field-pending-media.spec.ts` does) covers the pending-photo case end to end; the queued-outbox case doesn't script reliably the same way — the outbox's own auto-flush is eager enough that reaching "confirmed offline, not yet flushed, visit still open" needs request interception on a Next.js Server Action's own fetch, which nothing in this repo's E2E harness does yet — so that case was checked by hand against the demo tenant instead: a real outbox record seeded directly into IndexedDB for an open visit, then cancelled, confirming both the notice and the delete.

**Also fixed: a visit started with no signal can be cancelled again before it ever syncs** (closes what was known gap #2 in the previous version of this doc): `apps/web/components/abandon-visit-start-control.tsx` renders wherever that visit can be reached — the location card's "continue, still syncing" state and the pending report screen itself, matching where `CancelVisitModal` sits for a real visit. Without it that state was a one-way door: the rep could only navigate away, and the queued start synced into a real `in_progress` visit nobody ever confirmed or cancelled. Deliberately not a variant of `CancelVisitModal` — there is no visit on the server to cancel, so nothing is sent, no reason is collected, and the whole operation is `apps/web/lib/abandon-visit-start.ts` deleting the queue entry plus the draft, both pending-media kinds and any queued confirm under that `clientVisitId`. The queue entry goes first and alone: it is the only one of them that can still become a visit on the server, so a device that stops answering halfway through has already done the half that mattered. The one thing making this more than a delete is that the background flush can resolve the very start being cancelled between the render that offered the control and the tap that takes it — so the entry is re-read rather than trusted, and a start that synced in the meantime hands the rep to the real visit instead of deleting a real visit's work (`decideAbandonVisitStart`, pure, pinned by `tests/web-abandon-visit-start.test.ts`). The narrower window, a create already in flight when the delete lands, needs no tombstone: `resolveVisitStart` only ever patches an existing record, finds nothing to write back, and the visit the server did create reappears on the location card as an ordinary "Continue visit", cancellable the normal way. Two new tests in `apps/web/e2e/field-offline-visit-start.spec.ts` cover both entry points end to end, reading the stores directly the way `field-cancel-visit.spec.ts` does — a delete has no screen that would show its absence.

**And a pre-existing layout bug found by putting that control on the report screen**, fixed in the same change because the new affordance inherits it: `.capture-manual-bar` ("Fill in manually") is `position: fixed` on the reasoning, in its own comment, that "the capture screen is short and never scrolls". True of the step, not of the page — anything rendered *below* the report form ends up behind that bar on a phone, at partial scroll and at full scroll alike. That already applied to the real visit page's own "Cancel visit" control, which was therefore untappable on the capture step of every in-progress visit; confirmed by hit-testing both screens at max scroll in a 375px viewport, before and after. Fixed by reserving the bar's height (`--capture-manual-bar-height`) under `.visit-cancel-action`, scoped with `:has()` so the other steps — where the bar is gone and a sticky save bar takes its place — do not grow an empty strip.

**Also fixed: an outbox entry the server has already answered is never replayed into a duplicate visit** (closes the "phantom replay after an unresolved adopt" variant of what was known gap #3 in the previous version of this doc): `VisitStartOutboxEntry` gained `remoteVisitId`, recorded by `apps/web/lib/visit-start-outbox.ts`'s new `recordVisitStartOutboxRemoteVisitId` the moment `createVisit` first answers — durably, and before any local rekey is attempted, so even a crash mid-rekey leaves the next flush cycle already knowing the server has answered. `apps/web/lib/visit-start-outbox-flush.ts`'s `flushVisitStartOutbox` now decides what to do with each entry through a small pure function, `decideVisitStartFlushAction` (pinned by `tests/web-visit-start-outbox-flush.test.ts`): an entry with `remoteVisitId` set retries only the local rekey and never calls `createVisit` again, no matter how many cycles the rekey keeps failing. That was the whole bug — re-sending `createVisit` is free for a plain create (the backend's own `clientVisitId` lookup returns the identical row) but not for an adopt outcome, which never stores `clientVisitId` anywhere (see "What's already built" above): a second send re-derived the route slot's state fresh, and finding the adopted visit closed in the meantime minted a new, unwanted, unlinked visit instead of recognizing the one already adopted. `apps/web/lib/abandon-visit-start.ts`'s `decideAbandonVisitStart` was updated in the same change to treat `remoteVisitId` the same as `resolvedVisitId` — without that, the new field would have turned a transient in-flight race abandon already tolerated into a durable one, since a real visit can now be known to exist across app restarts even before its rekey finishes. No schema or backend change; entirely within `apps/web/lib`, verified by `npm run web:typecheck`, `format:check` and the two updated/new unit test files — reaching "server already answered, rekey specifically failed" from outside needs IndexedDB failure injection mid-transaction, which nothing in this repo's E2E harness does, so this is checked at the pure-logic layer the same way `decideAbandonVisitStart` and `classifyReportSendResult` already are, rather than end-to-end.

## What's next

In priority order:

1. **Real-phone pass** (known gap #1 above) — do this before anything else on this list. It may surface problems in the already-shipped stores that are cheaper to fix now than after building more on top of them. It is also the only remaining item on this list that a coding session cannot do on its own: everything else here has been buildable and verifiable from a desktop browser against the real API, and this one needs an actual iOS device in an actual dead zone.
2. **Route snapshot + minimal service worker** — the one piece left that starts touching infrastructure (a `manifest.json`, an SW scope) rather than just a screen's data flow. See "Target design" below for the shape. Don't start this until 1 is done; a real-device pass may change what it needs to account for, and it depends on the visit screen's offline story already being complete — which, as of the abandon fix, it now is.

## Target design (original plan — much of phases 1–3 shipped differently than described here; treat as historical context, not instructions)

The goal is **not** a full offline-first rewrite. The field zone stays server-rendered where that works; we add a client-side durability layer ("nothing is ever lost") and a deferred-send outbox ("it arrives when the network does").

### Route snapshot + service worker (the part still open)

Phase 3's own two target-design items — client-generated visit ids, and the
visit detail route rendering for a client-only-known visit — shipped this
session, differently in places than the notes below once described (see
"What's already built" for the real shape: the id is never rekeyed eagerly,
only inside the background flush, and the adopt outcome specifically needed
the outbox entry to survive success rather than being deleted). What's left:

1. **Today-route snapshot**: on every successful field-home render, snapshot the route + locations payload into IndexedDB (a fifth store, or reuse `field-db.ts`'s pattern). A client fallback renders the snapshot with an "offline — data as of HH:MM" banner when the live render fails. This is also what would finally give `pending-visit-report.tsx`'s fallback a populated shelf-check matrix instead of an empty one.
2. **Getting the page itself to load offline** needs a service worker serving a cached app shell — a minimal SW + `manifest.json` that precaches the field-zone shell and falls back to it for field-zone navigations only, with **no** API response caching (the IndexedDB snapshot is the data cache; two caching layers with different invalidation is how offline apps rot).
3. **Confirm-before-start visits stay out of scope**: tasks, announcements, assortment edits, location insights — all remain online-only. The offline surface is exactly: open app → see today's route (from snapshot if offline) → start visit → record/keep audio → fill form → confirm → everything syncs later.

## Non-goals (still true)

- Full offline-first data layer / generic sync engine / conflict resolution beyond the `routeItemId` case.
- Offline support for manager/admin/operations zones, tasks, planning, assortment, insights, cancel-visit (cancelling a real, server-known visit stays online-only — no queue for the cancel request itself; only its interaction with already-queued work needed fixing, see "What's already built". Cancelling a visit that only exists as a queued local start is a different, purely-local operation with no server request to make offline in the first place — shipped, see "Also fixed" above, and never a case this non-goal covered).
- Encrypting IndexedDB contents at rest (accepted risk, documented in `module-map.md`).
- Push notifications, periodic background sync (unsupported on iOS anyway).
- Native app wrappers.

## Verification conventions established so far (follow these for the route snapshot too)

- Every PR verified against the real NestJS API + Postgres via a browser preview, not just unit tests — a local S3-mock stand-in was used for storage-dependent flows (the worktree's R2 credentials are placeholders). Idempotency was proven by hand-seeding a duplicate outbox/confirm attempt and checking the database directly, not just asserting on a stub.
- Backend: plain `node --test` files instantiating services directly with stubbed Prisma (see `tests/report-confirm-idempotency.test.ts`, `tests/offline-visit-start.test.ts` for the current shape).
- Frontend: `npm run web:typecheck`, `web:build`, `web:i18n:check`, `format:check` after every change. Every new user-visible string goes through `apps/web/messages/{en,uk}.json` with a real Ukrainian translation, not a stub.
- E2E: `apps/web/e2e/field-pending-media.spec.ts` is the pattern to extend — it aborts every PUT so the same assertions hold whether the environment has S3 configured or not (CI has none), and it owns a dedicated seeded tenant because two specs starting visits on the same seeded stop collide on `Visit.routeItemId`'s uniqueness. `field-cancel-visit.spec.ts` follows the same shape for the cancel fix, plus reads the on-device store directly (`page.evaluate` against `indexedDB`) for the one thing the UI itself can't show: that a cancelled visit's pending media is actually gone, not just that cancelling "succeeded" — the locked/read-only page a cancelled visit renders never mounts anything that would surface a leftover record either way. `field-offline-visit-start.spec.ts` follows it again for the start fix, aborting every POST carrying a `Next-Action` header instead of PUT — the real shape a Server Action invocation takes with no network, so the eager attempt in `start-visit-control.tsx` throws for real rather than being stubbed. All three specs share the same remaining gap: a scenario that needs controlling a specific network *response's content*, not just whether one arrives at all, doesn't script reliably here yet — the queued-confirm-cancel race, and for the start fix both the visit actually resolving and the adopt case specifically — and gets checked by hand against the demo tenant instead.
- Migrations: generate and verify against a **throwaway** database, never the shared dev one (`docker exec -i vizitum-postgres psql -U postgres -c "CREATE DATABASE vizitum_scratch"`, apply, `prisma migrate status` to confirm no drift, drop it after). Render does not run migrations on deploy — every migration in this series needs manual application in production before its code ships. The series' migrations, in order, so nothing has to be reconstructed from the log: `20260730000000_report_client_request_id` (#144), `20260730120000_visit_client_visit_id` (#147), `20260730130000_storage_temporary_deletedat_backfill` (#153 — the one that is *not* a schema change but a data repair; it is what finally lets the cleanup sweep collect the R2 bytes the pre-#148 writers tombstoned, so shipping #148's code without it fixes only new rows and leaves every old one orphaned).
- Docs: `docs/reference/api-reference.md`, `data-model.md`, `module-map.md`, `executable-spec.md` updated in the same PR as the code — hard project convention, checked by nothing automated, so it's easy to skip by accident.

## Working notes

- **`docs/` is not in the project's Prettier scope** (`format:check`'s globs are `src/**` and `apps/web/**` only). Never run `prettier --write` on a file under `docs/` — it will reformat whole Markdown tables and turn a one-line content diff into hundreds of lines of noise. This has happened twice in this series; if you need to edit a table in these docs, edit it by hand or with a script that touches only the target cell/row.
- The manual report-confirmation flow must remain fully functional at every intermediate state — hard product requirement (CLAUDE.md).
- All new inputs get `maxLength` from `INPUT_LIMITS` (`apps/web/lib/input-limits.ts`); back-navigation follows the `BackLink`/`backOrigin` conventions if any new screen appears.
- Tenancy invariant everywhere: tenant id from `RequestContext`, never from client payloads — including every endpoint touched here.
- A `"use server"` action is fine to call from an offline-capable client component — invoking one is still a real network hop (browser to the Next.js server), and it throws exactly like any other fetch when there is no network, which every queue in this system already treats as the ordinary offline signal (confirmed by building phase 3's start-visit-control.tsx the same way field-report-actions.ts's confirm path already worked). What can't live in a server action is the IndexedDB access and the enqueue/classify logic itself — a server action never sees the browser's storage — so *that* has to live in the client component calling the action, not inside it. `api-client.ts` is also structurally server-only (`cookies()`/`headers()`), so there is no other path to the backend at all; every new offline-capable call needs its own thin `"use server"` wrapper, same as `field-report-actions.ts`/`visit-start-actions.ts` already do.
- Worktree hygiene: confirm the branch you land on is actually free (per `CLAUDE.md`'s "Worktree slots" section) before starting — several sessions have worked this repo in parallel, and a stale branch name is not a guarantee the worktree is idle.
