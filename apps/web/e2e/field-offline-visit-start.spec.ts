import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { OFFLINE_VISIT_START_SEED_ARGS } from "./global-setup";

// End-to-end contract for phase 3 of the offline plan: starting a visit with
// no signal at all. Before this, "Start visit" was a plain Server Action
// POST with no client id and no offline path — a rep with no signal got
// bounced back to the location card with a bare error and nothing to work
// from.
//
// Every POST carrying a `Next-Action` header is aborted (never a plain
// navigation — those never carry that header) so the eager create attempt in
// start-visit-control.tsx's click handler throws exactly the way it would
// with no signal at all, the same technique field-pending-media.spec.ts uses
// for PUT. This is deliberately the *real* offline flow end to end (mint,
// queue, navigate) rather than a hand-seeded IndexedDB record, because it
// exercises the actual userId the enqueue call used — nothing here needs to
// know or guess it.
//
// Also covers taking that start back — cancelling a visit that only ever
// existed on this device, from both places it can be reached (the report
// screen it opened, and the location card's "still syncing" state). That path
// deletes rather than sends, so it is checked against the stores directly,
// the way field-cancel-visit.spec.ts checks its own delete.
//
// What this file does not cover: the visit actually resolving once signal
// returns, the adopt case specifically (the rep's own already-open visit on
// the same stop, where the server discards the client-minted id — see
// visit-start-outbox.ts), and the one branch of cancelling that depends on
// resolution — a start that syncs while the rep reads the prompt, which sends
// them to the real visit instead of deleting anything. All three need control
// over exactly what the create response contains, which page.route() could
// technically fulfill, but reaching that with confidence needs a real backend
// round trip; verified by hand against the demo tenant instead, same
// limitation the plan doc already documents for the queued-confirm-cancel
// case.
//
// Owns its own tenant for the reason every spec starting a visit does:
// `Visit.routeItemId` is unique, so two specs racing to start a visit on the
// same seeded stop leaves the loser unable to start one at all.

const TENANT_SLUG = "e2e-field-offline-start";
const REP_EMAIL = `rep@${TENANT_SLUG}.local`;
const REP_PASSWORD = "E2eField12345!";
const LOCATION_NAME = "E2E Offline Start Market";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUID_PATTERN = /^c[a-z0-9]{20,}$/i;

// Every test here starts a visit on the one seeded planned stop; under
// fullyParallel that races several attempts over `Visit.routeItemId`'s
// uniqueness, same reasoning as field-pending-media.spec.ts.
test.describe.configure({ mode: "serial" });

test.beforeEach(() => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");

  execFileSync(
    "node",
    ["scripts/seed-e2e-field-revisit.mjs", ...OFFLINE_VISIT_START_SEED_ARGS],
    { cwd: repoRoot, stdio: "inherit" },
  );
});

async function signIn(page: Page): Promise<void> {
  await page.goto(`/${TENANT_SLUG}/login`);
  await page.getByLabel("Email").fill(REP_EMAIL);
  await page.getByLabel("Password").fill(REP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**/${TENANT_SLUG}/field`);
}

async function openLocation(page: Page): Promise<string> {
  await signIn(page);

  await page
    .getByRole("link", { name: `View ${LOCATION_NAME}` })
    .first()
    .click();
  await page.waitForURL("**/field/locations/**");

  return page.url();
}

function visitIdFrom(url: string): string {
  return new URL(url).pathname.split("/").pop() ?? "";
}

// "vizitum-field" and "visit-start-outbox" are field-db.ts's DATABASE_NAME
// and VISIT_START_STORE, duplicated here rather than imported — this runs in
// the browser via page.evaluate, not the app's module graph.
type VisitStartOutboxEntryShape = {
  clientVisitId: string;
  resolvedVisitId: string | null;
};

async function visitStartOutboxEntries(
  page: Page,
): Promise<VisitStartOutboxEntryShape[]> {
  return page.evaluate(
    () =>
      new Promise<VisitStartOutboxEntryShape[]>((resolve, reject) => {
        const request = indexedDB.open("vizitum-field");

        request.onerror = () =>
          reject(request.error ?? new Error("IndexedDB open failed"));
        request.onsuccess = () => {
          const database = request.result;
          const store = database
            .transaction("visit-start-outbox", "readonly")
            .objectStore("visit-start-outbox");
          const allRequest = store.getAll() as IDBRequest<
            VisitStartOutboxEntryShape[]
          >;

          allRequest.onsuccess = () =>
            resolve(
              allRequest.result.map((entry) => ({
                clientVisitId: entry.clientVisitId,
                resolvedVisitId: entry.resolvedVisitId,
              })),
            );
          allRequest.onerror = () =>
            reject(allRequest.error ?? new Error("IndexedDB read failed"));
        };
      }),
  );
}

// Counts what a cancel has to have discarded. Same duplication note as
// above.
async function pendingMediaCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("vizitum-field");

        request.onerror = () =>
          reject(request.error ?? new Error("IndexedDB open failed"));
        request.onsuccess = () => {
          const database = request.result;
          const countRequest = database
            .transaction("pending-media", "readonly")
            .objectStore("pending-media")
            .count();

          countRequest.onsuccess = () => resolve(countRequest.result);
          countRequest.onerror = () =>
            reject(countRequest.error ?? new Error("IndexedDB count failed"));
        };
      }),
  );
}

// Every Server Action invocation is a POST carrying this header, regardless of
// what it does — so aborting exactly those makes the eager create attempt in
// start-visit-control.tsx throw the way it would with no signal at all, while
// leaving plain navigations alone. Not a special-cased test double: it is the
// real "no network" path.
async function goOffline(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();

    return "next-action" in headers ? route.abort() : route.fallback();
  });
}

test("starting a visit with no signal still opens a working report screen, and the location card remembers it", async ({
  page,
}) => {
  const locationUrl = await openLocation(page);

  await goOffline(page);

  await page.getByRole("button", { name: "Start visit", exact: true }).click();
  await page.waitForURL("**/field/visits/**");

  const visitId = visitIdFrom(page.url());
  expect(visitId).toMatch(UUID_PATTERN);

  // The fallback rendered a working screen off the client-minted id alone —
  // not the flat "visit not found" panel a GET 404 showed before this.
  await expect(
    page.getByRole("heading", { name: "Visit in progress" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This visit hasn't reached the server yet — it will send automatically once you have signal again.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fill in manually" }),
  ).toBeVisible();

  // The location card's own "is there already a queued start here" check —
  // without it, backing out and re-tapping "start" while still offline would
  // mint a second id for the same stop.
  await page.goto(locationUrl);
  await expect(
    page.getByRole("link", { name: "Continue visit" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This visit hasn't reached the server yet — it will send automatically once you have signal again.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start visit", exact: true }),
  ).toBeHidden();

  // The mapping survives a reload of the visit link itself — a rep who
  // force-quits mid-basement and reopens the app must land on the same
  // working screen, not a dead link. A fresh, hard navigation this time
  // (not the client-side push starting the visit produced), so this is also
  // the first real check that the fallback works from a cold document load.
  await page.goto(`/${TENANT_SLUG}/field/visits/${visitId}`);
  await expect(
    page.getByRole("heading", { name: "Visit in progress" }),
  ).toBeVisible();
});

// The other half of "a visit can be started with no signal": being able to
// take it back. Without this the offline start is a one-way door — the queued
// start syncs the moment signal returns and becomes a real `in_progress`
// visit that nobody ever confirms or cancels, because the rep who decided not
// to visit has no affordance anywhere that would stop it.
test("a visit started with no signal can be cancelled before it ever syncs", async ({
  page,
}) => {
  const locationUrl = await openLocation(page);

  await goOffline(page);

  await page.getByRole("button", { name: "Start visit", exact: true }).click();
  await page.waitForURL("**/field/visits/**");
  expect(await visitStartOutboxEntries(page)).toHaveLength(1);

  // Something for the prompt to warn about, captured the way a rep in a
  // basement would: the bytes reach pending-media, the registration that
  // would send them cannot go anywhere.
  await page.getByRole("button", { name: "Fill in manually" }).click();
  await page.getByRole("button", { name: /^Problem/ }).click();
  await page.getByLabel(/Add a photo|Uploading/).setInputFiles({
    name: "shelf-problem.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(2048, 7),
  });
  await expect(
    page.getByRole("region", { name: "Photo waiting to be sent" }),
  ).toBeVisible();
  expect(await pendingMediaCount(page)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Cancel visit", exact: true }).click();

  // No reason select and no dialog, unlike a real visit's cancel: there is no
  // visit on the server to record a cancellation against.
  await expect(
    page.getByText(
      "This visit hasn't reached the server yet, so cancelling it just removes it from this phone",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The recording or photo taken for it hasn't been sent yet and will be discarded.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel visit", exact: true }).click();
  await page.waitForURL("**/field/locations/**");

  // Back to a stop the rep can simply start again — and nothing left queued
  // to sync a visit they just cancelled.
  await expect(
    page.getByRole("button", { name: "Start visit", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue visit" })).toBeHidden();
  expect(await visitStartOutboxEntries(page)).toHaveLength(0);
  expect(await pendingMediaCount(page)).toBe(0);

  // Still gone after a real reload, not just in the state this tab happens to
  // be holding.
  await page.goto(locationUrl);
  await expect(
    page.getByRole("button", { name: "Start visit", exact: true }),
  ).toBeVisible();
});

test("the location card can cancel a queued start without opening it", async ({
  page,
}) => {
  const locationUrl = await openLocation(page);

  await goOffline(page);

  await page.getByRole("button", { name: "Start visit", exact: true }).click();
  await page.waitForURL("**/field/visits/**");

  // The gap this closes was written up against this screen specifically: the
  // card offered "continue, still syncing" and no way out of it at all.
  await page.goto(locationUrl);
  await expect(
    page.getByRole("link", { name: "Continue visit" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel visit", exact: true }).click();
  await page.getByRole("button", { name: "Cancel visit", exact: true }).click();

  // No navigation and no refresh here — the server's own render of this stop
  // never knew about this visit, so dropping the local state is the whole
  // update.
  await expect(
    page.getByRole("button", { name: "Start visit", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue visit" })).toBeHidden();
  expect(await visitStartOutboxEntries(page)).toHaveLength(0);
});

test("starting a visit with a live connection is unchanged", async ({
  page,
}) => {
  await openLocation(page);

  await page.getByRole("button", { name: "Start visit", exact: true }).click();
  await page.waitForURL("**/field/visits/**");

  // No interception here: the eager attempt resolves for real, so the rep is
  // sent straight to the server's own id and never sees a client-minted one.
  const visitId = visitIdFrom(page.url());
  expect(visitId).toMatch(CUID_PATTERN);
  expect(visitId).not.toMatch(UUID_PATTERN);

  await expect(
    page.getByRole("heading", { name: "Visit in progress" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Fill in manually" }),
  ).toBeVisible();

  // The eager attempt marks its own outbox entry resolved on the spot rather
  // than leaving that to the next background flush — otherwise a rep who
  // starts online, finishes the whole visit, and returns to this same
  // location card without a hard reload (so the layout never remounts to
  // flush anything) would see "Continue visit, still syncing" for a visit
  // that has been done for a while, since findPendingVisitStartForLocation
  // would still find the unresolved record.
  const entries = await visitStartOutboxEntries(page);
  expect(entries).toHaveLength(1);
  expect(entries[0].resolvedVisitId).toBe(visitId);
});
