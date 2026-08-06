import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summariseTasksByLocation } from "../apps/web/lib/field-stop-tasks";

// What the field home's stop cards are drawn from: the rep's open tasks folded
// per location, so a card can say there is work waiting at that stop before
// the rep walks in. The fold decides two things the cards colour themselves
// by — late, and due today — and both are decided by comparing "YYYY-MM-DD"
// strings against a today the caller resolved in the tenant timezone.

const TODAY = "2026-08-06";

function task(
  locationId: string | null,
  dueDate: string | null,
): { locationId: string | null; dueDate: string | null } {
  return { locationId, dueDate };
}

describe("summariseTasksByLocation", () => {
  it("drops tasks that belong to no location", () => {
    // A task with no location is on no stop, so it can colour no card. Left in,
    // it would have to be filed under something — and the only key available
    // would be one it does not belong to.
    assert.deepEqual(summariseTasksByLocation([task(null, TODAY)], TODAY), {});
  });

  it("counts a due date before today as overdue", () => {
    assert.deepEqual(
      summariseTasksByLocation([task("loc-1", "2026-08-05")], TODAY),
      {
        "loc-1": { overdue: 1, dueToday: 0, total: 1 },
      },
    );
  });

  it("counts a due date matching today as due today, not overdue", () => {
    // The boundary the card's colour turns on: today is not late.
    assert.deepEqual(summariseTasksByLocation([task("loc-1", TODAY)], TODAY), {
      "loc-1": { overdue: 0, dueToday: 1, total: 1 },
    });
  });

  it("counts a later due date toward the total only", () => {
    assert.deepEqual(
      summariseTasksByLocation([task("loc-1", "2026-08-11")], TODAY),
      {
        "loc-1": { overdue: 0, dueToday: 0, total: 1 },
      },
    );
  });

  it("counts an undated task toward the total only", () => {
    // "N tasks" on a card is every open task at that stop, not only the ones
    // carrying a date.
    assert.deepEqual(summariseTasksByLocation([task("loc-1", null)], TODAY), {
      "loc-1": { overdue: 0, dueToday: 0, total: 1 },
    });
  });

  it("reads a full timestamp as the date it falls on", () => {
    // The API returns dueDate as an ISO timestamp; only the date half is
    // compared, so a task due today at any hour is due today.
    assert.deepEqual(
      summariseTasksByLocation(
        [task("loc-1", `${TODAY}T21:30:00.000Z`)],
        TODAY,
      ),
      { "loc-1": { overdue: 0, dueToday: 1, total: 1 } },
    );
  });

  it("keeps each location's counts to itself", () => {
    const summaries = summariseTasksByLocation(
      [
        task("loc-1", "2026-07-28"),
        task("loc-1", "2026-07-29"),
        task("loc-1", null),
        task("loc-2", TODAY),
        task(null, "2026-07-01"),
      ],
      TODAY,
    );

    assert.deepEqual(summaries, {
      "loc-1": { overdue: 2, dueToday: 0, total: 3 },
      "loc-2": { overdue: 0, dueToday: 1, total: 1 },
    });
  });

  it("compares dates as strings, so a later month is not read as a smaller number", () => {
    // The comparison is lexicographic over "YYYY-MM-DD" rather than numeric,
    // which is only correct because the fields are zero-padded and ordered
    // largest-first. September against August, and a year end, are where a
    // hand-rolled numeric comparison would go wrong.
    assert.deepEqual(
      summariseTasksByLocation(
        [task("loc-1", "2026-09-01"), task("loc-1", "2025-12-31")],
        TODAY,
      ),
      { "loc-1": { overdue: 1, dueToday: 0, total: 2 } },
    );
  });

  it("returns nothing for an empty list", () => {
    // The shape a failed task read falls back to: no badges, not a crash.
    assert.deepEqual(summariseTasksByLocation([], TODAY), {});
  });
});
