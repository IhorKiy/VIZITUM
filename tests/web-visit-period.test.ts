import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  previousVisitPeriod,
  resolveVisitPeriod,
  visitHistoryFloor,
  visitPeriodAsRead,
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
      clamped: false,
    });
  });

  it("resolves the same instant to the previous day in a timezone behind UTC", () => {
    const period = resolveVisitPeriod({}, "America/New_York", lateEvening);

    assert.equal(period.startedTo, "2026-07-27");
  });

  it("still reads as the default when the URL carries the default window's own dates", () => {
    // The screens seed their date inputs with the resolved window and the
    // filter form serializes every non-empty field, so clicking a status pill
    // writes those dates into the URL. Reading "has dates" as "the user chose
    // a period" would light the filter panel's active dot and offer a reset
    // for a window nobody picked.
    const submitted = resolveVisitPeriod({}, kyiv, lateEvening);
    const period = resolveVisitPeriod(submitted, kyiv, lateEvening);

    assert.equal(period.isDefault, true);
    assert.equal(period.preset, "month");
  });

  it("treats a window the user actually picked as a choice", () => {
    const week = visitPeriodPresetRange("week", kyiv, lateEvening);

    assert.equal(resolveVisitPeriod(week, kyiv, lateEvening).isDefault, false);
    assert.equal(
      resolveVisitPeriod(
        { startedFrom: "2026-07-01", startedTo: "2026-07-10" },
        kyiv,
        lateEvening,
      ).isDefault,
      false,
    );
  });

  it("names the window the API actually read when the clamp raised it", () => {
    const requested = resolveVisitPeriod(
      { startedFrom: "2019-01-01", startedTo: "2026-07-28" },
      kyiv,
      lateEvening,
    );
    // What the API answers with after flooring the request 12 months back.
    const asRead = visitPeriodAsRead(
      requested,
      { startedFrom: "2025-07-28T00:00:00.000Z", startedTo: null },
      kyiv,
    );

    assert.equal(asRead.startedFrom, "2025-07-28");
    assert.equal(asRead.preset, "custom");
    // An unclamped window is left exactly as it was resolved.
    const untouched = visitPeriodAsRead(
      requested,
      { startedFrom: "2018-01-01T00:00:00.000Z", startedTo: null },
      kyiv,
    );
    assert.equal(untouched.startedFrom, requested.startedFrom);
  });

  // Two endings the screen must not confuse. Hitting the maximum window length
  // is not the bottom of the history: the API caps how long one window may be,
  // never how far back it points, so the data behind a trimmed window is one
  // date range away. Only the first visit ever recorded is a real bottom.
  it("takes the history floor from the earliest visit, not from arithmetic on today", () => {
    // The API reports it as an instant; the floor is its day in the tenant's
    // timezone, which is where the day-keyed windows are compared.
    assert.deepEqual(visitHistoryFloor("2024-03-05T22:30:00.000Z", kyiv), {
      state: "day",
      day: "2024-03-06",
    });
  });

  // `null` and `undefined` are two truthful answers with opposite
  // consequences, so the floor keeps them apart rather than testing for
  // truthiness: a confirmed-empty scope that arrives as "no information" is
  // exactly how a rep with no visits gets an endless walk back through empty
  // windows.
  it("distinguishes a confirmed-empty scope from an unanswered one", () => {
    assert.deepEqual(visitHistoryFloor(null, kyiv), { state: "empty" });
    assert.deepEqual(visitHistoryFloor(undefined, kyiv), { state: "unknown" });
  });

  it("offers the step back when nothing is known, and withholds it when the scope is confirmed empty", () => {
    const period = resolveVisitPeriod({}, kyiv, lateEvening);
    // The screen's own rule, kept in one place here so both branches are
    // pinned: unknown never blocks, empty always does, a day compares.
    const canStepBack = (floor: ReturnType<typeof visitHistoryFloor>) =>
      floor.state === "unknown" ||
      (floor.state === "day" &&
        previousVisitPeriod(period).startedTo >= floor.day);

    // Day-summary failed, or an older API during a deploy: nothing to claim,
    // so the step stays offered.
    assert.equal(canStepBack(visitHistoryFloor(undefined, kyiv)), true);
    // The API said this scope holds no visits at all. There is no earlier
    // period, because there is no period.
    assert.equal(canStepBack(visitHistoryFloor(null, kyiv)), false);
    // A scope that does have history keeps stepping back through it.
    assert.equal(
      canStepBack(visitHistoryFloor("2020-01-01T00:00:00.000Z", kyiv)),
      true,
    );
  });

  it("separates 'window was trimmed' from 'history ends here'", () => {
    const requested = resolveVisitPeriod(
      { startedFrom: "2019-01-01", startedTo: "2026-07-28" },
      kyiv,
      lateEvening,
    );
    const trimmed = visitPeriodAsRead(
      requested,
      { startedFrom: "2025-07-28T00:00:00.000Z", startedTo: null },
      kyiv,
    );
    const floor = visitHistoryFloor("2019-05-04T09:00:00.000Z", kyiv);

    // The window was capped at 12 months...
    assert.equal(trimmed.clamped, true);
    // ...but visits from 2019 still exist, so the step back is real and the
    // screen must not announce an end.
    assert.equal(floor.state, "day");
    assert.ok(
      previousVisitPeriod(trimmed).startedTo >=
        (floor as { state: "day"; day: string }).day,
    );
  });

  it("stops the handover at the first recorded visit", () => {
    const oldest = resolveVisitPeriod(
      { startedFrom: "2024-03-06", startedTo: "2024-04-04" },
      kyiv,
      lateEvening,
    );
    const floor = visitHistoryFloor("2024-03-05T22:30:00.000Z", kyiv);

    assert.equal(oldest.clamped, false);
    // Everything behind this window predates the first visit — there is
    // genuinely nothing left to step back to.
    assert.equal(floor.state, "day");
    assert.ok(
      previousVisitPeriod(oldest).startedTo <
        (floor as { state: "day"; day: string }).day,
    );
  });

  it("lights the preset pill whose window the URL happens to name", () => {
    const week = visitPeriodPresetRange("week", kyiv, lateEvening);
    const period = resolveVisitPeriod(week, kyiv, lateEvening);

    assert.equal(period.preset, "week");
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
      clamped: false,
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
