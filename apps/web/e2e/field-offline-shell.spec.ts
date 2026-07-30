import { expect, test, type Page } from "@playwright/test";

// End-to-end contract for the service worker's navigation fallback
// (apps/web/public/sw.js + offline.html): a cold reload of the field zone
// with no signal at all must show today's route from the last on-device
// snapshot instead of the browser's own "no internet" page.
//
// Every other offline simulation in this suite (field-pending-media.spec.ts,
// field-offline-visit-start.spec.ts) aborts specific request methods via
// page.route, which never touches a full navigation's own network fetch —
// fine for a Server Action, but the worker's fallback only fires when
// fetch(event.request) itself rejects, which needs the real thing:
// context.setOffline(true). New pattern in this suite, flagged as such.
//
// Reads e2e-field-revisit read-only — signs in, loads the field home page,
// goes offline — and mutates none of its route-item/visit state, so it is
// safe to run alongside field-revisit.spec.ts's own mutations under
// fullyParallel (see that file's own comment on the rule this follows).
// Nothing here asserts on the seeded stop's visited/not-visited state, only
// that it appears, since that state depends on run order against the other
// spec.

const TENANT_SLUG = "e2e-field-revisit";
const REP_EMAIL = "rep@e2e-field-revisit.local";
const REP_PASSWORD = "E2eField12345!";
const LOCATION_NAME = "E2E Revisit Market";

async function signIn(page: Page): Promise<void> {
  await page.goto(`/${TENANT_SLUG}/login`);
  await page.getByLabel("Email").fill(REP_EMAIL);
  await page.getByLabel("Password").fill(REP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**/${TENANT_SLUG}/field`);
}

test("a cold reload with no signal shows today's route from the last snapshot", async ({
  page,
  context,
}) => {
  await signIn(page);

  // Registration happens in a mount-time effect, after this first load has
  // already rendered — this load itself is never worker-controlled. Waiting
  // for `controller` is what proves activation + clients.claim() actually
  // landed, rather than assuming a fixed delay; by the time it resolves,
  // sw.js's own install step has already cached offline.html (install fully
  // completes, including that cache write, before activate can even run).
  //
  // Bounded, and checked before anything else: registration only happens at
  // all when NEXT_PUBLIC_ENABLE_SERVICE_WORKER is set, which playwright.config.ts
  // sets on its own web server — but reuseExistingServer (true outside CI)
  // means a dev server left running from before that env var existed, or
  // started by hand without it, gets silently reused with no registration
  // ever attempted. Without this check that reads as an unbounded hang on
  // the line below with no indication why; skipping with a specific reason
  // turns it into something actionable instead. Never happens in CI, where
  // reuseExistingServer is always false and every run gets a fresh server.
  const registered = await page
    .waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 5_000,
    })
    .then(() => true)
    .catch(() => false);

  test.skip(
    !registered,
    "Service worker never registered within 5s — the dev server behind this " +
      "run was likely reused (reuseExistingServer) from before it, or " +
      "started by hand, without NEXT_PUBLIC_ENABLE_SERVICE_WORKER set. Stop " +
      "it and re-run so Playwright starts its own.",
  );

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator("#heading")).toHaveText("Today's route");
  await expect(page.locator("#banner")).toContainText("Offline — data as of");
  await expect(page.locator("#stops")).toContainText(LOCATION_NAME);

  // Same worker, same scope (the whole origin) — a tenant slug this browser
  // has never loaded online has nothing in IndexedDB to read back, so the
  // shell's other branch has to carry the message on its own rather than
  // reading anything from the (nonexistent) snapshot.
  await page.goto(`/${TENANT_SLUG}-unseen/field`);
  await expect(page.locator("#banner")).toContainText("No offline data yet");

  await context.setOffline(false);
});
