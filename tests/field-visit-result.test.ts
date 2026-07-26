import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveVisitOutcome,
  isNoOrderReason,
  NO_ORDER_REASONS,
} from "../apps/web/lib/visit-result";

// The field visit-report form records the result as a fact (an order was
// placed or it wasn't, plus why not) and derives the legacy
// positive/neutral/negative `outcome` from it, so manager report views and
// already-confirmed reports keep working. These pin that mapping.
describe("visit result", () => {
  it("offers exactly the reasons the form chips are built from", () => {
    assert.deepEqual(NO_ORDER_REASONS, [
      "closed",
      "no_decision_maker",
      "has_stock",
      "no_money",
      "refused",
      "other",
    ]);
  });

  it("narrows raw values against the reason list", () => {
    for (const reason of NO_ORDER_REASONS) {
      assert.equal(isNoOrderReason(reason), true);
    }

    assert.equal(isNoOrderReason("no_time"), false);
    assert.equal(isNoOrderReason(""), false);
    assert.equal(isNoOrderReason(null), false);
    assert.equal(isNoOrderReason(undefined), false);
    assert.equal(isNoOrderReason(3), false);
  });

  it("treats any order as a positive outcome", () => {
    assert.equal(deriveVisitOutcome(true, null), "positive");

    // A reason cannot survive alongside an order, but a stale one must not
    // flip the outcome if it ever does.
    for (const reason of NO_ORDER_REASONS) {
      assert.equal(deriveVisitOutcome(true, reason), "positive");
    }
  });

  it("counts only a lost sale as negative", () => {
    assert.equal(deriveVisitOutcome(false, "no_money"), "negative");
    assert.equal(deriveVisitOutcome(false, "refused"), "negative");
  });

  it("keeps ordinary no-order visits neutral", () => {
    // A closed door, an absent decision-maker or a shelf that is still full
    // are route facts, not lost sales — grading them negative would make the
    // metric track timing instead of selling.
    assert.equal(deriveVisitOutcome(false, "closed"), "neutral");
    assert.equal(deriveVisitOutcome(false, "no_decision_maker"), "neutral");
    assert.equal(deriveVisitOutcome(false, "has_stock"), "neutral");
    assert.equal(deriveVisitOutcome(false, "other"), "neutral");
    assert.equal(deriveVisitOutcome(false, null), "neutral");
  });
});
