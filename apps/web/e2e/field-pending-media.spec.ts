import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { PENDING_MEDIA_SEED_ARGS } from "./global-setup";

// End-to-end contract for the one thing a rep cannot get back: bytes they
// captured that never reached storage. A visit in a dead zone fails at exactly
// this point, and before the pending-media store existed the recording (or
// photo) was dropped on the floor with an error message.
//
// The guarantee under test is that the bytes survive the page going away —
// which is what a reload, a killed tab, or an OS reclaiming a backgrounded
// browser all look like from here. It cannot be unit-tested: it lives in
// IndexedDB, and the only honest check is to reload a real browser and see the
// capture come back with its retry still offered.
//
// Owns its own tenant, seeded by global-setup.ts from the same parameterized
// script field-revisit uses. It cannot share that spec's tenant: both start a
// visit on the seeded stop, `Visit.routeItemId` is unique, and under
// fullyParallel the loser cannot start a visit at all. Re-seeded here as well,
// because this spec mutates that state and a CI retry lands in a fresh worker
// that needs the stop back at "planned".
//
// Every PUT is aborted so the upload cannot succeed. That covers both
// environments deliberately: CI has no S3 configuration at all, so the
// registration itself fails there, while a developer with storage configured
// gets as far as the upload. Both paths must end with the bytes held and a
// retry offered, and the assertions below are the same either way.

const TENANT_SLUG = "e2e-field-media";
const REP_EMAIL = "rep@e2e-field-media.local";
const REP_PASSWORD = "E2eField12345!";
const LOCATION_NAME = "E2E Media Market";
const PHOTO_NAME = "shelf-problem.png";

test.beforeAll(() => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");

  execFileSync(
    "node",
    ["scripts/seed-e2e-field-revisit.mjs", ...PENDING_MEDIA_SEED_ARGS],
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

test("a capture that never reached storage survives the page going away", async ({
  page,
}) => {
  // The upload is the step that fails in a basement. Aborting it here is the
  // whole point of the test, so it stays aborted across the reload too.
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

  const visitUrl = page.url();

  // The manual form is the fallback path and has to be reachable without the
  // microphone ever being touched.
  await page.getByRole("button", { name: "Fill in manually" }).click();
  await page.getByRole("button", { name: /^Problem/ }).click();

  await page.getByLabel(/Add a photo|Uploading/).setInputFiles({
    name: PHOTO_NAME,
    mimeType: "image/png",
    buffer: Buffer.alloc(2048, 7),
  });

  // The failure is reported as something the rep can act on, not as a loss.
  const pending = page.getByRole("region", {
    name: "Photo waiting to be sent",
  });
  await expect(pending).toBeVisible();
  await expect(pending).toContainText(PHOTO_NAME);
  await expect(pending).toContainText("Saved on this device");
  await expect(
    pending.getByRole("button", { name: "Send again" }),
  ).toBeVisible();

  // The page going away is the case this whole store exists for.
  await page.reload();

  const restored = page.getByRole("region", {
    name: "Photo waiting to be sent",
  });
  await expect(restored).toBeVisible();
  await expect(restored).toContainText(PHOTO_NAME);
  await expect(
    restored.getByRole("button", { name: "Send again" }),
  ).toBeVisible();

  // Restoring must land the rep on the form rather than the voice screen,
  // which would hide the retry behind a mic button — and the report must stay
  // fillable regardless, since manual confirmation is always available.
  await expect(page.getByRole("button", { name: "Save report" })).toBeVisible();
  expect(page.url()).toBe(visitUrl);

  // Discarding is the rep's own choice and must actually forget the bytes, so
  // a later reload does not resurrect what they dismissed.
  await restored.getByRole("button", { name: "Delete photo" }).click();
  await expect(restored).toBeHidden();

  await page.reload();
  await expect(
    page.getByRole("region", { name: "Photo waiting to be sent" }),
  ).toBeHidden();
});
