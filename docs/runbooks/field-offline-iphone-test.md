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

- Date:
- Operator:
- Environment: staging (`https://www.vizitum.com`, API `https://vizitum-api-staging.onrender.com`)
- Tenant slug: `vizitum-staging` (language `uk`, timezone `Europe/Kiev`)
- Device / iOS version:
- Release SHA under test:

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
- [ ] **Storage works.** Record and upload one voice note online, end to end,
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
5. **Add to Home Screen** (Share → Add to Home Screen) and run the rest of the
   pass in the installed app, not the Safari tab. It is the installed case
   that is exempt from iOS's 7-day eviction of script-writable storage, and
   the one a rep would actually use. Expect the installed app to need its own
   sign-in and to build its own worker/IndexedDB state — it does not
   necessarily share Safari's; note which way it behaves, it is worth knowing.
   Keep the Safari tab too: T12 uses it as the un-installed control.
6. Re-run step 3's warm-up inside the installed app (open the field home
   online once).

Airplane mode is the offline switch throughout. Check that Wi-Fi actually
went down with it — iOS keeps Wi-Fi on if it was toggled back on manually
after entering airplane mode.

## The pass

| #   | Scenario                    | Steps                                                                                                                                                                                                | Expected                                                                                                                                                                                                                                                          | Evidence | Status |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| T1  | Worker and shell cached     | Online, in the installed app: run the SW/cache snippets from the appendix in the inspector console.                                                                                                    | One registration scoped to `https://www.vizitum.com/`; `vizitum-shell-v1` holds `/offline.html`; `vizitum-static-v1` holds `/_next/static/` entries.                                                                                                               |          |        |
| T2  | Cold offline load           | Airplane mode on. Force-quit the app from the app switcher. Reopen it.                                                                                                                                 | The offline shell renders today's stops with the banner "Офлайн — дані станом на HH:MM" and per-stop "Відвідано"/"Ще не відвідано" — not Safari's own "no internet" page, and not an empty screen.                                                                  |          |        |
| T3  | Offline visit start         | Still offline: open a stop's location card, tap "Почати візит".                                                                                                                                        | Lands on a working report screen headed "Візит триває". Going back to the location card offers "Продовжити візит" with the hint that it has not reached the server yet. Tapping "Почати візит" twice must not mint a second visit.                                  |          |        |
| T4  | Offline voice capture       | On that screen tap the record control ("Записати голосову нотатку"), allow the microphone, speak ~15s, stop.                                                                                            | Recording starts (a first-run permission prompt is expected inside the installed app), playback of the recorded blob works, and the screen says the capture is kept on this device ("Запис нікуди не зник" / "Збережено на цьому пристрої"). `pending-media` holds a record with `bytes.byteLength > 0` and an `audio/mp4` mime type. |          |        |
| T5  | Offline manual confirm      | Tap "Заповнити вручну", fill the summary and next step, tap "Зберегти звіт".                                                                                                                            | The report is accepted locally, and the outbox indicator reads "1 звіт очікує на відправлення". `report-outbox` holds one entry; `visit-start-outbox` still holds the unsent start.                                                                                 |          |        |
| T6  | Cold start, still offline   | Still offline: force-quit the app, reopen it, navigate back into the visit.                                                                                                                            | Queue counts and the typed draft survive the restart; nothing is re-sent, nothing is lost, no error screen.                                                                                                                                                        |          |        |
| T7  | Automatic flush             | Airplane mode off. Leave the app in the foreground; if nothing happens within a few seconds, background it and return (the triggers are app-open, tab-visible and the `online` event — there is no Background Sync on iOS). | The start syncs first, then the confirm. The outbox indicator empties, the screen refreshes to a real visit, and the visit + report appear in `/vizitum-staging/manager/visits` (or field history) with today's timestamp and no duplicate.                                    |          |        |
| T8  | Manual "Надіслати зараз"    | Repeat T3–T5 on a second stop, come back online, and use the button instead of waiting.                                                                                                                | Same result as T7, initiated by the tap; the button shows "Надсилаємо…" while it runs.                                                                                                                                                                            |          |        |
| T9  | Abandon a queued start      | Offline, start a visit on a third stop, capture something, then tap "Скасувати візит" on the pending screen.                                                                                            | The prompt explains nothing is sent and no reason is collected, warns about the unsent capture, and after confirming the visit is gone from this phone. Back online, no such visit ever appears on the server.                                                       |          |        |
| T10 | Cancel a real visit         | Online, start a visit; offline, record something; back online, cancel the visit through "Скасувати візит" on the visit screen.                                                                          | The modal names the unsent capture before you commit; after cancelling, `pending-media` no longer holds bytes for that visit and nothing for it stays queued.                                                                                                       |          |        |
| T11 | Dead zone, not airplane mode | Join a Wi-Fi network with no working internet (a hotspot with data off works). Repeat a start + capture + confirm.                                                                                     | `navigator.onLine` is `true` and every request hangs or fails — the case airplane mode does not reproduce. Work must still queue rather than surface as a hard error, and must flush once real connectivity returns.                                                 |          |        |
| T12 | 7-day eviction (day 8)      | In the **Safari tab** (not the installed app), leave a pending capture and an unsent report. Do not open the site for 7+ days, then check the appendix counts.                                          | Expected on iOS: script-writable storage is evicted for the un-installed site, which is exactly why `pending-media` is swept at 7 days and why the Home Screen install is the supported case. The installed app's own queue must still be intact.                    |          |        |

Record what actually happened even when it matches — "Pass" with a screenshot
and the console counts is the evidence this pass exists to produce.

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
   gap #1 is exactly this pass.
3. File anything that failed as its own issue with the store counts and the
   module from the map above; do not fold a fix into this document.
