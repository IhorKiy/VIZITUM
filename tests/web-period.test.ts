import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasEarlierPeriod,
  historyFloor,
  periodAsRead,
  periodLabel,
  periodPresetRange,
  periodShortLabel,
  previousPeriod,
  resolvePeriod,
} from "../apps/web/lib/period";

// The window every long list reads through — the visit screens and the
// finished-tasks list — resolved on the server before any of them asks the API
// anything. Two things have to hold: a screen opened with a bare URL still
// names a period (never "everything"), and that period is the tenant's
// calendar days, not the server's.
describe("period window (web)", () => {
  const kyiv = "Europe/Kyiv";
  // 23:30 UTC on 27 July is already 28 July in Kyiv (UTC+3) — the case where
  // a server-local "today" and a tenant-local one disagree.
  const lateEvening = new Date("2026-07-27T23:30:00.000Z");

  it("defaults to the last 30 calendar days in the tenant timezone", () => {
    const period = resolvePeriod({}, kyiv, lateEvening);

    assert.deepEqual(period, {
      from: "2026-06-29",
      to: "2026-07-28",
      preset: "month",
      isDefault: true,
      clamped: false,
    });
  });

  it("resolves the same instant to the previous day in a timezone behind UTC", () => {
    const period = resolvePeriod({}, "America/New_York", lateEvening);

    assert.equal(period.to, "2026-07-27");
  });

  it("still reads as the default when the URL carries the default window's own dates", () => {
    // The screens seed their date inputs with the resolved window and the
    // filter form serializes every non-empty field, so clicking a status pill
    // writes those dates into the URL. Reading "has dates" as "the user chose
    // a period" would light the filter panel's active dot and offer a reset
    // for a window nobody picked.
    const submitted = resolvePeriod({}, kyiv, lateEvening);
    const period = resolvePeriod(submitted, kyiv, lateEvening);

    assert.equal(period.isDefault, true);
    assert.equal(period.preset, "month");
  });

  it("treats a window the user actually picked as a choice", () => {
    const week = periodPresetRange("week", kyiv, lateEvening);

    assert.equal(resolvePeriod(week, kyiv, lateEvening).isDefault, false);
    assert.equal(
      resolvePeriod(
        { from: "2026-07-01", to: "2026-07-10" },
        kyiv,
        lateEvening,
      ).isDefault,
      false,
    );
  });

  it("names the window the API actually read when the clamp raised it", () => {
    const requested = resolvePeriod(
      { from: "2019-01-01", to: "2026-07-28" },
      kyiv,
      lateEvening,
    );
    // What the API answers with after flooring the request 12 months back.
    const asRead = periodAsRead(
      requested,
      "2025-07-28T00:00:00.000Z",
      kyiv,
    );

    assert.equal(asRead.from, "2025-07-28");
    assert.equal(asRead.preset, "custom");
    // An unclamped window is left exactly as it was resolved.
    const untouched = periodAsRead(
      requested,
      "2018-01-01T00:00:00.000Z",
      kyiv,
    );
    assert.equal(untouched.from, requested.from);
  });

  // Two endings the screen must not confuse. Hitting the maximum window length
  // is not the bottom of the history: the API caps how long one window may be,
  // never how far back it points, so the data behind a trimmed window is one
  // date range away. Only the first visit ever recorded is a real bottom.
  it("takes the history floor from the earliest visit, not from arithmetic on today", () => {
    // The API reports it as an instant; the floor is its day in the tenant's
    // timezone, which is where the day-keyed windows are compared.
    assert.deepEqual(historyFloor("2024-03-05T22:30:00.000Z", kyiv), {
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
    assert.deepEqual(historyFloor(null, kyiv), { state: "empty" });
    assert.deepEqual(historyFloor(undefined, kyiv), { state: "unknown" });
  });

  it("offers the step back when nothing is known, and withholds it when the scope is confirmed empty", () => {
    const period = resolvePeriod({}, kyiv, lateEvening);
    // The rule the screens share, pinned on all three branches: unknown never
    // blocks, empty always does, a day compares.
    const canStepBack = (floor: ReturnType<typeof historyFloor>) =>
      hasEarlierPeriod(period, floor);

    // Day-summary failed, or an older API during a deploy: nothing to claim,
    // so the step stays offered.
    assert.equal(canStepBack(historyFloor(undefined, kyiv)), true);
    // The API said this scope holds no visits at all. There is no earlier
    // period, because there is no period.
    assert.equal(canStepBack(historyFloor(null, kyiv)), false);
    // A scope that does have history keeps stepping back through it.
    assert.equal(
      canStepBack(historyFloor("2020-01-01T00:00:00.000Z", kyiv)),
      true,
    );
  });

  it("separates 'window was trimmed' from 'history ends here'", () => {
    const requested = resolvePeriod(
      { from: "2019-01-01", to: "2026-07-28" },
      kyiv,
      lateEvening,
    );
    const trimmed = periodAsRead(
      requested,
      "2025-07-28T00:00:00.000Z",
      kyiv,
    );
    const floor = historyFloor("2019-05-04T09:00:00.000Z", kyiv);

    // The window was capped at 12 months...
    assert.equal(trimmed.clamped, true);
    // ...but visits from 2019 still exist, so the step back is real and the
    // screen must not announce an end.
    assert.equal(floor.state, "day");
    assert.ok(
      previousPeriod(trimmed).to >=
        (floor as { state: "day"; day: string }).day,
    );
  });

  it("stops the handover at the first recorded visit", () => {
    const oldest = resolvePeriod(
      { from: "2024-03-06", to: "2024-04-04" },
      kyiv,
      lateEvening,
    );
    const floor = historyFloor("2024-03-05T22:30:00.000Z", kyiv);

    assert.equal(oldest.clamped, false);
    // Everything behind this window predates the first visit — there is
    // genuinely nothing left to step back to.
    assert.equal(floor.state, "day");
    assert.ok(
      previousPeriod(oldest).to <
        (floor as { state: "day"; day: string }).day,
    );
  });

  it("lights the preset pill whose window the URL happens to name", () => {
    const week = periodPresetRange("week", kyiv, lateEvening);
    const period = resolvePeriod(week, kyiv, lateEvening);

    assert.equal(period.preset, "week");
    assert.equal(period.isDefault, false);
    assert.deepEqual(week, {
      from: "2026-07-22",
      to: "2026-07-28",
    });
  });

  it("treats a window of preset length that does not end today as custom", () => {
    const period = resolvePeriod(
      { from: "2026-06-01", to: "2026-06-07" },
      kyiv,
      lateEvening,
    );

    assert.equal(period.preset, "custom");
  });

  it("completes a half-open range rather than leaving one end unbounded", () => {
    const openStart = resolvePeriod(
      { to: "2026-06-30" },
      kyiv,
      lateEvening,
    );
    const openEnd = resolvePeriod(
      { from: "2026-07-20" },
      kyiv,
      lateEvening,
    );

    assert.deepEqual(openStart, {
      from: "2026-06-01",
      to: "2026-06-30",
      preset: "custom",
      isDefault: false,
      clamped: false,
    });
    assert.equal(openEnd.to, "2026-07-28");
  });

  it("reads a backwards range as the range it meant", () => {
    const period = resolvePeriod(
      { from: "2026-07-20", to: "2026-07-10" },
      kyiv,
      lateEvening,
    );

    assert.equal(period.from, "2026-07-10");
    assert.equal(period.to, "2026-07-20");
  });

  it("hands over to the window of the same length immediately behind this one", () => {
    const period = resolvePeriod({}, kyiv, lateEvening);

    // 30 days again, ending the day before the current window starts: no gap,
    // no overlap, so paging back through periods never skips or repeats a day.
    assert.deepEqual(previousPeriod(period), {
      from: "2026-05-30",
      to: "2026-06-28",
    });
  });
});

// What the window is called on the control that sets it. The pill in the visit
// history's header is the only place a rep is told which period they are
// reading, so the short name has to be a name — not a truncation, and never
// empty for a range someone typed by hand.
describe("period short label", () => {
  // The dictionaries under common.period, as the two functions read them.
  const t = ((key: string, values?: Record<string, string>) =>
    values ? `${key}(${values.from}..${values.to})` : key) as never;
  const format = {
    dateTime: (value: Date) => value.toISOString().slice(0, 10),
  } as never;

  it("names a preset by its short form, which the pill has room for", () => {
    assert.equal(
      periodShortLabel(t, format, {
        from: "2026-06-29",
        to: "2026-07-28",
        preset: "month",
      }),
      "presetShort.month",
    );
  });

  it("names a hand-picked range by its two dates, as the long form does", () => {
    // A range has no short name to fall back on: its dates are its name, so
    // both forms agree rather than one of them going blank.
    const range = {
      from: "2026-06-09",
      to: "2026-07-08",
      preset: "custom",
    } as const;

    assert.equal(
      periodShortLabel(t, format, range),
      periodLabel(t, format, range),
    );
    assert.equal(
      periodShortLabel(t, format, range),
      "custom(2026-06-09..2026-07-08)",
    );
  });
});
