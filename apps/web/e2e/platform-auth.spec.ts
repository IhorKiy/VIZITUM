import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { generateSync } from "otplib";

// End-to-end contract for the platform console auth flow, driven through the
// real login/logout Server Actions. The logout tests pin the "fake logout"
// class of bug fixed across PR #38 (browser must not keep a working session
// cookie) and PR #39 (the backend must revoke the session even when the
// readable CSRF cookie is gone): each one captures the httpOnly session
// cookie before signing out and proves that restoring it afterwards no
// longer opens the console.

const OWNER_EMAIL =
  process.env.E2E_PLATFORM_OWNER_EMAIL ?? "owner@platform.local";
const OWNER_PASSWORD = process.env.E2E_PLATFORM_OWNER_PASSWORD ?? "Owner12345!";
const SESSION_COOKIE_NAME = "vizitum_platform_session";
const CSRF_COOKIE_NAME = "vizitum_platform_csrf";

// The password is only the first step now: the console requires a second
// factor, and the seeded owner starts unenrolled (see
// scripts/seed-platform-owner.mjs), so every run walks the enrolment path.
// That is deliberate — it is the journey a real owner takes exactly once, and
// the one where getting it wrong locks them out of every tenant.
async function signIn(page: Page): Promise<void> {
  await page.goto("/platform/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/platform/login?step=enroll");

  // The manual-entry key the page offers for "can't scan it?" is the same
  // secret the QR encodes, so the test can act as the authenticator app.
  const secret = (await page.locator("code.copyable-value").innerText()).trim();

  await page
    .getByLabel("Six-digit code")
    .fill(generateSync({ strategy: "totp", secret }));
  await page.getByRole("button", { name: "Confirm and sign in" }).click();

  await page.waitForURL("**/platform/recovery-codes");
  await page
    .getByRole("button", { name: "I have saved them — continue" })
    .click();
  await page.waitForURL("**/platform/tenants");
}

async function readCookie(context: BrowserContext, name: string) {
  const cookies = await context.cookies();

  return cookies.find((cookie) => cookie.name === name);
}

test("rejects a wrong password without creating a session", async ({
  page,
  context,
}) => {
  await page.goto("/platform/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/platform/login?error=invalid");
  // Not getByRole("alert"): Next's route announcer is a second, permanent
  // role=alert element, so the role lookup is ambiguous under strict mode.
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  expect(await readCookie(context, SESSION_COOKIE_NAME)).toBeUndefined();
});

test("signs in to the tenant console and issues both auth cookies", async ({
  page,
  context,
}) => {
  await signIn(page);

  await expect(page).toHaveURL(/\/platform\/tenants/);
  expect(await readCookie(context, SESSION_COOKIE_NAME)).toBeDefined();
  expect(await readCookie(context, CSRF_COOKIE_NAME)).toBeDefined();
});

test("logout revokes the session server-side, not just in the browser", async ({
  page,
  context,
}) => {
  await signIn(page);

  const sessionCookie = await readCookie(context, SESSION_COOKIE_NAME);
  expect(sessionCookie).toBeDefined();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/platform/login");

  expect(await readCookie(context, SESSION_COOKIE_NAME)).toBeUndefined();
  expect(await readCookie(context, CSRF_COOKIE_NAME)).toBeUndefined();

  // The decisive check: put the old session cookie back. If logout only
  // cleared the browser (the PR #38 bug), the console would still open.
  await context.addCookies([sessionCookie!]);
  await page.goto("/platform/tenants");
  await page.waitForURL("**/platform/login");
});

test("logout still fully signs out when the CSRF cookie is missing", async ({
  page,
  context,
}) => {
  await signIn(page);

  const sessionCookie = await readCookie(context, SESSION_COOKIE_NAME);
  expect(sessionCookie).toBeDefined();

  // The original repro from PR #38: a stale/missing readable CSRF cookie
  // while the httpOnly session cookie is still valid. Logout is CSRF-exempt
  // since PR #39, so this must behave exactly like a normal logout.
  await context.clearCookies({ name: CSRF_COOKIE_NAME });

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/platform/login");

  expect(await readCookie(context, SESSION_COOKIE_NAME)).toBeUndefined();

  await context.addCookies([sessionCookie!]);
  await page.goto("/platform/tenants");
  await page.waitForURL("**/platform/login");
});
