import { expect, test, type Page } from "@playwright/test";

// The routes list moved off /field/planning onto its own screen, reached from
// the field menu.
// Links written for the old combined screen — a bookmark, a `from` origin
// already handed out, a redirect still in flight from a server action — keep
// naming the old path, so the planning screen forwards them instead of
// silently landing the reader on the calendar.
//
// This is the only guarantee those links still arrive where they meant to, and
// it cannot be unit-tested: the forwarding lives in the page's own request
// handling. The checks navigate with crafted params and mutate no data — the
// shared field tenant (seeded in global-setup.ts) is only needed for a
// signed-in rep.

const TENANT_SLUG = "e2e-field-revisit";
const REP_EMAIL = "rep@e2e-field-revisit.local";
const REP_PASSWORD = "E2eField12345!";

async function signIn(page: Page): Promise<void> {
  await page.goto(`/${TENANT_SLUG}/login`);
  await page.getByLabel("Email").fill(REP_EMAIL);
  await page.getByLabel("Password").fill(REP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**/${TENANT_SLUG}/field`);
}

test("links written for the old combined planning screen still arrive", async ({
  page,
}) => {
  await signIn(page);

  // The bare routes tab.
  await page.goto(`/${TENANT_SLUG}/field/planning?tab=routes`);
  await expect(page).toHaveURL(`/${TENANT_SLUG}/field/routes`);
  await expect(page.getByRole("heading", { name: "My routes" })).toBeVisible();

  // A deep link into one route's stop editor keeps the route it named, with or
  // without the tab param that used to accompany it.
  for (const legacy of [
    `${TENANT_SLUG}/field/planning?tab=routes&route=missing-route`,
    `${TENANT_SLUG}/field/planning?route=missing-route`,
  ]) {
    await page.goto(`/${legacy}`);
    await expect(page).toHaveURL(
      `/${TENANT_SLUG}/field/routes?route=missing-route`,
    );
  }

  // A redirect still in flight from a server action carries its notice through
  // the forward — landing on the routes screen without the confirmation would
  // read as "nothing happened".
  await page.goto(
    `/${TENANT_SLUG}/field/planning?tab=routes&template=item-added`,
  );
  await expect(page).toHaveURL(
    `/${TENANT_SLUG}/field/routes?template=item-added`,
  );
  await expect(page.locator(".notice-inline.success")).toContainText(
    "Stop added",
  );

  // Everything else still belongs to the calendar, which now opens on it
  // directly rather than on a tab.
  await page.goto(`/${TENANT_SLUG}/field/planning`);
  await expect(page).toHaveURL(`/${TENANT_SLUG}/field/planning`);
  await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
});
