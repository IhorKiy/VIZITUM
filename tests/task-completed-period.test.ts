import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCompletedFilter,
  resolveTaskCompletedRange,
  TASK_COMPLETED_PERIOD_MAX_MONTHS,
  taskOrderBy,
} from "../src/modules/tasks/tasks.service";

const now = new Date("2026-07-28T09:00:00.000Z");

// A done task is never removed and never stops being done, so the finished half
// of a task list only ever grows: without a window it is a full-history sweep
// that gets slower every week the product is used. The window is the fix, and
// this is the backend half of it — it holds whichever client asks.
//
// The important difference from the visit clamp: a task query is *not* windowed
// unless it asks to be. A visit belongs to a moment, but an open task belongs to
// no moment at all — it is open until someone closes it — so flooring every task
// read would hide exactly the stale work a list exists to surface.
describe("task completion window", () => {
  it("leaves a query that asked for no window unbounded", () => {
    assert.equal(resolveTaskCompletedRange(undefined, undefined, now), null);
    assert.equal(resolveTaskCompletedRange("", "", now), null);
  });

  it("keeps a window that already sits inside the ceiling exactly as asked", () => {
    const range = resolveTaskCompletedRange("2026-06-29", "2026-07-28", now);

    assert.deepEqual(range, {
      gte: new Date("2026-06-29T00:00:00.000Z"),
      lte: new Date("2026-07-28T23:59:59.999Z"),
    });
  });

  it("trims a longer window from its own end, not from today", () => {
    const range = resolveTaskCompletedRange("2019-01-01", "2024-06-30", now);

    // The end the caller asked for survives; only the start moves up, so an old
    // window stays where it was pointed rather than snapping to this month.
    assert.deepEqual(range, {
      gte: new Date("2023-06-30T00:00:00.000Z"),
      lte: new Date("2024-06-30T23:59:59.999Z"),
    });
    assert.equal(TASK_COMPLETED_PERIOD_MAX_MONTHS, 12);
  });

  // Every bound here is a whole calendar day — the upper one becomes
  // 23:59:59.999 — so taking twelve months off that end would put the floor at
  // 23:59:59.999 too, and the boundary day would exist for one millisecond.
  it("lands the floor on the start of its day", () => {
    const range = resolveTaskCompletedRange("2019-01-01", "2026-07-28", now);

    assert.deepEqual(range?.gte, new Date("2025-07-28T00:00:00.000Z"));
  });

  it("measures a half-open window from now when the caller named no end", () => {
    const range = resolveTaskCompletedRange("2019-01-01", undefined, now);

    assert.deepEqual(range, { gte: new Date("2025-07-28T00:00:00.000Z") });
  });

  // The web layer swaps the ends before it asks, so this is for everyone else:
  // a script or a saved query that names them the wrong way round would
  // otherwise get a confident empty answer and a backwards window echoed back
  // to explain it.
  it("reads a backwards range as the range it meant", () => {
    const range = resolveTaskCompletedRange("2026-07-20", "2026-07-10", now);

    // Swapped as whole calendar days, not as two exchanged instants: the ends
    // carry different times of day, so the new start takes 00:00:00.000 and the
    // new end 23:59:59.999 rather than inheriting each other's.
    assert.deepEqual(range, {
      gte: new Date("2026-07-10T00:00:00.000Z"),
      lte: new Date("2026-07-20T23:59:59.999Z"),
    });
  });

  it("still trims a backwards range that is too long, from its corrected end", () => {
    const range = resolveTaskCompletedRange("2024-06-30", "2019-01-01", now);

    assert.deepEqual(range, {
      gte: new Date("2023-06-30T00:00:00.000Z"),
      lte: new Date("2024-06-30T23:59:59.999Z"),
    });
  });

  it("rejects a bound that is not a calendar day rather than guessing at one", () => {
    assert.throws(() => resolveTaskCompletedRange("28-07-2026", undefined, now), {
      message: "Date filters must use YYYY-MM-DD format.",
    });
  });
});

// What the window cuts depends on what the list holds, and getting this wrong
// is silent: a mixed list cut by completedAt alone loses every open task,
// because an open task has no completedAt to fall inside the range.
describe("task completion window across list shapes", () => {
  const range = { gte: new Date("2026-06-29T00:00:00.000Z") };

  it("cuts a done-only list by the window itself", () => {
    assert.deepEqual(buildCompletedFilter(range, "done"), {
      completedAt: range,
    });
  });

  it("lets open work through the window on a mixed list", () => {
    // The manager's "all tasks" view. "This period" there means "everything
    // still open, plus what was closed in these days" — open work is
    // self-limiting and needs no window of its own.
    assert.deepEqual(buildCompletedFilter(range, undefined), {
      OR: [{ completedAt: null }, { completedAt: range }],
    });
  });

  it("cuts nothing when no window was asked for", () => {
    assert.deepEqual(buildCompletedFilter(null, "done"), {});
    assert.deepEqual(buildCompletedFilter(null, undefined), {});
  });
});

// Two lists, two questions. Open work is worked through by deadline; finished
// work is read as "what did I close lately", and ordering it by deadline would
// head the list with its oldest due dates.
describe("task list ordering", () => {
  it("orders finished work by when it was finished, newest first", () => {
    assert.deepEqual(taskOrderBy("done"), [
      { completedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ]);
  });

  it("orders every other list by when it is owed", () => {
    for (const status of ["in_progress", undefined] as const) {
      assert.deepEqual(taskOrderBy(status), [
        { dueDate: "asc" },
        { createdAt: "desc" },
      ]);
    }
  });
});
