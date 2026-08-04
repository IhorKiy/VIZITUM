import { expect, test } from "@playwright/test";

// The four public pages — two marketing landings, two workspace entry screens
// — render with no session, no tenant and no API call between them.
//
// They sit under their own root layout (app/(public)/layout.tsx), which mounts
// no NextIntlClientProvider: that is what keeps the landings prerenderable
// instead of costing a serverless render per crawl. The entry screens still
// need one, because the shared PendingSubmitButton inside them reads `common`
// through useTranslations, so each pins a provider carrying that namespace
// alone.
//
// Which is exactly the arrangement that cannot be unit-tested and fails
// invisibly: a missing namespace throws during render, so the page 500s while
// every other screen — living under the other root layout, with the full
// provider — keeps working. Nothing else in the suite loads these four URLs.
// Signed out on purpose; they must not need a session to answer.

test("the marketing landings render in their own language", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("main")).toHaveAttribute("lang", "uk");

  await page.goto("/en");
  await expect(page.locator("main")).toHaveAttribute("lang", "en");
});

// The contact address is the only way a reader with no workspace can reach
// anyone, and it is printed rather than fetched — so the failure mode is a
// page that still renders fine while quietly offering no way to get in touch.
test("both landings offer the contact address", async ({ page }) => {
  for (const path of ["/", "/en"]) {
    await page.goto(path);
    const contact = page.locator(".landing-contact-link");
    await expect(contact).toHaveText("support@vizitum.com");
    await expect(contact).toHaveAttribute(
      "href",
      /^mailto:support@vizitum\.com\?subject=./,
    );
  }
});

test("both workspace entry screens render their form", async ({ page }) => {
  // The submit button is the assertion that matters: it is the one control
  // fed by the pinned provider rather than by props.
  await page.goto("/sign-in");
  await expect(page.locator("main")).toHaveAttribute("lang", "uk");
  await expect(page.locator('input[name="workspace"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();

  await page.goto("/en/sign-in");
  await expect(page.locator("main")).toHaveAttribute("lang", "en");
  await expect(page.locator('input[name="workspace"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});
