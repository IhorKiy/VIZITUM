import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDaysToDate,
  DAYS_IN_WEEK,
  dateToUtcNoon,
  isDateString,
  startOfWeek,
  weekDates,
} from "../apps/web/lib/planning-week";

// The week planner (apps/web/app/(workspace)/[tenantSlug]/field/planning)
// derives everything it draws — which seven days are on screen, which cell is
// today, which week the arrows and the week copy point at — from these four
// functions. They are pure calendar arithmetic on `YYYY-MM-DD` strings, so
// they are pinned here rather than through the screen.

describe("planning week arithmetic", () => {
  describe("startOfWeek", () => {
    it("returns the Monday of the week a date falls in", () => {
      // 2026-08-06 is a Thursday; its week starts Monday the 3rd.
      assert.equal(startOfWeek("2026-08-06"), "2026-08-03");
      assert.equal(startOfWeek("2026-08-03"), "2026-08-03");
    });

    it("keeps Sunday in the week that is ending, not the one about to start", () => {
      // getUTCDay() is Sunday-based, so Sunday has to fall back six days
      // rather than forward one. Getting this wrong shifts the whole screen
      // by a week on exactly one day in seven — the failure that only shows
      // up on Sundays.
      assert.equal(startOfWeek("2026-08-09"), "2026-08-03");
    });

    it("crosses month and year boundaries", () => {
      // Monday 2026-08-31 opens a week that runs into September.
      assert.equal(startOfWeek("2026-09-02"), "2026-08-31");
      // 2027-01-01 is a Friday, so its week starts in the previous year.
      assert.equal(startOfWeek("2027-01-01"), "2026-12-28");
    });
  });

  describe("weekDates", () => {
    it("lists seven consecutive days, Monday first", () => {
      assert.deepEqual(weekDates("2026-08-03"), [
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
        "2026-08-09",
      ]);
    });

    it("rolls over the end of a month", () => {
      const days = weekDates("2026-08-31");

      assert.equal(days.length, DAYS_IN_WEEK);
      assert.equal(days[0], "2026-08-31");
      assert.equal(days[1], "2026-09-01");
      assert.equal(days[DAYS_IN_WEEK - 1], "2026-09-06");
    });
  });

  describe("addDaysToDate", () => {
    it("steps a whole week in either direction", () => {
      assert.equal(addDaysToDate("2026-08-03", 7), "2026-08-10");
      assert.equal(addDaysToDate("2026-08-03", -7), "2026-07-27");
    });

    it("crosses a DST boundary without losing or gaining a day", () => {
      // Europe/Kyiv springs forward on 2026-03-29. Arithmetic on a local-time
      // Date would return the 28th here, which would leave the planner
      // showing a six-day week every spring.
      assert.equal(addDaysToDate("2026-03-28", 1), "2026-03-29");
      assert.equal(addDaysToDate("2026-03-25", 7), "2026-04-01");
      // And back again over the autumn transition (2026-10-25).
      assert.equal(addDaysToDate("2026-10-24", 7), "2026-10-31");
    });

    it("handles a leap day", () => {
      assert.equal(addDaysToDate("2028-02-28", 1), "2028-02-29");
      assert.equal(addDaysToDate("2026-02-28", 1), "2026-03-01");
    });
  });

  describe("isDateString", () => {
    it("accepts a real calendar day", () => {
      assert.equal(isDateString("2026-08-06"), true);
      assert.equal(isDateString("2028-02-29"), true);
    });

    it("refuses a day past the end of its month rather than rolling it over", () => {
      // An accepted "2026-02-31" would anchor the screen on March 3rd, which
      // is not the week any link meant.
      assert.equal(isDateString("2026-02-31"), false);
      assert.equal(isDateString("2026-02-29"), false);
    });

    it("refuses anything that is not a YYYY-MM-DD string", () => {
      for (const value of ["", "2026-8-6", "06/08/2026", undefined, null]) {
        assert.equal(isDateString(value), false);
      }
    });
  });

  describe("dateToUtcNoon", () => {
    it("lands at noon so UTC formatting cannot slip to the neighbouring day", () => {
      assert.equal(
        dateToUtcNoon("2026-08-06").toISOString(),
        "2026-08-06T12:00:00.000Z",
      );
    });
  });
});
