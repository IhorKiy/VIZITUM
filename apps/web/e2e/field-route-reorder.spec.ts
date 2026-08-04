import { expect, test, type Page } from "@playwright/test";

// Nothing else in this suite drives route-stop-drag-list.tsx's keyboard
// reorder at all, so this pins the basic contract: two consecutive moves on
// the same handle compute correctly relative to each other (not just
// relative to the list's original order), and the result actually persists
// across a reload rather than only looking right client-side.
//
// What this does NOT pin, despite the shape of the scenario: the specific
// commit-vs-passive-effect race that route-stop-drag-list.tsx's
// useLayoutEffect (rather than useEffect) closes for orderRef. Tried both a
// bare `locator.press()` pair with no explicit wait and a fully synchronous
// double dispatchEvent from inside page.evaluate() — neither reproduces it.
// The first gives a passive effect's scheduled macrotask enough real time to
// flush before the second key event lands, because Playwright's own
// per-action latency (a CDP round trip) already exceeds that scheduling gap.
// The second goes too far the other way: two dispatchEvent calls in the same
// synchronous turn get batched by React into a single render, so neither
// effect type runs between them and both reads see the same pre-move ref
// regardless of useLayoutEffect vs useEffect (confirmed empirically against
// both). The actual window — commit and layout effects done, passive effect
// still pending — is on the order of a microtask/MessageChannel tick, and
// nothing Playwright exposes lands an event reliably inside it. Three stops
// (not two) below anyway, since it's still cheap insurance and costs
// nothing if that window is ever hit by a real, unusually fast repeat-key
// event on a real device: with two stops a second move from a stale ref
// happens to compute the same result as one from a fresh ref, so the bug
// would be invisible even if the timing did line up.

const TENANT_SLUG = "e2e-field-route-reorder";
const REP_EMAIL = `rep@${TENANT_SLUG}.local`;
const REP_PASSWORD = "E2eField12345!";
const ROUTE_TEMPLATE_NAME = "E2E Reorder Route";
const STOP_A_NAME = "E2E Reorder Stop A";
const STOP_B_NAME = "E2E Reorder Stop B";
const STOP_C_NAME = "E2E Reorder Stop C";

async function signIn(page: Page): Promise<void> {
  await page.goto(`/${TENANT_SLUG}/login`);
  await page.getByLabel("Email").fill(REP_EMAIL);
  await page.getByLabel("Password").fill(REP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**/${TENANT_SLUG}/field`);
}

function stopNames(page: Page) {
  // DOM order mirrors the drag list's own `order.map(...)` render, so this
  // is a direct read of what the component currently thinks the sequence
  // is — no separate "did it visually reorder" check needed.
  return page.locator("li.route-stop h3").allTextContents();
}

test("a fast second keyboard move reorders from the just-moved array, and the result survives a reload", async ({
  page,
}) => {
  await signIn(page);

  await page.goto(`/${TENANT_SLUG}/field/routes`);
  await page.getByRole("link", { name: ROUTE_TEMPLATE_NAME }).click();
  await expect(
    page.getByRole("heading", { name: ROUTE_TEMPLATE_NAME }),
  ).toBeVisible();

  await expect
    .poll(() => stopNames(page))
    .toEqual([STOP_A_NAME, STOP_B_NAME, STOP_C_NAME]);

  const handleA = page.getByRole("button", {
    name: `Reorder ${STOP_A_NAME}`,
  });

  // No wait between these two presses: Playwright re-locates and re-focuses
  // the handle each time by its accessible name (stable across a reorder,
  // since it's keyed to stop A itself, not to whichever DOM position
  // currently holds it). Not waiting doesn't land inside the specific race
  // window described above (see the file header) — it's just the more
  // realistic simulation of a rep tapping the arrow key twice in quick
  // succession, which the assertion below still has to compute correctly.
  await handleA.press("ArrowDown");
  await handleA.press("ArrowDown");

  // A moved down twice: B, C, A.
  await expect
    .poll(() => stopNames(page))
    .toEqual([STOP_B_NAME, STOP_C_NAME, STOP_A_NAME]);

  // Both moves persist via a Server Action (see reorderTemplateStopsAction
  // in page.tsx); wait for that traffic to settle before reloading, or the
  // reload could race an in-flight request and read back a stale order.
  await page.waitForLoadState("networkidle");

  await page.reload();
  await expect
    .poll(() => stopNames(page))
    .toEqual([STOP_B_NAME, STOP_C_NAME, STOP_A_NAME]);
});
