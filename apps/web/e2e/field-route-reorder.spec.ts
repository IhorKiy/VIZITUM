import { expect, test, type Page, type Response } from "@playwright/test";

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
// The two presses below still wait for the first move's Server Action to
// settle, and still reload in between, but not to dodge a request race —
// commitOrder no longer fires unsequenced requests (see
// useSerializedReorder in apps/web/lib/use-serialized-reorder.ts), so
// there's nothing left here to race. The wait-and-reload stays because it
// also proves persistence at each intermediate step, not only at the end —
// see the next two paragraphs. The unthrottled case (no wait, no reload
// between moves — exactly the shape that used to be flaky in CI) is its own
// test further down; that one is what actually exercises the fix.
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
// A separate template with its own stops, not the one above: this file's
// two tests would otherwise both reorder the same rows, and
// playwright.config.ts runs with fullyParallel: true, so they can execute
// concurrently in different workers.
// Not "E2E Reorder Route Rapid": that has ROUTE_TEMPLATE_NAME as a prefix,
// and getByRole's string matcher is substring-by-default, so the other
// test's getByRole("link", { name: ROUTE_TEMPLATE_NAME }) would resolve to
// both this card and its own.
const RAPID_ROUTE_TEMPLATE_NAME = "E2E Rapid Reorder Route";
const RAPID_STOP_A_NAME = "E2E Reorder Rapid Stop A";
const RAPID_STOP_B_NAME = "E2E Reorder Rapid Stop B";
const RAPID_STOP_C_NAME = "E2E Reorder Rapid Stop C";

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

// Waits for `count` reorder POST responses, however far apart they land —
// unlike waitForLoadState("networkidle"), which only watches requests
// already in flight and has no way to know a further one is coming.
// useSerializedReorder queues a second rapid move behind the first rather
// than sending it immediately, and the gap between the first response and
// the second request's dispatch is real network-request-count-blind time
// (see the file header), not just network latency — long enough that
// networkidle's 500ms-of-silence check already resolved once, here, before
// the second request had even been sent. Counting responses instead of
// watching for silence has no such blind spot.
function waitForReorderResponses(page: Page, count: number): Promise<void> {
  let seen = 0;

  return new Promise((resolve) => {
    function onResponse(response: Response) {
      if (
        response.request().method() !== "POST" ||
        !response.url().includes("/field/routes")
      ) {
        return;
      }

      seen += 1;

      if (seen >= count) {
        page.off("response", onResponse);
        resolve();
      }
    }

    page.on("response", onResponse);
  });
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

// Regression test for the request race useSerializedReorder closes: two
// moves fired back to back, no wait and no reload between them — the exact
// shape that reproduced the bug in CI per #226 (whichever request's
// transaction committed last won, regardless of which move was newer, so
// this could persist B, A, C — the first move's order — instead of B, C, A).
//
// Same limitation as the ref-timing race above: this does not reproduce
// locally. Tried forcing it by delaying the first request's response via
// page.route() (to make a fast second request definitely race ahead of a
// held-back first one) — that doesn't work, and not because of luck: the
// delay measurably pushes back *when the second request is even sent*, by
// close to the same amount (confirmed at both 800ms and 2000ms artificial
// delays). Something in startTransition's own action-queue plumbing already
// couples these two dispatches under normal conditions, before either
// reaches the network — which page.route() has no way to see, let alone
// intervene in. Whatever narrow window let the two truly race in CI, it's
// upstream of the network layer and not one this test can force open. So
// this stays exactly the shape that already reproduced the bug for real —
// no synthetic help — trusting that evidence over a synthetic setup that
// turned out to demonstrate a different thing than intended.
//
// First CI run of this test (still failed, but a different failure than the
// one it's here to catch): waitForLoadState("networkidle") resolved, and the
// reload right after it aborted the second reorder request mid-dispatch —
// confirmed from the trace (a second POST that started ~1.5s after the
// first response and got status -1). That gap is exactly the action-queue
// coupling noted above: useSerializedReorder queues the second move behind
// the first rather than sending it immediately, and networkidle only
// watches requests already in flight — it has no way to know a further one
// is coming once the first has gone quiet. waitForReorderResponses below
// counts responses instead, so it keeps waiting across that gap.
test("two rapid keyboard moves with no wait between them still persist the last move, not a stale one that raced it", async ({
  page,
}) => {
  await signIn(page);

  await page.goto(`/${TENANT_SLUG}/field/routes`);
  await page.getByRole("link", { name: RAPID_ROUTE_TEMPLATE_NAME }).click();
  await expect(
    page.getByRole("heading", { name: RAPID_ROUTE_TEMPLATE_NAME }),
  ).toBeVisible();

  await expect
    .poll(() => stopNames(page))
    .toEqual([RAPID_STOP_A_NAME, RAPID_STOP_B_NAME, RAPID_STOP_C_NAME]);

  const handleA = page.getByRole("button", {
    name: `Reorder ${RAPID_STOP_A_NAME}`,
  });

  // Armed before either press, not after: the two presses have no wait
  // between them, so the first request can already be under way by the time
  // this line runs, and a listener attached afterward could miss it.
  const bothReordersSettled = waitForReorderResponses(page, 2);

  // No wait between these two presses, and no reload either — see the file
  // header for why this specific shape is what actually exercises the fix.
  await handleA.press("ArrowDown");
  await handleA.press("ArrowDown");

  // Not proof either request's write landed the way the assertion below
  // expects (see the file header on why a network wait can't prove the
  // client caught up) — only that reloading now won't abort one that's
  // still sending, or hasn't even been sent yet.
  await bothReordersSettled;
  await page.reload();

  // A moved down twice: B, C, A — the only outcome a correct
  // implementation can produce, regardless of which request's transaction
  // actually committed last.
  await expect
    .poll(() => stopNames(page))
    .toEqual([RAPID_STOP_B_NAME, RAPID_STOP_C_NAME, RAPID_STOP_A_NAME]);
});
