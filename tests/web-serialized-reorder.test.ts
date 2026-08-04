import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ordersMatch } from "../apps/web/lib/use-serialized-reorder";

// The exact comparison useSerializedReorder's commitReorder uses to decide
// whether an incoming route-stop move is a genuine change worth sending, or
// a no-op relative to what the hook has already committed to sending — not
// relative to the caller's own, possibly still-stale, server prop. See the
// hook's own header comment for the bug that distinction fixes: a move that
// reverts to the original order before the first send settles used to be
// read as no change at all, and silently never sent.
describe("ordersMatch (web)", () => {
  it("is true for identical id sequences", () => {
    assert.equal(ordersMatch(["a", "b", "c"], ["a", "b", "c"]), true);
  });

  it("is false when the same ids appear in a different sequence", () => {
    assert.equal(ordersMatch(["a", "b", "c"], ["b", "a", "c"]), false);
  });

  it("is false when the lengths differ, even sharing every common position", () => {
    assert.equal(ordersMatch(["a", "b"], ["a", "b", "c"]), false);
    assert.equal(ordersMatch(["a", "b", "c"], ["a", "b"]), false);
  });

  it("is false when a single id differs at any position", () => {
    assert.equal(ordersMatch(["a", "b", "c"], ["a", "x", "c"]), false);
  });

  it("is true for two empty orders", () => {
    assert.equal(ordersMatch([], []), true);
  });
});
