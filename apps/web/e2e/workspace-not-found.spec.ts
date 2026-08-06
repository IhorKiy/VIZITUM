import { expect, test } from "@playwright/test";

import enMessages from "../messages/en.json";

// A workspace address that is not slug-shaped is refused by
// `[tenantSlug]/layout.tsx`, which calls `notFound()`. That call is a security
// check rather than a typo handler: it is what stopped `/acme.js` rendering
// the authenticated app with no Content-Security-Policy, and
// `tests/web-tenant-slug-shape.test.ts` asserts readers are sent there.
//
// Where they landed was Next's built-in page — unstyled, English, no branding
// and no way back. On the primary device that is served inside an installed
// `display: "standalone"` app, which has no address bar to retype an address
// into, so "no way back" meant exactly that (audit F26).
//
// Signed out on purpose: a reader who mistyped a workspace address has no
// session, and this screen must answer without one. That is also what lets
// this spec live outside the authenticated harness entirely.
//
// The boundary's *placement* is what these pin, and it is easy to get wrong in
// a way nothing else notices: a `not-found.tsx` inside `[tenantSlug]` would be
// wrapped by the very layout that throws and could never render, silently
// falling back to Next's default. Only the parent group's boundary works.

const NOT_FOUND = enMessages.common.notFound;

test("an address that is not slug-shaped answers 404 with the app's own screen", async ({
  page,
}) => {
  const response = await page.goto("/Acme_Corp/field");

  // The status matters as much as the screen: this is a real 404, not a
  // soft one rendered under a 200.
  expect(response?.status()).toBe(404);

  await expect(
    page.getByRole("heading", { name: NOT_FOUND.title, level: 1 }),
  ).toBeVisible();
});

test("that screen offers a way back into the product", async ({ page }) => {
  // The load-bearing half. Without a link there is nothing to tap in a
  // standalone install, and the reader is stuck on a dead screen.
  await page.goto("/Acme_Corp/field");

  await page.getByRole("link", { name: NOT_FOUND.action }).click();

  await page.waitForURL("**/sign-in");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a slug-shaped address is untouched", async ({ page }) => {
  // The negative that keeps the guard from being over-tightened into
  // refusing real workspaces. `demo-team` is seeded by the e2e setup; it need
  // not be reachable without a session, only *not* be a 404.
  const response = await page.goto("/demo-team");

  expect(response?.status()).not.toBe(404);
});
