// The period a visit list is read through — shared by the field history and
// the manager visit list, which ask the same question at two scales.
//
// Why a window at all: a visit list with no period names no denominator ("59
// visits" — since when?) and asks the API to sweep a tenant's whole history to
// answer it. So the screens always send one, and always say which one. The API
// clamps anything deeper than 12 months regardless (VISIT_PERIOD_MAX_MONTHS in
// src/modules/visits/visits.service.ts), but the named default lives here: the
// clamp is a floor against bad callers, not a window a person chose.

import type { useTranslations } from "next-intl";

import type { IntlFormatter } from "./format";

export type VisitPeriodPreset = "week" | "month" | "quarter";

// Inclusive day counts: "last 7 days" is today plus the six behind it, so a
// preset's own end is always today in the tenant's timezone.
export const VISIT_PERIOD_PRESET_DAYS: Record<VisitPeriodPreset, number> = {
  week: 7,
  month: 30,
  quarter: 90,
};

export const VISIT_PERIOD_PRESETS: VisitPeriodPreset[] = [
  "week",
  "month",
  "quarter",
];

// 30 days: long enough that a rep's list is never empty on a Monday morning,
// short enough that the recap above it still describes a period the rep
// recognises as "recently".
export const DEFAULT_VISIT_PERIOD_PRESET: VisitPeriodPreset = "month";

export type VisitPeriod = {
  // YYYY-MM-DD, the format the API's date filters take.
  startedFrom: string;
  startedTo: string;
  // Which pill is lit. "custom" covers any range the presets can't produce.
  preset: VisitPeriodPreset | "custom";
  // True while the window is the unasked-for default, so a screen can tell
  // "the rep chose 30 days" from "nobody chose anything yet" — the second one
  // must not light up the filter panel's active dot.
  isDefault: boolean;
};

/**
 * Today's calendar day in the tenant's timezone as YYYY-MM-DD.
 *
 * en-CA renders exactly that shape and the locale is never shown — it is a
 * formatting detail, not a user-facing choice.
 */
export function todayInTimeZone(timeZone: string, now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).format(now);
}

/**
 * Day arithmetic on the YYYY-MM-DD key rather than on a timestamp: taking 24h
 * off a moment lands on the wrong calendar day across a DST change.
 */
export function shiftDay(day: string, days: number): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, dayOfMonth + days))
    .toISOString()
    .slice(0, 10);
}

/** Whole days between two YYYY-MM-DD keys, inclusive of both ends. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);

  return Math.round((end - start) / 86_400_000) + 1;
}

/** The window a preset stands for, ending today in the tenant's timezone. */
export function visitPeriodPresetRange(
  preset: VisitPeriodPreset,
  timeZone: string,
  now: Date = new Date(),
): { startedFrom: string; startedTo: string } {
  const startedTo = todayInTimeZone(timeZone, now);

  return {
    startedFrom: shiftDay(startedTo, -(VISIT_PERIOD_PRESET_DAYS[preset] - 1)),
    startedTo,
  };
}

/**
 * The window a request is actually read through: whatever the URL asked for,
 * or the default preset when it asked for nothing.
 *
 * A half-open range (one bound given) is completed rather than left open —
 * an open end is the unnamed period this whole control exists to retire.
 */
export function resolveVisitPeriod(
  params: { startedFrom?: string | null; startedTo?: string | null },
  timeZone: string,
  now: Date = new Date(),
): VisitPeriod {
  const today = todayInTimeZone(timeZone, now);
  const requestedFrom = params.startedFrom ?? null;
  const requestedTo = params.startedTo ?? null;

  if (!requestedFrom && !requestedTo) {
    return {
      ...visitPeriodPresetRange(DEFAULT_VISIT_PERIOD_PRESET, timeZone, now),
      preset: DEFAULT_VISIT_PERIOD_PRESET,
      isDefault: true,
    };
  }

  const startedTo = requestedTo ?? today;
  // With only an end given, the open start falls back to the default window's
  // length rather than to the beginning of time.
  const startedFrom =
    requestedFrom ??
    shiftDay(
      startedTo,
      -(VISIT_PERIOD_PRESET_DAYS[DEFAULT_VISIT_PERIOD_PRESET] - 1),
    );
  // A backwards range would ask the API for an empty set; swapping the ends
  // reads it as the range the person meant.
  const ordered =
    startedFrom <= startedTo
      ? { startedFrom, startedTo }
      : { startedFrom: startedTo, startedTo: startedFrom };

  return {
    ...ordered,
    preset: matchVisitPeriodPreset(ordered, today),
    isDefault: false,
  };
}

/**
 * Which preset a range is, if any: a preset always ends today, so a range that
 * ends earlier is a custom one even when its length happens to match.
 */
function matchVisitPeriodPreset(
  range: { startedFrom: string; startedTo: string },
  today: string,
): VisitPeriodPreset | "custom" {
  if (range.startedTo !== today) {
    return "custom";
  }

  const length = daysBetween(range.startedFrom, range.startedTo);

  return (
    VISIT_PERIOD_PRESETS.find(
      (preset) => VISIT_PERIOD_PRESET_DAYS[preset] === length,
    ) ?? "custom"
  );
}

// Translator scoped to `common.visitPeriod` (from `useTranslations` or
// `getTranslations`), the one dictionary both visit screens name periods from.
export type VisitPeriodTranslator = ReturnType<
  typeof useTranslations<"common.visitPeriod">
>;

/**
 * What the window is called wherever it is shown: a preset by its name, a
 * hand-picked range by its two ends. Never "all visits" — every list this
 * labels is bounded.
 */
export function visitPeriodLabel(
  t: VisitPeriodTranslator,
  format: IntlFormatter,
  period: { preset: VisitPeriodPreset | "custom" } & {
    startedFrom: string;
    startedTo: string;
  },
): string {
  if (period.preset !== "custom") {
    return t(`preset.${period.preset}`);
  }

  // Date-only values are calendar days in the tenant's timezone, so they are
  // formatted from UTC noon: a midnight instant would tip to the previous day
  // in any timezone west of UTC.
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T12:00:00.000Z`), {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return t("custom", {
    from: day(period.startedFrom),
    to: day(period.startedTo),
  });
}

/**
 * The window of the same length sitting immediately before this one — where
 * the list continues once the current window is scrolled out.
 */
export function previousVisitPeriod(period: {
  startedFrom: string;
  startedTo: string;
}): { startedFrom: string; startedTo: string } {
  const length = daysBetween(period.startedFrom, period.startedTo);

  return {
    startedFrom: shiftDay(period.startedFrom, -length),
    startedTo: shiftDay(period.startedFrom, -1),
  };
}
