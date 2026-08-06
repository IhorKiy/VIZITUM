import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addMonths,
  datesBetween,
  daysInMonth,
  endOfMonth,
  isMonthString,
  monthGrid,
  monthOf,
  startOfMonth,
} from "../apps/web/lib/planning-month";
import {
  DEFAULT_PLANNING_VIEW,
  resolvePlanningView,
} from "../apps/web/lib/planning-view";

// Month arithmetic for the planning screen's month mode, alongside the week
// arithmetic in tests/planning-week-dates.test.ts. Everything here decides
// what the grid draws: which cells a month has, how many blanks precede the
// 1st, and which dates a shift-click range covers.

describe("planning month arithmetic", () => {
  describe("isMonthString", () => {
    it("accepts a real month", () => {
      assert.equal(isMonthString("2026-08"), true);
      assert.equal(isMonthString("2026-01"), true);
      assert.equal(isMonthString("2026-12"), true);
    });

    it("refuses a month number outside 1-12 rather than rolling it over", () => {
      // An accepted "2026-13" would anchor the screen on January 2027.
      assert.equal(isMonthString("2026-13"), false);
      assert.equal(isMonthString("2026-00"), false);
    });

    it("refuses anything not shaped YYYY-MM", () => {
      for (const value of ["2026-8", "2026", "2026-08-01", undefined, null]) {
        assert.equal(isMonthString(value), false);
      }
    });
  });

  describe("month boundaries", () => {
    it("finds the last day of a month without a 28/29/30/31 table", () => {
      assert.equal(endOfMonth("2026-08"), "2026-08-31");
      assert.equal(endOfMonth("2026-04"), "2026-04-30");
      assert.equal(endOfMonth("2026-12"), "2026-12-31");
    });

    it("gets February right in and out of a leap year", () => {
      assert.equal(endOfMonth("2028-02"), "2028-02-29");
      assert.equal(endOfMonth("2026-02"), "2026-02-28");
      assert.equal(daysInMonth("2028-02"), 29);
      assert.equal(daysInMonth("2026-02"), 28);
    });

    it("steps months across a year boundary in both directions", () => {
      assert.equal(addMonths("2026-12", 1), "2027-01");
      assert.equal(addMonths("2026-01", -1), "2025-12");
      assert.equal(addMonths("2026-08", 6), "2027-02");
    });

    it("reads a date's month and a month's first day", () => {
      assert.equal(monthOf("2026-08-06"), "2026-08");
      assert.equal(startOfMonth("2026-08"), "2026-08-01");
    });
  });

  describe("monthGrid", () => {
    it("pads to the weekday the 1st falls on, Monday first", () => {
      // 2026-08-01 is a Saturday, so five blanks precede it.
      const august = monthGrid("2026-08");

      assert.equal(august.leadingBlanks, 5);
      assert.equal(august.dates.length, 31);
      assert.equal(august.dates[0], "2026-08-01");
      assert.equal(august.dates[30], "2026-08-31");
    });

    it("adds no blanks when a month opens on a Monday", () => {
      // 2026-06-01 is a Monday.
      assert.equal(monthGrid("2026-06").leadingBlanks, 0);
    });

    it("treats a Sunday 1st as the end of a week, not the start", () => {
      // 2026-03-01 is a Sunday: six blanks, not zero. Getting this backwards
      // would shift the entire month one column left.
      assert.equal(monthGrid("2026-03").leadingBlanks, 6);
    });
  });

  describe("datesBetween", () => {
    it("covers both ends inclusively", () => {
      assert.deepEqual(datesBetween("2026-08-03", "2026-08-06"), [
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
      ]);
    });

    it("reads an inverted pair as the same range", () => {
      // Which end a shift-click starts from says nothing about which date is
      // earlier.
      assert.deepEqual(
        datesBetween("2026-08-06", "2026-08-03"),
        datesBetween("2026-08-03", "2026-08-06"),
      );
    });

    it("returns the single date when both ends are the same day", () => {
      assert.deepEqual(datesBetween("2026-08-06", "2026-08-06"), [
        "2026-08-06",
      ]);
    });

    it("crosses a month boundary", () => {
      assert.deepEqual(datesBetween("2026-07-30", "2026-08-02"), [
        "2026-07-30",
        "2026-07-31",
        "2026-08-01",
        "2026-08-02",
      ]);
    });

    it("answers with nothing for a malformed or calendar-invalid end", () => {
      assert.deepEqual(datesBetween("2026-02-31", "2026-03-02"), []);
      assert.deepEqual(datesBetween("2026-08-03", "not-a-date"), []);
    });
  });
});

describe("planning view resolution", () => {
  it("lets the URL win over the remembered preference", () => {
    // A shared link opens the mode it names, whatever the reader last chose.
    assert.equal(resolvePlanningView("month", "week"), "month");
    assert.equal(resolvePlanningView("week", "month"), "week");
  });

  it("falls back to the remembered preference when the URL names none", () => {
    assert.equal(resolvePlanningView(undefined, "month"), "month");
  });

  it("falls back to the default when neither says anything usable", () => {
    for (const [url, cookie] of [
      [undefined, undefined],
      ["quarter", undefined],
      [undefined, "quarter"],
      ["", ""],
    ] as Array<[string | undefined, string | undefined]>) {
      assert.equal(resolvePlanningView(url, cookie), DEFAULT_PLANNING_VIEW);
    }
  });

  it("defaults to the week, the mode that covers the everyday case", () => {
    assert.equal(DEFAULT_PLANNING_VIEW, "week");
  });
});
