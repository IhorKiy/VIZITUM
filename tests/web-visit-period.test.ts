import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  previousVisitPeriod,
  resolveVisitPeriod,
  visitPeriodPresetRange,
} from "../apps/web/lib/visit-period";

// The window both visit screens read through, resolved on the server before
// either one asks the API anything. Two things have to hold: a screen opened
// with a bare URL still names a period (never "all visits"), and that period is
// the tenant's calendar days, not the server's.
describe("visit period window (web)", () => {
  const kyiv = "Europe/Kyiv";
  // 23:30 UTC on 27 July is already 28 July in Kyiv (UTC+3) — the case where
  // a server-local "today" and a tenant-local one disagree.
  const lateEvening = new Date("2026-07-27T23:30:00.000Z");

  it("defaults to the last 30 calendar days in the tenant timezone", () => {
    const period = resolveVisitPeriod({}, kyiv, lateEvening);

    assert.deepEqual(period, {
      startedFrom: "2026-06-29",
      startedTo: "2026-07-28",
      preset: "month",
      isDefault: true,
    });
  });

  it("resolves the same instant to the previous day in a timezone behind UTC", () => {
    const period = resolveVisitPeriod({}, "America/New_York", lateEvening);

    assert.equal(period.startedTo, "2026-07-27");
  });

  it("lights the preset pill whose window the URL happens to name", () => {
    const week = visitPeriodPresetRange("week", kyiv, lateEvening);
    const period = resolveVisitPeriod(week, kyiv, lateEvening);

    assert.equal(period.preset, "week");
    // A period someone chose is not the default, even when it matches a pill:
    // the filter panel's active dot tracks the choice, not the value.
    assert.equal(period.isDefault, false);
    assert.deepEqual(week, {
      startedFrom: "2026-07-22",
      startedTo: "2026-07-28",
    });
  });

  it("treats a window of preset length that does not end today as custom", () => {
    const period = resolveVisitPeriod(
      { startedFrom: "2026-06-01", startedTo: "2026-06-07" },
      kyiv,
      lateEvening,
    );

    assert.equal(period.preset, "custom");
  });

  it("completes a half-open range rather than leaving one end unbounded", () => {
    const openStart = resolveVisitPeriod(
      { startedTo: "2026-06-30" },
      kyiv,
      lateEvening,
    );
    const openEnd = resolveVisitPeriod(
      { startedFrom: "2026-07-20" },
      kyiv,
      lateEvening,
    );

    assert.deepEqual(openStart, {
      startedFrom: "2026-06-01",
      startedTo: "2026-06-30",
      preset: "custom",
      isDefault: false,
    });
    assert.equal(openEnd.startedTo, "2026-07-28");
  });

  it("reads a backwards range as the range it meant", () => {
    const period = resolveVisitPeriod(
      { startedFrom: "2026-07-20", startedTo: "2026-07-10" },
      kyiv,
      lateEvening,
    );

    assert.equal(period.startedFrom, "2026-07-10");
    assert.equal(period.startedTo, "2026-07-20");
  });

  it("hands over to the window of the same length immediately behind this one", () => {
    const period = resolveVisitPeriod({}, kyiv, lateEvening);

    // 30 days again, ending the day before the current window starts: no gap,
    // no overlap, so paging back through periods never skips or repeats a day.
    assert.deepEqual(previousVisitPeriod(period), {
      startedFrom: "2026-05-30",
      startedTo: "2026-06-28",
    });
  });
});
