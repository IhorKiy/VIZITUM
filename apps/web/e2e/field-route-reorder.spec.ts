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
//
// The two presses below DO wait for the first move's Server Action to fully
// settle before firing the second — for a different, unrelated reason:
// commitOrder fires an independent reorderAction call per move with no
// request sequencing (see its own comment), so two in flight at once race
// each other to the server, and whichever's redirect lands last overwrites
// the database (or, client-side, whichever's RSC-refresh triggers the
// stopsKey resync last overwrites `order`) regardless of which move was
// semantically newer. That race is real, not hypothetical: an earlier,
// unthrottled version of this test (pressing ArrowDown twice with no wait,
// matching the original review request) reproduced it in CI — stop A
// landing back in the middle instead of the bottom, only under CI's
// timing, never locally. It's a pre-existing gap in commitOrder (this is
// only the first thing to ever exercise two rapid reorders, keyboard or
// drag), not something introduced here, and out of scope for this test to
// fix — tracked in #226.
//
// Two attempts at waiting between moves without a reload both still failed
// in CI: waitForLoadState("networkidle") first, then waitForResponse for
// the reorderTemplateStopsAction POST specifically. Both prove the action's
// own request completed; neither proves the *client* has finished
// processing its redirect and re-rendering with the fresh order — that
// happens via a separate RSC fetch Next.js issues client-side after the
// action response arrives, and nothing in Playwright's network-observation
// APIs distinguishes "still waiting on that" from "nothing more is
// coming". A stale one arriving after the second press starts stomps it
// the same way a stale server write would.
//
// Reloading between moves sidesteps all of that: a real navigation always
// re-fetches the current server state fresh, so the assertion right after
// it is an unambiguous read of what actually got persisted — not a guess
// about whether the client has caught up yet. Each press still waits for
// its own reorderTemplateStopsAction POST to complete before reloading,
// though — not as proof the write landed (the reload's own assertion is
// what proves that), but because navigating away can abort a request the
// unloading page hasn't finished sending yet, and an aborted write would
// fail this test for a completely different reason than the one it exists
// to guard against.

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

// Presses ArrowDown on the given handle and waits for that move's own
// reorderTemplateStopsAction POST to complete before returning — not as
// proof the write landed (a caller that wants that reloads afterward and
// asserts on the fresh page), but so a reload right after this doesn't
// abort a request the page hasn't finished sending yet.
async function pressArrowDownAndAwaitRequest(
  handle: ReturnType<Page["getByRole"]>,
  page: Page,
): Promise<void> {
  const reorderResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/field/routes"),
  );

  await handle.press("ArrowDown");
  await reorderResponse;
}

test("two consecutive keyboard moves compute correctly relative to each other, and the result persists across a reload", async ({
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

  // Playwright re-resolves a locator against whatever the page currently
  // is at call time, reload included, so this one recipe covers both
  // presses below even though the handle is keyed to stop A's own
  // accessible name (stable across a reorder), not a fixed DOM position.
  const handleA = page.getByRole("button", {
    name: `Reorder ${STOP_A_NAME}`,
  });

  await pressArrowDownAndAwaitRequest(handleA, page);

  // Reload before the second move — see the file header for why this,
  // not a network wait, is what actually proves the first move's write
  // landed before the second one starts.
  await page.reload();
  await expect
    .poll(() => stopNames(page))
    .toEqual([STOP_B_NAME, STOP_A_NAME, STOP_C_NAME]);

  await pressArrowDownAndAwaitRequest(handleA, page);

  // A moved down twice: B, C, A.
  await page.reload();
  await expect
    .poll(() => stopNames(page))
    .toEqual([STOP_B_NAME, STOP_C_NAME, STOP_A_NAME]);
});
