# Field Offline Real-Phone Test (iOS Safari)

Step-by-step pass for the one item the offline effort cannot close from a
coding session: running the whole offline story on a real iPhone. It closes
the unchecked line in `docs/vizitum-action-plan.md` ("Verify the whole story
on a real phone (iOS Safari, airplane mode)") and known gap #1 in
`docs/plans/offline-field-drafts-plan-prompt.md`. Everything under test was
verified from a desktop browser, unit tests and Playwright already — iOS is
where the emulated checks lie, so record what the phone actually does, not
what the code says it should.

## Test Metadata

Fill this in as you go; the evidence column of the checklist below is what
gets copied into the plan doc afterwards.

- Date: 2026-08-03 (setup and blockers cleared 2026-08-01)
- Operator: Ihor Kiyanych, with Claude Code driving the checks
- Environment: staging (`https://www.vizitum.com`, API `https://vizitum-api-staging.onrender.com`)
- Tenant slug: `vizitum-staging` (language `uk`, timezone `Europe/Kiev`)
- Device / iOS version: iPhone, iOS 18.7.9, Home Screen install (`navigator.standalone` = `true`)
- Release SHA under test: `main` as deployed to Vercel on the day; the manifest fix (#178) landed mid-pass and the install was redone against it

## Use staging, not a laptop on the LAN

Three things make a local dev server the wrong target for this pass, all of
them iOS-specific:

- **Secure context.** Both `navigator.mediaDevices.getUserMedia` (the voice
  note) and `navigator.serviceWorker` (the offline shell) require HTTPS on
  iOS. `localhost` is exempt; `http://192.168.x.x:3000` is not, so a phone on
  the LAN gets neither the microphone nor the worker.
- **The service worker only registers in a production build.**
  `apps/web/components/service-worker-registration.tsx` gates registration on
  `NODE_ENV === "production"` (or an explicit
  `NEXT_PUBLIC_ENABLE_SERVICE_WORKER=1`, which exists for the E2E harness and
  carries the stale-chunk risk that gate is there to avoid).
- **Audio and photo bytes go browser → storage directly**, over a presigned
  PUT. Local R2 credentials are placeholders, and an http S3 mock is blocked
  from an https page twice over (mixed content, plus the CSP's
  `upgrade-insecure-requests`).

Staging is already HTTPS with real R2 and a real API, and its web deploy is
current with `main` — verify that before starting rather than assuming it:

```bash
diff <(curl -s https://www.vizitum.com/sw.js) apps/web/public/sw.js && diff <(curl -s https://www.vizitum.com/offline.html) apps/web/public/offline.html && echo "web deploy carries the offline assets at HEAD"
```

`https://vizitum-web.vercel.app` 307s to `https://www.vizitum.com` by design
(`apps/web/lib/canonical-host.ts`) — use the canonical origin on the phone so
the session cookie and the service worker scope sit on one host.

## Before you touch the phone

- [x] **API is ready.** `curl -s https://vizitum-api-staging.onrender.com/api/health/readiness`
      returns `status=ready` with `database.status=ok`. Verified 2026-08-01.
- [x] **The offline migrations are actually applied.** Verified 2026-08-01:
      `prisma migrate status` against the staging database reports 44
      migrations found and "Database schema is up to date", so all four below
      are live. Re-check if the API redeploys ahead of a new migration. Render
      does not run
      migrations on deploy by default (see `docs/runbooks/production-deployment.md`),
      and the whole offline story sits on four of them:
      `20260730000000_report_client_request_id`,
      `20260730120000_visit_client_visit_id`,
      `20260730130000_storage_temporary_deletedat_backfill`,
      `20260730160000_visit_client_aliases`. With the staging database URL:

      ```bash
      DATABASE_URL="<staging-url>" npx prisma migrate status
      ```

      Without it, two session-only probes cover the two that matter most:
      starting a visit online must succeed (`StartVisitControl` always sends a
      `clientVisitId`, so a missing column fails the create outright), and
      opening `https://www.vizitum.com/vizitum-staging/field/visits/00000000-0000-4000-8000-000000000000`
      while signed in must render the "Візит триває" pending screen rather
      than an error — that lookup falls through to `VisitClientAlias`, so a
      missing table turns a plain miss into a 500.
- [x] **The tenant is on a serving status.** `TenancyService.assertTenantCanServeRequests`
      answers requests for `pilot`, `team` and `business` only; every other
      status is a 403, and the login screen renders that 403 as "Неправильна
      електронна пошта або пароль", so it reads as a credentials problem for as
      long as you let it. `vizitum-staging` was found on the legacy `ready`
      status on 2026-08-01 — unable to serve since migration
      `20260707175924_unify_tenant_status_and_plan` redefined `status` as the
      plan tier on 2026-07-07, which is why its last successful login was
      2026-07-02. Fix it as the platform owner: `/platform/tenants` → the
      tenant's status control → `pilot`. `ready` is deliberately not assignable
      there, so this is a one-way exit from the legacy value. Done for
      `vizitum-staging` on 2026-08-01, and sign-in confirmed working right
      after — the same credentials that had been refused for an hour.
- [x] **Account.** A user on `vizitum-staging` with the `field_representative`
      role. Seeded 2026-08-01 as `ikyianich@gmail.com` ("Field Tester", all
      three roles) via `npm run seed:staging-admin` with `SEED_SMOKE_DATA=false`
      — smoke data would have left an open visit on its stop, and an open visit
      changes what T3's start does (adopt instead of create). Sign-in needs a
      Turnstile challenge — captcha is enabled on this environment.
- [x] **Data.** Today's route needs at least two stops on active locations,
      neither of them already visited, and the tenant needs at least one
      product so the report form is not degenerate. The tenant had one active
      location, no stops and no products; seeded 2026-08-01 with three
      locations ("Offline Test Point 1–3", assigned to the test account),
      three products ("Offline Test Product A–C") and a published route plan
      for that date carrying all three as stops.

      **This expires daily.** The plan is dated, so a pass run on any later day
      starts with an empty field home again. Re-create it either by importing
      a visit plan for that date (Admin → Imports → visit/task plan — that
      import is what actually creates the `RoutePlan`; the field home's
      "Додати точку" only adds to a plan that already exists), or by re-running
      the same idempotent seeder, which reuses the existing locations and
      products and only mints the day's plan.
- [x] **Storage works.** Verified 2026-08-03. Record and upload one voice note online, end to end,
      before testing anything offline. If R2 or the presign path is broken on
      staging, every offline capture check below will fail for an unrelated
      reason.

## Phone and inspector setup

1. **iPhone**: Settings → Safari → Advanced → **Web Inspector: on**. iOS 16.4
   or newer.
2. **Mac**: Safari → Settings → Advanced → **Show features for web
   developers**. Connect the phone by cable and trust the computer. The page
   then appears under Develop → *device name*.
3. Sign in on the phone in Safari at
   `https://www.vizitum.com/vizitum-staging/login`, open the field home
   (`/vizitum-staging/field`) **online** and leave it a few seconds. This is
   what registers the worker, caches `offline.html` and the static chunks, and
   writes today's route snapshot.
4. Confirm the page is **not** in demo mode — a "Демо-режим" notice means the
   route came from the fabricated fallback and the snapshot is deliberately
   not written.
5. **Add to Home Screen from a field screen** (Share → Add to Home Screen)
   and run the rest of the pass in the installed app, not the Safari tab. It
   is the installed case that is exempt from iOS's 7-day eviction of
   script-writable storage, and the one a rep would actually use. Expect the
   installed app to need its own sign-in and to build its own
   worker/IndexedDB state — it does not necessarily share Safari's; note
   which way it behaves, it is worth knowing. Keep the Safari tab too: T12
   uses it as the un-installed control.

   *Which screen you install from matters.* Only the field zone links the
   workspace's own manifest (`/vizitum-staging/manifest.webmanifest`, served
   by `apps/web/app/[tenantSlug]/manifest.webmanifest/route.ts`), and that is
   the manifest carrying `start_url: /vizitum-staging/field`. Installed from
   anywhere else — the marketing page, an admin screen — iOS reads the
   origin-wide manifest instead and the app launches at `/sign-in`, which
   reaches a workspace but has no offline shell behind it (T2a would fail for
   that reason alone). Check the icon caption reads the workspace name
   ("Vizitum Demo Team", not "Vizitum") before continuing: that is the
   cheapest confirmation the right manifest was used.

   This was found the hard way on 2026-08-01. Before that day the origin-wide
   manifest was the only one, its `start_url` was `/` and the marketing
   landing's only sign-in link was hardcoded to `/demo-team/login` — a tenant
   that exists in a seeded local database and nowhere else. An install made on
   staging therefore launched on marketing copy whose one link led to a login
   screen that answered every password with "Неправильна електронна пошта або
   пароль", with no address bar to see the wrong slug in.
6. Re-run step 3's warm-up inside the installed app (open the field home
   online once).

Airplane mode is the offline switch throughout. Check that Wi-Fi actually
went down with it — iOS keeps Wi-Fi on if it was toggled back on manually
after entering airplane mode.

## The pass

| #   | Scenario                    | Steps                                                                                                                                                                                                | Expected                                                                                                                                                                                                                                                          | Evidence | Status |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| T1  | Worker and shell cached     | Online, in the installed app: run the SW/cache snippets from the appendix in the inspector console.                                                                                                    | One registration scoped to `https://www.vizitum.com/`; `vizitum-shell-v1` holds `/offline.html`; `vizitum-static-v1` holds `/_next/static/` entries.                                                                                                               | `navigator.standalone` = `true`, `location.href` on a field path. One registration, scope `https://www.vizitum.com/`, `active` = `activated`, `waiting` = null, `controller` = `/sw.js`. `caches.keys()` = `["vizitum-shell-v1", "vizitum-static-v1"]`, shell holding exactly `/offline.html`. First confirmation that iOS registers, keeps and uses the worker in a standalone install. | Pass |
| T2a | Warm offline load           | Airplane mode on with the app **still open** on a field screen. Reload the page (pull to refresh, or `location.reload()` from the inspector). | The offline shell renders today's stops with the banner "Офлайн — дані станом на HH:MM" and per-stop "Відвідано"/"Ще не відвідано" — not Safari's own "no internet" page, and not an empty screen. This is the case the worker actually delivers. Safari's error page *here* would mean the install did not come from a field screen (see setup step 5). | With the app already warm, `location.reload()` offline served the shell on the **first** attempt. The fetch handler demonstrably runs with no network: while offline a `/_next/static/` chunk fetched **200** from `vizitum-static-v1`. | Pass |
| T2b | Cold offline load           | Airplane mode on. Force-quit the app from the app switcher. Reopen it. This reopen is a full navigation to the manifest's `start_url`, so it tests the installed app's launch destination as much as the worker. | **Known to fail, and not a regression to chase.** Expect Safari's own error page; reloading from it does not recover, and a plain Safari tab behaves the same. WebKit fails the launch navigation before dispatching it to the service worker, so no `start_url`, precache or install-time change fixes it — see known gap 1 in `docs/plans/offline-field-drafts-plan-prompt.md` and the header of `apps/web/public/sw.js`. Re-run only to confirm the behavior still stands on a new iOS version; do **not** file it as a worker bug, and do not "fix" it by relaxing the field page's `Cache-Control` (that trades a shared phone's tenant HTML for it — same gap 1). | Cold launch offline → Safari's own error page; reloading from it does not recover; a Safari tab behaves the same. The worker is not what is broken — see T2a for the same worker serving both the shell and a static chunk with no network. So the fallback works for a client that has already loaded a page this session, and never for a cold launch — which is the case the feature exists for. Raised as its own work, and closed as a platform limitation rather than a bug. | **Fail (known)** |
| T2c | Leaving the offline shell   | On the shell from T2a, tap "Try again" while still in airplane mode. Then turn airplane mode off and, without touching the screen, background the app from the app switcher and bring it straight back.                                                                          | The tap answers: "Still no connection. Today's route below is unchanged.", with the route still on screen — it must neither blank nor appear to do nothing at all. Once the signal is back the shell returns to the field home by itself, within a few seconds of the app coming forward, with nothing tapped. Both strings are English on purpose: the shell carries no next-intl and has no tenant language to read. A shell with no way off it is the bug this row exists to catch — on a Home Screen install there is no address bar and no reload button, so the only other exit is force-quitting the app. | Not run — this affordance did not exist at the 2026-08-01 pass; added with the shell recovery fix. | Not run |
| T3  | Offline visit start         | Still offline: open a stop's location card, tap "Почати візит".                                                                                                                                        | Lands on a working report screen headed "Візит триває". Going back to the location card offers "Продовжити візит" with the hint that it has not reached the server yet. Tapping "Почати візит" twice must not mint a second visit.                                  | The queued start is durable and self-heals. `visit-start-outbox` held `clientVisitId 046bcde1…`; after returning online, `remoteVisitId` = `resolvedVisitId` = `cmsde5m5y…` in **one** attempt, `lastError` null, `rejectedAt` null, `routeItemId` intact and `startedAt` preserved as the offline `15:32:45Z` rather than the sync time — 3m07s between the tap and the resolution. The screen half fails: the navigation the start triggers cannot complete offline, so the rep lands on the offline shell instead of "Візит триває" and cannot work the visit at all. | Pass (data) / **Fail** (screen) |
| T4  | Offline voice capture       | On that screen tap the record control ("Записати голосову нотатку"), allow the microphone, speak ~15s, stop.                                                                                            | Recording starts (a first-run permission prompt is expected inside the installed app), playback of the recorded blob works, and the screen says the capture is kept on this device ("Запис нікуди не зник" / "Збережено на цьому пристрої"). `pending-media` holds a record with `bytes.byteLength > 0` and a real audio mime type — iOS 18.7.9 records `audio/webm; codecs=opus`; only older iOS falls back to `audio/mp4`. | 455894 bytes in `pending-media`, keyed tenant/user/visit/`audio`/`bytes`. Mime `audio/webm; codecs=opus`, and the first bytes are `1a 45 df a3` — EBML, so a real WebM container rather than a mislabelled one. iOS 18.7.9 therefore records WebM/Opus and the documented `audio/mp4` fallback no longer applies to current iOS. The screen said the capture was kept on the device, offered playback and retry, and moved to manual entry by itself. | Pass |
| T5  | Offline manual confirm      | Tap "Заповнити вручну", fill the summary and next step, tap "Зберегти звіт".                                                                                                                            | The report is accepted locally, and the outbox indicator reads "1 звіт очікує на відправлення". `report-outbox` holds one entry; `visit-start-outbox` still holds the unsent start.                                                                                 | `report-outbox` held one entry for the visit, `attempts: 0`, `rejectedAt` null. Saving redirects, and that navigation stranded the rep on the offline shell — the third path to do so, after starting and after continuing a visit. `pending-media` came back empty: the confirm deletes both captures deliberately (see the comment above the redirect in `field-visit-report-form.tsx`), which offline means a dictation that never reached the server is destroyed without warning — raised as its own work. The single `report-drafts` record left behind was the rekey's forwarding address (`redirectTo` = the server visit id), not an orphan, confirming that mechanism on a real device. | Pass (data) / **Fail** (screen) |
| T6  | Restart durability          | Still offline: force-quit the app and reopen it — expect T2b's error page, which is why the durability check cannot be made while offline. Turn airplane mode off, reopen, and get to the inspector before the flush finishes (or read the stores straight from the appendix snippets). | The restart lost nothing: `visit-start-outbox` still holds the unsent start, `report-outbox` still holds the one confirm, `pending-media` still holds the recording with `bytes.byteLength > 0`, and the typed draft is still under its key. Nothing is re-sent twice — T7 covers the flush itself. The point of this row is that the queues survive process death, not that the app opens offline from cold; that part is T2b and known to fail. | Not run as its own scenario. The queues did survive several app kills across T3–T5 with nothing lost or re-sent, which covers the substance of it. | Not run |
| T7  | Automatic flush             | Airplane mode off. Leave the app in the foreground; if nothing happens within a few seconds, background it and return (the triggers are app-open, tab-visible and the `online` event — there is no Background Sync on iOS). | The start syncs first, then the confirm. The outbox indicator empties, the screen refreshes to a real visit, and the visit + report appear in `/vizitum-staging/manager/visits` (or field history) with today's timestamp and no duplicate.                                    | After airplane mode off and returning to the app, `report-outbox` emptied on its own with no tap. The start had already resolved the same way during T3, so both queues flushed unattended. | Pass |
| T8  | Manual "Надіслати зараз"    | Repeat T3–T5 on a second stop, come back online, and use the button instead of waiting.                                                                                                                | Same result as T7, initiated by the tap; the button shows "Надсилаємо…" while it runs.                                                                                                                                                                            | Not run — session ended. | Not run |
| T9  | Abandon a queued start      | Offline, start a visit on a third stop, capture something, then tap "Скасувати візит" on the pending screen.                                                                                            | The prompt explains nothing is sent and no reason is collected, warns about the unsent capture, and after confirming the visit is gone from this phone. Back online, no such visit ever appears on the server.                                                       | Not run — session ended. Note the pending screen named in the steps is unreachable offline (T3); use the location card's own abandon control instead. | Not run |
| T10 | Cancel a real visit         | Online, start a visit; offline, record something; back online, cancel the visit through "Скасувати візит" on the visit screen.                                                                          | The modal names the unsent capture before you commit; after cancelling, `pending-media` no longer holds bytes for that visit and nothing for it stays queued.                                                                                                       | Not run — session ended. | Not run |
| T11 | Dead zone, not airplane mode | Join a Wi-Fi network with no working internet (a hotspot with data off works). Repeat a start + capture + confirm.                                                                                     | `navigator.onLine` is `true` and every request hangs or fails — the case airplane mode does not reproduce. Work must still queue rather than surface as a hard error, and must flush once real connectivity returns.                                                 | Not run — session ended. Highest value of what remains: airplane mode does not reproduce a lying `navigator.onLine`. | Not run |
| T12 | 7-day eviction (day 8)      | In the **Safari tab** (not the installed app), leave a pending capture and an unsent report. Do not open the site for 7+ days, then check the appendix counts.                                          | Expected on iOS: script-writable storage is evicted for the un-installed site, which is exactly why `pending-media` is swept at 7 days and why the Home Screen install is the supported case. The installed app's own queue must still be intact.                    | Not run — earliest 2026-08-10. | Not run |

Record what actually happened even when it matches — "Pass" with a screenshot
and the console counts is the evidence this pass exists to produce.

## What the 2026-08-03 run established

**The durability layer is real, and now proven rather than assumed.** A visit
started with no signal reached the server with its offline `startedAt` and its
route-item link intact, in one attempt, without being asked to. A voice note
recorded offline survived as bytes on the device. A report confirmed offline
queued and then flushed itself the moment the app came back with a network.
The rekey's forwarding address — the fix for the orphaned draft, until now
verified only against `fake-indexeddb` — was observed doing its job on a real
phone, 17ms after the start resolved. Nothing in five scenarios was lost or
duplicated.

**The reachability layer is not.** No navigation completes without a network,
and three separate paths proved it in one session: starting a visit,
continuing one, and saving a report all end on the offline shell instead of
the screen they were going to. The shell itself only appears for a client that
has already loaded a page in this session; a cold launch in a dead zone — the
shape the feature was built for — gets Safari's error page. So a rep who walks
into a basement with the app closed cannot open it; one who walks in with a
screen open can work on that screen and nowhere else.

That asymmetry is the finding. Everything the offline effort built to keep
work safe does keep it safe. Everything built to let a rep *reach* that work
without a network does not hold on iOS, and the emulated coverage could not
have shown it: `apps/web/e2e/field-offline-shell.spec.ts` drives an
already-loaded Chromium context, which is precisely the state that works here
too.

**Method note for the remaining scenarios.** Because of the above, run each
one screen-first: open the screen online, then drop connectivity from Control
Centre without leaving it. That is not a softened test — it is the real dead
zone, where a rep opens the location card upstairs and loses signal in the
basement.

### Raised as separate work

Two were fixed and deployed the same day, before the pass could continue:

- A tenant on the legacy `ready` status refused every request, and the login
  screen reported that as wrong credentials (seed fixed in #176; the tenant
  moved to `pilot` by hand).
- A Home Screen install had no route to any workspace: iOS honours the
  manifest's `start_url`, not the page the shortcut was made from, and the
  origin-wide manifest pointed at marketing copy whose only sign-in link named
  a tenant that exists in no deployed database (#178).

Three came out of the pass itself. All three have since been answered — two by
a fix, one by withdrawing the promise:

- The offline shell never loads on a cold start (T2b). **Withdrawn, not
  fixed**: WebKit fails the launch navigation before the worker is consulted,
  so nothing this repo controls reaches it. The claim is gone from the plan
  doc, the module map and `apps/web/public/sw.js`, and T2b records the
  behavior so a future iOS that changes it gets noticed.
- The offline shell was a one-way door — no retry control, no `online`
  listener, and on an installed app no address bar either, so the only exit was
  force-quitting. Observed twice. **Fixed**: `offline.html` now carries a retry
  control plus automatic recovery on `online` and `visibilitychange`. As the
  original note warned, navigating to the **same** URL does not escape it, so
  the retry probes with a `HEAD` request first and navigates only once
  something answers. Covered by T2c and by
  `apps/web/e2e/field-offline-shell.spec.ts`.
- Confirming a report deletes an unsent recording without warning (T5).
  **Fixed**: the report form now names what confirming is about to destroy and
  asks first, pointing the rep at "Надіслати ще раз" while there is still
  something to send.

And one correction to this document's own expectations: iOS 18.7.9 records
`audio/webm; codecs=opus`, not the `audio/mp4` the design notes still describe
as the Safari fallback. Verified by the container's own bytes, not just the
reported mime type.

## Inspector console snippets

Run these from Develop → *device* → the app's page. They read the same stores
the code uses (`apps/web/lib/field-db.ts`).

```js
// Worker + caches
navigator.serviceWorker.getRegistrations().then((r) => console.log(r.map((x) => x.scope)));
caches.keys().then(console.log);
caches.open("vizitum-shell-v1").then((c) => c.keys()).then((k) => console.log(k.map((r) => r.url)));
```

```js
// Store counts — run after each offline step
(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("vizitum-field");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  for (const name of ["report-drafts", "pending-media", "report-outbox", "visit-start-outbox", "route-snapshot"]) {
    const count = await new Promise((res) => {
      const q = db.transaction(name).objectStore(name).count();
      q.onsuccess = () => res(q.result);
    });
    console.log(name, count);
  }
})();
```

```js
// The captured bytes really are bytes (T4), and the queue's shape (T5)
(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open("vizitum-field");
    r.onsuccess = () => res(r.result);
  });
  const all = (store) => new Promise((res) => {
    const q = db.transaction(store).objectStore(store).getAll();
    q.onsuccess = () => res(q.result);
  });
  console.log((await all("pending-media")).map((r) => ({ key: r.key, mime: r.mimeType, bytes: r.bytes?.byteLength })));
  console.log((await all("report-outbox")).map((r) => ({ key: r.key, attempts: r.attempts, createdAt: new Date(r.createdAt).toISOString() })));
  console.log((await all("visit-start-outbox")).map((r) => ({ key: r.key, remoteVisitId: r.remoteVisitId, resolvedVisitId: r.resolvedVisitId })));
})();
```

## Reset between runs

- Data: iPhone → Settings → Safari → Advanced → Website Data → remove
  `vizitum.com`. For the installed app, deleting the Home Screen icon drops
  its storage with it; re-add and sign in again.
- Server state: cancel or complete any visit left open on a stop —
  `Visit.routeItemId` is unique across every status, so a stop with an open
  visit changes what the next start does (it gets adopted rather than
  created).
- Worker: `navigator.serviceWorker.getRegistrations().then((r) => r.forEach((x) => x.unregister()))`
  plus `caches.keys().then((k) => k.forEach((n) => caches.delete(n)))` if you
  need a genuinely cold install.

## When something fails

Map the symptom to the owning module before filing it — every one of these
has a single home:

- Shell does not load offline / wrong page → `apps/web/public/sw.js`,
  `apps/web/components/service-worker-registration.tsx`.
- Shell loads but shows no stops → `apps/web/lib/route-snapshot.ts`,
  `apps/web/components/route-snapshot-writer.tsx`, `apps/web/public/offline.html`.
- Start offline fails or duplicates → `apps/web/components/start-visit-control.tsx`,
  `apps/web/lib/visit-start-outbox*.ts`, `VisitsService.createVisit`.
- Capture lost or zero-length on retry → `apps/web/lib/offline-drafts.ts`,
  `apps/web/lib/storage-retry.ts`.
- Confirm not queued, re-sent, or duplicated → `apps/web/lib/report-outbox*.ts`,
  `apps/web/lib/report-send-outcome.ts`, `Report.clientRequestId`.

## Recording the result

1. Fill the Evidence/Status columns above and commit this file with the run
   filled in.
2. Tick the real-phone line in `docs/vizitum-action-plan.md` and update the
   "Known gaps" section of `docs/plans/offline-field-drafts-plan-prompt.md` —
   gap #1 is exactly this pass. **Not yet done, deliberately.** The 2026-08-03
   run covered T1–T5 and T7 and left T6 and T8–T12 unrun, and two of what it
   did cover failed. Ticking a line that reads "verify the whole story on a
   real phone" off a partial run with open failures would put the plan doc
   back to claiming something untrue, which is the exact habit that gap
   existed to break. Tick it when the remaining scenarios have run and the
   failures are closed or consciously accepted.
3. File anything that failed as its own issue with the store counts and the
   module from the map above; do not fold a fix into this document.
