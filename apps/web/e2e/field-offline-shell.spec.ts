import { expect, test, type Page } from "@playwright/test";

// End-to-end contract for the service worker's navigation fallback
// (apps/web/public/sw.js + offline.html): a cold reload of the field zone
// with no signal at all must show today's route from the last on-device
// snapshot instead of the browser's own "no internet" page — and must not
// then strand the rep on it once the signal comes back.
//
// Every other offline simulation in this suite (field-pending-media.spec.ts,
// field-offline-visit-start.spec.ts) aborts specific request methods via
// page.route, which never touches a full navigation's own network fetch —
// fine for a Server Action, but the worker's fallback only fires when
// fetch(event.request) itself rejects, which needs the real thing:
// context.setOffline(true). New pattern in this suite, flagged as such.
// setOffline(false) drives the recovery half — with one emulation gap that is
// not obvious and cost a debugging session to find, written up above
// deliverOnlineTransition below.
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

// The shell's own markup: #heading only exists on offline.html, and
// .greeting-header only on the real field home, so the pair tells apart "still
// on the fallback" from "back in the app" at the same URL — which is what
// recovery looks like, since the retry re-requests the page it is standing on.
const SHELL_HEADING = "#heading";
const APP_HEADER = ".greeting-header";

async function signIn(page: Page): Promise<void> {
  await page.goto(`/${TENANT_SLUG}/login`);
  await page.getByLabel("Email").fill(REP_EMAIL);
  await page.getByLabel("Password").fill(REP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**/${TENANT_SLUG}/field`);
}

async function awaitServiceWorkerControl(page: Page): Promise<void> {
  // Two different questions, checked separately rather than by one timing
  // guess: "was registration ever attempted" (an environment problem, worth
  // skipping) and "has it finished activating yet" (a real failure, worth
  // failing loud). A single bounded wait on `controller` conflates them —
  // register() only happens at all when NEXT_PUBLIC_ENABLE_SERVICE_WORKER
  // is set (see service-worker-registration.tsx), which playwright.config.ts
  // sets on its own web server, but reuseExistingServer (true outside CI)
  // means a dev server left running from before that env var existed, or
  // started by hand without it, gets silently reused with no registration
  // ever attempted — genuinely un-skippable, and a short timeout here would
  // be right to skip on. But the same short timeout would also fire on a
  // loaded CI machine where registration *did* happen and is just slow to
  // finish activating, silently skipping a run that should have failed.
  //
  // getRegistrations() answers the first question precisely: register()
  // resolves near-instantly once called, well before install/activate/claim
  // run, so a non-empty list means the attempt happened regardless of how
  // slow the rest of the lifecycle is.
  const attempted = await page
    .waitForFunction(
      async () => (await navigator.serviceWorker.getRegistrations()).length > 0,
      null,
      { timeout: 2_000 },
    )
    .then(() => true)
    .catch(() => false);

  test.skip(
    !attempted,
    "Service worker registration was never attempted — the dev server " +
      "behind this run was likely reused (reuseExistingServer) from before " +
      "NEXT_PUBLIC_ENABLE_SERVICE_WORKER existed, or started by hand " +
      "without it. Stop it and re-run so Playwright starts its own.",
  );

  // Registration is confirmed attempted, so from here a timeout is a real
  // failure, not an environment problem — no short-circuit skip, just
  // Playwright's own default timeout. By the time this resolves, sw.js's own
  // install step has already cached offline.html (install fully completes,
  // including that cache write, before activate can even run).
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test("a cold reload with no signal shows today's route from the last snapshot", async ({
  page,
  context,
}) => {
  await signIn(page);
  await awaitServiceWorkerControl(page);

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator(SHELL_HEADING)).toHaveText("Today's route");
  await expect(page.locator("#banner")).toContainText("Offline — data as of");
  await expect(page.locator("#stops")).toContainText(LOCATION_NAME);

  // The escape hatch, checked on the same footing as the route itself: on a
  // Home Screen install there is no address bar and no browser reload button,
  // so a shell with nothing to press is one a rep can only leave by
  // force-quitting the app.
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  // Same worker, same scope (the whole origin) — a tenant slug this browser
  // has never loaded online has nothing in IndexedDB to read back, so the
  // shell's other branch has to carry the message on its own rather than
  // reading anything from the (nonexistent) snapshot.
  await page.goto(`/${TENANT_SLUG}-unseen/field`);
  await expect(page.locator("#banner")).toContainText("No offline data yet");
  // The branch with no route on it is the one where the way out matters most,
  // and it is reached through renderNoData() rather than render() — so the
  // button is asserted on both paths, not just the one that drew a list.
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  await context.setOffline(false);
});

test("tapping retry with no signal still says so instead of silently doing nothing", async ({
  page,
  context,
}) => {
  await signIn(page);
  await awaitServiceWorkerControl(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(SHELL_HEADING)).toHaveText("Today's route");

  await page.getByRole("button", { name: "Try again" }).click();

  // The whole reason the retry probes the network instead of calling
  // location.reload() outright: a reload that fails is answered with this same
  // file again, so the screen would come back looking exactly as it did and a
  // rep could not tell a failed retry from a button that does nothing. The
  // status line is the difference, and the route has to survive the attempt.
  await expect(page.locator("#status")).toHaveText(
    "Still no connection. Today's route below is unchanged.",
  );
  await expect(page.locator(SHELL_HEADING)).toHaveText("Today's route");
  await expect(page.locator("#stops")).toContainText(LOCATION_NAME);

  // Back to an offerable action rather than stuck mid-check.
  await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();

  await context.setOffline(false);
});

// Chromium hands a document created under setOffline(true) a navigator.onLine
// of `true`: the emulated offline state fails requests, but is only ever
// *delivered* to frames that already existed when it was switched on. The
// shell is by definition never one of those — it exists precisely because a
// navigation just failed — so it is born believing it is online, and a later
// setOffline(false) is not a transition as far as it is concerned. No `online`
// event, however long the test waits.
//
// A real phone has no such gap: a document restored from cache in a dead zone
// reads navigator.onLine as false and is told when that changes. Toggling once
// more with the shell already on screen closes the gap rather than faking
// anything — it tells this document what is already true of the network around
// it, so the event it then receives is a real one, fired by the browser, at
// the listener under test.
async function deliverOnlineTransition(
  context: { setOffline(offline: boolean): Promise<void> },
  page: Page,
): Promise<void> {
  await context.setOffline(false);
  await context.setOffline(true);
  await page.waitForFunction(() => navigator.onLine === false);
  await context.setOffline(false);
}

test("the shell returns to the app by itself when the signal comes back", async ({
  page,
  context,
}) => {
  await signIn(page);
  await awaitServiceWorkerControl(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(SHELL_HEADING)).toHaveText("Today's route");

  await deliverOnlineTransition(context, page);

  // No click anywhere in this test: a rep who put the phone down in a dead
  // zone and picked it up in a live one should find the app, not the page they
  // left. The generous timeout covers the shell's follow-up probe schedule
  // (`online` routinely lands a beat before the radio can carry a request, so
  // the first probe is expected to miss) plus the dev server rendering the
  // field home.
  await expect(page.locator(APP_HEADER)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(SHELL_HEADING)).toHaveCount(0);
});

test("the shell recovers on foreground even when the online event never arrives", async ({
  page,
  context,
}) => {
  // The case this page was actually written for. iOS fires `online` late or
  // not at all for a standalone Home Screen install that was backgrounded
  // while the signal returned, which is why the shell listens for
  // visibilitychange as well — and a listener that is only ever redundant is
  // one nothing would notice losing.
  //
  // Swallowing the event reproduces that honestly, and keeps this test proving
  // what it claims to no matter what the harness does: registered from an init
  // script, this runs before any of the page's own scripts, so it is always
  // the first listener on window and stopImmediatePropagation() stops the
  // shell's own from ever running. Without it, a future Chromium that closed
  // the gap described above would quietly turn this into a second test of the
  // `online` path.
  await page.addInitScript(() => {
    window.addEventListener(
      "online",
      (event) => event.stopImmediatePropagation(),
      true,
    );
  });

  await signIn(page);
  await awaitServiceWorkerControl(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(SHELL_HEADING)).toHaveText("Today's route");

  await context.setOffline(false);

  // Asserting that nothing happened, which has no event to await — the wait
  // is the assertion. Without it this test would pass on the `online` path it
  // is specifically here to rule out, and prove nothing about visibilitychange.
  await page.waitForTimeout(1_500);
  await expect(page.locator(SHELL_HEADING)).toBeVisible();

  // The event is synthetic; everything it reaches is not. The shell's real
  // listener runs, reads the real document.visibilityState ("visible" for a
  // Playwright page) and probes the real network.
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(page.locator(APP_HEADER)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(SHELL_HEADING)).toHaveCount(0);
});
