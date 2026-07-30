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
// What this file does not cover: the visit actually resolving once signal
// returns, and the adopt case specifically (the rep's own already-open visit
// on the same stop, where the server discards the client-minted id — see
// visit-start-outbox.ts). Both need controlling exactly what the create
// response contains, which page.route() could technically fulfill, but
// reaching that with confidence needs a real backend round trip; verified by
// hand against the demo tenant instead, same limitation the plan doc already
// documents for the queued-confirm-cancel case.
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

// Both tests start a visit on the one seeded planned stop; under
// fullyParallel that races two attempts over `Visit.routeItemId`'s
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

test("starting a visit with no signal still opens a working report screen, and the location card remembers it", async ({
  page,
}) => {
  const locationUrl = await openLocation(page);

  // Every Server Action invocation is a POST carrying this header, regardless
  // of what it does — the eager attempt in start-visit-control.tsx throws
  // exactly the way it would with no signal, which is the whole point: this
  // is not a special-cased test double, it is the real "no network" path.
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();

    return "next-action" in headers ? route.abort() : route.fallback();
  });

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
