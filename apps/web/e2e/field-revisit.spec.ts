import { expect, test, type Page } from "@playwright/test";

// End-to-end contract for revisiting an already-visited route stop: marking a
// stop visited must not lock the location out of new visits. The rep keeps a
// (secondary) "Start another visit" action that opens a fresh visit — created
// WITHOUT a route-item link, because visits.routeItemId is unique and the
// stop's own visit slot may already be taken.
//
// Seeded by scripts/seed-e2e-field-revisit.mjs (run from global-setup.ts,
// once per run before any worker starts — a per-file re-seed could wipe
// state mid-assertion under fullyParallel): dedicated tenant (en locale),
// one field rep, one assigned location on today's route as a planned stop.
// The seed resets route-item status and leftover visits, so the flow below
// always starts from "planned".

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

test("an already-visited stop still allows starting another visit", async ({
  page,
}) => {
  await signIn(page);

  // Open the stop from today's route; the link carries routePlanId/routeItemId.
  await page
    .getByRole("link", { name: `View ${LOCATION_NAME}` })
    .first()
    .click();
  await page.waitForURL("**/field/locations/**");

  // Mark the stop visited without starting a visit (the flow that used to
  // dead-end the location).
  await page.getByRole("button", { name: "Mark as visited" }).click();
  await page.waitForURL("**visited=1**");
  await expect(page.getByText("Stop marked as visited")).toBeVisible();
  await expect(
    page.getByText("This stop is already marked visited today."),
  ).toBeVisible();

  // The primary CTA and the mark-visited button are gone, but the repeat
  // action is available.
  await expect(
    page.getByRole("button", { name: "Mark as visited" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start visit", exact: true }),
  ).toHaveCount(0);

  const repeatButton = page.getByRole("button", {
    name: "Start another visit",
  });
  await expect(repeatButton).toBeVisible();

  // Starting the repeat visit opens a fresh visit report form.
  await repeatButton.click();
  await page.waitForURL("**/field/visits/**");
  await expect(
    page.getByRole("heading", { name: LOCATION_NAME }),
  ).toBeVisible();
});
