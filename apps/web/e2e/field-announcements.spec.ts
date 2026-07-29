import { expect, test, type Page } from "@playwright/test";

// The notice board split in two: the home screen keeps only what the rep has
// not acknowledged, and the whole board — read ones included — moved to
// /field/announcements off the field menu.
//
// Neither half is unit-testable: the filter lives in the home page's own data
// handling, and the screen is a server component with a server action behind
// its "Got it" button. The checks read the pair of notices global-setup.ts
// seeds (one unread, one already read) and mutate nothing — which is a
// requirement here, not a convenience: field-revisit.spec.ts re-seeds this
// tenant in its own beforeAll, and under fullyParallel that can land at any
// point in this file's run. Reading state the seed converges on is safe;
// acknowledging a notice from here would race it. A test that needs to click
// "Got it" needs its own fixture — see the note in field-revisit.spec.ts.

const TENANT_SLUG = "e2e-field-revisit";
const REP_EMAIL = "rep@e2e-field-revisit.local";
const REP_PASSWORD = "E2eField12345!";
const UNREAD_TITLE = "E2E notice still unread";
const READ_TITLE = "E2E notice already read";

async function signIn(page: Page): Promise<void> {
  await page.goto(`/${TENANT_SLUG}/login`);
  await page.getByLabel("Email").fill(REP_EMAIL);
  await page.getByLabel("Password").fill(REP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**/${TENANT_SLUG}/field`);
}

test("the home screen carries only the unread notices", async ({ page }) => {
  await signIn(page);

  // The unread one sits open above the route, with the acknowledge button that
  // is the only reason it is on this screen at all.
  const feed = page.locator(".announcement-feed");
  await expect(feed.getByRole("heading", { name: UNREAD_TITLE })).toBeVisible();
  await expect(feed.getByRole("button", { name: "Got it" })).toBeVisible();

  // The acknowledged one is gone from here entirely — not folded away, which
  // is what it used to be: a row on top of the day's route either way.
  await expect(page.getByText(READ_TITLE)).toHaveCount(0);
  await expect(page.locator(".announcement-feed-read")).toHaveCount(0);
});

test("the board screen lists the acknowledged notices too", async ({
  page,
}) => {
  await signIn(page);

  // Opened the way a rep opens it: from the menu, on whichever screen they had.
  await page.goto(`/${TENANT_SLUG}/field/tasks`);
  await page.getByRole("button", { name: "Menu" }).click();
  // Scoped to the drawer: the Home nav item carries the unread count as
  // "Unread announcements: 1", so an unscoped name match hits it too.
  await page
    .getByRole("dialog", { name: "Menu" })
    .getByRole("link", { name: "Announcements" })
    .click();
  await page.waitForURL(`**/${TENANT_SLUG}/field/announcements?from=*`);

  await expect(
    page.getByRole("heading", { name: "Announcements", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: UNREAD_TITLE })).toBeVisible();

  // The read half is listed rather than folded: on the screen that exists to
  // show the board, a disclosure would hide most of it.
  await expect(page.locator("details.announcement-feed-read")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: READ_TITLE })).toBeVisible();
  await expect(page.locator(".announcement-feed-read-list")).toContainText(
    "Already read (1)",
  );

  // And the back control names the screen the menu was opened on, not the home
  // route it falls back to on a deep link.
  const back = page.getByRole("link", { name: "Back to tasks" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(`/${TENANT_SLUG}/field/tasks`);
});

test("a failed acknowledgement says so on the board screen", async ({
  page,
}) => {
  await signIn(page);

  // The shape the screen's own server action redirects with, carried straight
  // to the URL so the notice is checked without failing a real request.
  await page.goto(
    `/${TENANT_SLUG}/field/announcements?announcement=failed&from=%2Ffield%2Ftasks`,
  );

  await expect(page.locator(".notice-panel.danger")).toContainText(
    "Could not mark it read",
  );
  // The origin survives the failed round-trip — the point of threading it
  // through the redirect rather than dropping it there.
  await expect(page.getByRole("link", { name: "Back to tasks" })).toBeVisible();
});
