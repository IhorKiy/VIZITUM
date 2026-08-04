import { expect, test, type Page } from "@playwright/test";

import { LOGIN_REDIRECT_SEED_ARGS } from "./global-setup";

// Opening a login screen while already signed in.
//
// Every redirect in this flow used to live inside the login server action,
// which only runs on submit — so a plain GET of `/{tenantSlug}/login` always
// drew the form. Found on a real iPhone during the offline pass
// (docs/runbooks/field-offline-iphone-test.md): a Home Screen install restores
// its last URL on launch and has no address bar, so after an offline episode
// the app read as signed out while the session cookie was present, unexpired
// and good enough to fetch the field home. The only visible move was to retype
// the password, which also minted a second session row for nothing.
//
// Not unit-testable, and that is the point of doing it here: the decision
// itself is pinned by tests/web-login-signed-in-redirect.test.ts, but what a
// unit test cannot show is that the destination *terminates* — that following
// the redirect lands on a rendered screen instead of bouncing back here. So
// each case below is asserted through a real navigation, and Playwright fails
// a redirect loop rather than passing it.
//
// Reads its own tenant and never mutates anything beyond signing in.

const [TENANT_SLUG] = LOGIN_REDIRECT_SEED_ARGS;
const REP_EMAIL = `rep@${TENANT_SLUG}.local`;
const REP_PASSWORD = "E2eField12345!";
// Another spec's tenant, used as a URL only — no sign-in, no state touched.
// It just has to be a workspace that exists and is not the one below.
const OTHER_TENANT_SLUG = "e2e-field-revisit";

const passwordField = (page: Page) => page.getByLabel("Password");

async function signIn(page: Page): Promise<void> {
  await page.goto(`/${TENANT_SLUG}/login`);
  await page.getByLabel("Email").fill(REP_EMAIL);
  await passwordField(page).fill(REP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**/${TENANT_SLUG}/field`);
}

test("a live session opening the login screen lands where signing in would", async ({
  page,
}) => {
  await signIn(page);

  // The bug, reproduced the way the phone did it: navigate straight back to
  // the login URL with the session still good.
  await page.goto(`/${TENANT_SLUG}/login`);

  await expect(page).toHaveURL(new RegExp(`/${TENANT_SLUG}/field$`));
  await expect(passwordField(page)).toHaveCount(0);
});

test("a shouted slug still resolves, and lands on the canonical one", async ({
  page,
}) => {
  await signIn(page);

  await page.goto(`/${TENANT_SLUG.toUpperCase()}/login`);

  // Lowercase: the redirect must not carry the shouting forward into every
  // URL the reader gets afterwards.
  await expect(page).toHaveURL(new RegExp(`/${TENANT_SLUG}/field$`));
});

test("an anonymous visitor is left on the form", async ({ page }) => {
  // The anti-enumeration half. With no session there is nothing to resolve,
  // so this screen behaves exactly as it did before the redirect existed and
  // cannot be used to ask whether a workspace or an account is real.
  await page.goto(`/${TENANT_SLUG}/login`);

  await expect(page).toHaveURL(new RegExp(`/${TENANT_SLUG}/login$`));
  await expect(passwordField(page)).toBeVisible();
});

test("a session for another workspace is left on that workspace's form", async ({
  page,
}) => {
  await signIn(page);

  // A real, valid session — for somewhere else. The session cookie carries
  // the tenant and the URL does not, so acting on it would show one tenant's
  // data under another's address and branding, and would strand the very
  // reader this form is for.
  await page.goto(`/${OTHER_TENANT_SLUG}/login`);

  await expect(page).toHaveURL(new RegExp(`/${OTHER_TENANT_SLUG}/login$`));
  await expect(passwordField(page)).toBeVisible();
});
