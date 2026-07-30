import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { CANCEL_VISIT_SEED_ARGS } from "./global-setup";

// End-to-end contract for the other known gap in the offline series: a photo
// captured but never uploaded, still sitting in pending-media when the rep
// cancels, must not be left behind. Before this, CancelVisitModal ->
// cancelVisitAction -> VisitsService.cancelVisit deleted nothing on the
// device — the bytes just sat there, unreachable, until the 7-day sweep,
// because the visit that could have retried them was now locked.
//
// Cannot be unit-tested for the same reason field-pending-media.spec.ts
// can't: it lives in IndexedDB. The one thing that spec doesn't need and this
// one does is a way to see the *absence* of a record once the UI that would
// show it no longer renders — a cancelled visit's page is the locked,
// read-only branch, which never mounts the report form pending-media reads
// from. So the check here reads the store directly rather than through the
// screen it would otherwise have appeared in.
//
// Owns its own tenant for the reason every spec in this file shares:
// `Visit.routeItemId` is unique, so two specs racing to start a visit on the
// same seeded stop leaves the loser unable to start one at all.

const TENANT_SLUG = "e2e-field-cancel";
const REP_EMAIL = `rep@${TENANT_SLUG}.local`;
const REP_PASSWORD = "E2eField12345!";
const LOCATION_NAME = "E2E Cancel Market";
const PHOTO_NAME = "shelf-problem.png";

test.beforeEach(() => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");

  execFileSync(
    "node",
    ["scripts/seed-e2e-field-revisit.mjs", ...CANCEL_VISIT_SEED_ARGS],
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

// Same PUT-abort trick as field-pending-media.spec.ts: covers CI (no S3
// configured, so the registration call itself fails) and a developer's
// machine (gets as far as the upload) with one assertion either way.
async function startVisit(page: Page): Promise<void> {
  await page.route("**/*", async (route) =>
    route.request().method() === "PUT" ? route.abort() : route.fallback(),
  );

  await signIn(page);

  await page
    .getByRole("link", { name: `View ${LOCATION_NAME}` })
    .first()
    .click();
  await page.waitForURL("**/field/locations/**");
  await page.getByRole("button", { name: "Start visit", exact: true }).click();
  await page.waitForURL("**/field/visits/**");
}

// "vizitum-field" and "pending-media" are field-db.ts's DATABASE_NAME and
// MEDIA_STORE, duplicated here rather than imported — this runs in the
// browser via page.evaluate, not in the app's module graph.
async function pendingMediaCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("vizitum-field");

        request.onerror = () =>
          reject(request.error ?? new Error("IndexedDB open failed"));
        request.onsuccess = () => {
          const database = request.result;
          const store = database
            .transaction("pending-media", "readonly")
            .objectStore("pending-media");
          const countRequest = store.count();

          countRequest.onsuccess = () => resolve(countRequest.result);
          countRequest.onerror = () =>
            reject(countRequest.error ?? new Error("IndexedDB count failed"));
        };
      }),
  );
}

test("cancelling a visit discards its unsent photo instead of stranding it", async ({
  page,
}) => {
  await startVisit(page);

  await page.getByRole("button", { name: "Fill in manually" }).click();
  await page.getByRole("button", { name: /^Problem/ }).click();

  await page.getByLabel(/Add a photo|Uploading/).setInputFiles({
    name: PHOTO_NAME,
    mimeType: "image/png",
    buffer: Buffer.alloc(2048, 7),
  });

  await expect(
    page.getByRole("region", { name: "Photo waiting to be sent" }),
  ).toBeVisible();
  // Not asserted as exactly one: a dev environment with real storage
  // configured also gets a registration record beside the bytes, where CI
  // (no storage configured) only ever gets the bytes. Either way, there is
  // something here for cancelling to strand.
  expect(await pendingMediaCount(page)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Cancel visit" }).click();

  const dialog = page.getByRole("dialog", { name: "Cancel this visit" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(
      "This visit has an unsent recording or photo. Cancelling now will discard it.",
    ),
  ).toBeVisible();

  await dialog.getByLabel("Reason").selectOption("location_closed");
  await dialog.getByRole("button", { name: "Cancel visit" }).click();

  await expect(
    page.getByRole("heading", { name: "The visit was cancelled" }),
  ).toBeVisible();

  // The redirect lands back on the location card in the same browsing
  // context, so this reads the same IndexedDB connection the cancel flow's
  // cleanup just wrote through — not a fresh reload racing it.
  expect(await pendingMediaCount(page)).toBe(0);
});
