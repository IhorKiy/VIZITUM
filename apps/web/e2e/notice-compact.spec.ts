import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

// Smoke contract for the DismissableNotice compact default: a title-only
// success confirmation renders as the compact one-line variant, while a
// success notice whose body carries real data (counts) and any danger notice
// keep the boxed panel. The notices are driven purely by the query params the
// server actions redirect with, so the checks navigate with crafted params
// and mutate no data.

const TENANT_SLUG = "e2e-field-revisit";
const REP_EMAIL = "rep@e2e-field-revisit.local";
const REP_PASSWORD = "E2eField12345!";

test.beforeAll(() => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");

  execFileSync("node", ["scripts/seed-e2e-field-revisit.mjs"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
});

async function signIn(page: Page): Promise<void> {
  await page.goto(`/${TENANT_SLUG}/login`);
  await page.getByLabel("Email").fill(REP_EMAIL);
  await page.getByLabel("Password").fill(REP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**/${TENANT_SLUG}/field`);
}

test("success confirmations compact to one line; content keeps the panel", async ({
  page,
}) => {
  await signIn(page);

  // Title-only success confirmation → the compact single line, no panel.
  await page.goto(`/${TENANT_SLUG}/field/tasks?task=created`);
  await expect(page.locator(".notice-inline.success")).toHaveText(
    "Task added to your queue",
  );
  await expect(page.locator(".notice-panel")).toHaveCount(0);

  // Success notice whose body carries data (copy counts) → still the boxed
  // panel; compacting it would silently drop the counts.
  await page.goto(
    `/${TENANT_SLUG}/field/planning?tab=planning&planning=copied:3:2`,
  );
  await expect(page.locator(".notice-panel.success")).toContainText(
    "Added 3, skipped 2.",
  );
  await expect(page.locator(".notice-inline")).toHaveCount(0);

  // Danger notice → still the boxed panel, and it must not auto-dismiss.
  await page.goto(`/${TENANT_SLUG}/field/tasks?error=task`);
  await expect(page.locator(".notice-panel.danger")).toContainText(
    "Follow-up update failed",
  );
  await expect(page.locator(".notice-inline")).toHaveCount(0);
});
