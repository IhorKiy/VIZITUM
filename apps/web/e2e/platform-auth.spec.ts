import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { generateSync } from "otplib";

import {
  E2E_PLATFORM_ENROLL_EMAIL,
  E2E_PLATFORM_ENROLL_PASSWORD,
  E2E_PLATFORM_SESSION_EMAILS,
  E2E_PLATFORM_TOTP_SECRET,
} from "./global-setup";

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
// factor. These accounts are seeded already enrolled against a known secret
// (see global-setup.ts), so the helper acts as the authenticator app.
//
// Each caller passes its own account. They cannot share one: the password
// step issues a challenge and drops any outstanding one for that account, so
// two specs mid-login would knock each other's out under fullyParallel. The
// enrolment journey has its own account again, since enrolment happens once.
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/platform/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/platform/login?step=mfa");
  await page
    .getByLabel("Six-digit code")
    .fill(generateSync({ strategy: "totp", secret: E2E_PLATFORM_TOTP_SECRET }));
  await page.getByRole("button", { name: "Verify and sign in" }).click();

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
  await signIn(page, E2E_PLATFORM_SESSION_EMAILS[0]);

  await expect(page).toHaveURL(/\/platform\/tenants/);
  expect(await readCookie(context, SESSION_COOKIE_NAME)).toBeDefined();
  expect(await readCookie(context, CSRF_COOKIE_NAME)).toBeDefined();
});

test("logout revokes the session server-side, not just in the browser", async ({
  page,
  context,
}) => {
  await signIn(page, E2E_PLATFORM_SESSION_EMAILS[1]);

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
  await signIn(page, E2E_PLATFORM_SESSION_EMAILS[2]);

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

test("a live session opening the login screen lands in the console", async ({
  page,
}) => {
  await signIn(page, E2E_PLATFORM_SESSION_EMAILS[3]);

  // Same gap the tenant login screen had: every redirect here lives in an
  // action, which only runs on submit, so opening this URL signed in drew the
  // sign-in form. Asserted through a real navigation because what matters is
  // that the destination terminates — /platform/tenants only sends people
  // back here when the session check fails, which is the case that renders
  // the form (the two tests above pin that direction).
  await page.goto("/platform/login");
  await expect(page).toHaveURL(/\/platform\/tenants/);
  await expect(page.getByLabel("Password")).toHaveCount(0);

  // A step left in the URL doesn't reopen the flow either: a session exists
  // only past the second factor, so any challenge still in a cookie is spent,
  // and "you are signed in" beats restarting with an expiry notice.
  await page.goto("/platform/login?step=mfa");
  await expect(page).toHaveURL(/\/platform\/tenants/);
});

test("a correct password alone does not open the console", async ({
  page,
  context,
}) => {
  await page.goto("/platform/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // One account behind this login reaches every tenant's data, so the
  // password is a step, not the door.
  await page.waitForURL("**/platform/login?step=mfa");
  expect(await readCookie(context, SESSION_COOKIE_NAME)).toBeUndefined();

  await page.getByLabel("Six-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify and sign in" }).click();

  // A wrong code spends the challenge, so the attempt restarts from the
  // password — a six-digit code must not be guessable at speed.
  await page.waitForURL("**/platform/login?error=code");
  expect(await readCookie(context, SESSION_COOKIE_NAME)).toBeUndefined();
});

test("an owner with no authenticator must enrol before getting a session", async ({
  page,
  context,
}) => {
  // Its own account: enrolment happens once, and this suite runs
  // fullyParallel, so sharing the owner above would make the outcome depend
  // on which spec reached it first.
  await page.goto("/platform/login");
  await page.getByLabel("Email").fill(E2E_PLATFORM_ENROLL_EMAIL);
  await page.getByLabel("Password").fill(E2E_PLATFORM_ENROLL_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/platform/login?step=enroll");
  expect(await readCookie(context, SESSION_COOKIE_NAME)).toBeUndefined();

  // The manual-entry key the page offers for "can't scan it?" is the same
  // secret the QR encodes, so the test can act as the authenticator app.
  const secret = (await page.locator("code.copyable-value").innerText()).trim();

  await page
    .getByLabel("Six-digit code")
    .fill(generateSync({ strategy: "totp", secret }));
  await page.getByRole("button", { name: "Confirm and sign in" }).click();

  // The recovery codes exist in readable form exactly here and never again.
  await page.waitForURL("**/platform/recovery-codes");
  await expect(page.locator("code.copyable-value")).toHaveCount(10);

  await page
    .getByRole("button", { name: "I have saved them — continue" })
    .click();
  await page.waitForURL("**/platform/tenants");
  expect(await readCookie(context, SESSION_COOKIE_NAME)).toBeDefined();
});
