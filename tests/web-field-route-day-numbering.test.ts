import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupByRoutePlan } from "../apps/web/lib/today-route-groups";

// The field home shows the day as one numbered list, but drags it as one
// context per plan — a stop can never be dragged out of its own plan, which is
// what keeps a team lead's merged list from moving someone else's stop. The
// numbers still have to run straight through, so each group carries where its
// stops start in that single run. This is the arithmetic behind that: get it
// wrong and the second plan's first stop is numbered 1 under a stop numbered
// 3, which is what the reader sees.

function stop(id: string, routePlanId: string) {
  return { id, routePlanId };
}

describe("groupByRoutePlan", () => {
  it("starts the first group at zero", () => {
    const groups = groupByRoutePlan([stop("a", "plan-1"), stop("b", "plan-1")]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].startIndex, 0);
  });

  it("starts each group after every stop above it", () => {
    // Three then one: the second group's single stop is the fourth of the day
    // and must be numbered so, not restarted at 1.
    const groups = groupByRoutePlan([
      stop("a", "plan-1"),
      stop("b", "plan-1"),
      stop("c", "plan-1"),
      stop("d", "plan-2"),
    ]);

    assert.deepEqual(
      groups.map((group) => [group.routePlanId, group.startIndex]),
      [
        ["plan-1", 0],
        ["plan-2", 3],
      ],
    );
  });

  it("accumulates across three groups", () => {
    const groups = groupByRoutePlan([
      stop("a", "plan-1"),
      stop("b", "plan-2"),
      stop("c", "plan-2"),
      stop("d", "plan-3"),
    ]);

    assert.deepEqual(
      groups.map((group) => group.startIndex),
      [0, 1, 3],
    );
  });

  it("gives every stop a distinct number across the whole day", () => {
    // The property the offsets exist for, checked end to end: flatten the
    // groups back out the way the list renders them and the numbers are
    // 1..N with nothing repeated or skipped.
    const groups = groupByRoutePlan([
      stop("a", "plan-1"),
      stop("b", "plan-2"),
      stop("c", "plan-1"),
      stop("d", "plan-2"),
      stop("e", "plan-3"),
    ]);
    const numbers = groups.flatMap((group) =>
      group.stops.map((_, position) => group.startIndex + position + 1),
    );

    assert.deepEqual(numbers, [1, 2, 3, 4, 5]);
  });

  it("keeps plans in the order their first stop appears", () => {
    // Interleaved input: the groups follow first appearance, so a plan does
    // not jump the list because its later stops came first in the array.
    const groups = groupByRoutePlan([
      stop("a", "plan-2"),
      stop("b", "plan-1"),
      stop("c", "plan-2"),
    ]);

    assert.deepEqual(
      groups.map((group) => group.routePlanId),
      ["plan-2", "plan-1"],
    );
    assert.deepEqual(
      groups.map((group) => group.stops.map((item) => item.id)),
      [["a", "c"], ["b"]],
    );
  });

  it("returns nothing for a day with no stops", () => {
    assert.deepEqual(groupByRoutePlan([]), []);
  });
});
