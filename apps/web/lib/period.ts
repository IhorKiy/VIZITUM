// The window a long, ever-growing list is read through — shared by the visit
// screens and the finished-tasks list, which ask the same question of two
// different timestamps.
//
// Why a window at all: a list with no period names no denominator ("59 visits"
// — since when?) and asks the API to sweep a tenant's whole history to answer
// it. So the screens always send one, and always say which one.
//
// The API caps how *long* one window may be — 12 months — but never how far
// back it points: a range two years in the past is answered as asked, as long
// as it is short enough. That cap is a per-request cost ceiling against bad
// callers, not a horizon on the data and not a window a person chose; the named
// default lives here instead.
//
// Only the two URL parameters differ between the lists that use this
// (`startedFrom`/`startedTo` for visits, `completedFrom`/`completedTo` for
// finished tasks), so those are data — see PeriodParamNames — and everything
// else is one implementation.

import type { useTranslations } from "next-intl";

import type { IntlFormatter } from "./format";

export type PeriodPreset = "week" | "month" | "quarter";

// Inclusive day counts: "last 7 days" is today plus the six behind it, so a
// preset's own end is always today in the tenant's timezone.
export const PERIOD_PRESET_DAYS: Record<PeriodPreset, number> = {
  week: 7,
  month: 30,
  quarter: 90,
};

export const PERIOD_PRESETS: PeriodPreset[] = ["week", "month", "quarter"];

// 30 days: long enough that a list is never empty on a Monday morning, short
// enough that the recap above it still describes a period the reader
// recognises as "recently".
export const DEFAULT_PERIOD_PRESET: PeriodPreset = "month";

/**
 * The longest a single window may be, as the API enforces it (see
 * VISIT_PERIOD_MAX_MONTHS and TASK_COMPLETED_PERIOD_MAX_MONTHS, which agree).
 * Not a horizon: an older range still returns its data, it just has to be asked
 * for in windows of at most this length.
 */
export const PERIOD_MAX_MONTHS = 12;

/** A pair of calendar days, YYYY-MM-DD — the format the API's date filters take. */
export type DayRange = { from: string; to: string };

export type Period = DayRange & {
  // Which pill is lit. "custom" covers any range the presets can't produce.
  preset: PeriodPreset | "custom";
  // True while the window is the unasked-for default, so a screen can tell "the
  // reader chose 30 days" from "nobody chose anything yet" — the second one
  // must not light up the filter panel's active dot.
  isDefault: boolean;
  // True when the request was longer than one window may be and the API trimmed
  // it. The data behind the trimmed part still exists — it just needs asking
  // for in its own window — so a screen says so rather than implying the
  // history ends here.
  clamped: boolean;
};

/**
 * The two URL parameters a screen carries its window in. The names reach the
 * address bar and the API query alike, so a screen names them once and every
 * helper here reads and writes through them.
 */
export type PeriodParamNames = { from: string; to: string };

export const VISIT_PERIOD_PARAMS: PeriodParamNames = {
  from: "startedFrom",
  to: "startedTo",
};

export const TASK_COMPLETED_PERIOD_PARAMS: PeriodParamNames = {
  from: "completedFrom",
  to: "completedTo",
};

/**
 * A moment's calendar day in the tenant's timezone as YYYY-MM-DD.
 *
 * en-CA renders exactly that shape and the locale is never shown — it is a
 * formatting detail, not a user-facing choice.
 */
export function dayInTimeZone(timeZone: string, moment: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).format(moment);
}

/** Today's calendar day in the tenant's timezone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()) {
  return dayInTimeZone(timeZone, now);
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

/** A URL value that is a calendar day, or null for anything else. */
export function normalizeDayParam(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

/** The window a preset stands for, ending today in the tenant's timezone. */
export function periodPresetRange(
  preset: PeriodPreset,
  timeZone: string,
  now: Date = new Date(),
): DayRange {
  const to = todayInTimeZone(timeZone, now);

  return { from: shiftDay(to, -(PERIOD_PRESET_DAYS[preset] - 1)), to };
}

/**
 * The window a request is actually read through: whatever the URL asked for, or
 * the default preset when it asked for nothing.
 *
 * A half-open range (one bound given) is completed rather than left open — an
 * open end is the unnamed period this whole control exists to retire.
 */
export function resolvePeriod(
  requested: { from?: string | null; to?: string | null },
  timeZone: string,
  now: Date = new Date(),
): Period {
  const today = todayInTimeZone(timeZone, now);
  const requestedFrom = requested.from ?? null;
  const requestedTo = requested.to ?? null;
  const to = requestedTo ?? today;
  // With only an end given (or neither), the open start falls back to the
  // default window's length rather than to the beginning of time.
  const from =
    requestedFrom ??
    shiftDay(to, -(PERIOD_PRESET_DAYS[DEFAULT_PERIOD_PRESET] - 1));
  // A backwards range would ask the API for an empty set; swapping the ends
  // reads it as the range the person meant.
  const ordered = from <= to ? { from, to } : { from: to, to: from };
  const fallback = periodPresetRange(DEFAULT_PERIOD_PRESET, timeZone, now);

  return {
    ...ordered,
    preset: matchPeriodPreset(ordered, today),
    // The *window*, not the URL, decides this. These screens seed their date
    // inputs with the resolved window and the filter form serializes every
    // non-empty field, so merely clicking a status pill writes the default
    // dates into the URL — reading "has dates" as "the user chose a period"
    // would light the filter panel's active dot and offer a reset for a window
    // nobody picked.
    isDefault: ordered.from === fallback.from && ordered.to === fallback.to,
    clamped: false,
  };
}

/** The window a URL carries, resolved through this screen's two parameters. */
export function resolvePeriodFromParams(
  params: Record<string, string | undefined>,
  names: PeriodParamNames,
  timeZone: string,
  now: Date = new Date(),
): Period {
  return resolvePeriod(
    {
      from: normalizeDayParam(params[names.from]),
      to: normalizeDayParam(params[names.to]),
    },
    timeZone,
    now,
  );
}

/** A range as the two URL parameters that carry it. */
export function periodSearchParams(
  range: DayRange,
  names: PeriodParamNames,
): Record<string, string> {
  return { [names.from]: range.from, [names.to]: range.to };
}

/**
 * The window as the API actually read it, which is the one worth naming.
 *
 * A saved link or an old tab can ask for a window longer than the maximum; the
 * API trims it from the near end, and a header that still announced the
 * requested range would be claiming rows nobody looked for. Comparing in
 * calendar days (the API answers in instants) keeps this from firing on the
 * sub-second difference between an end-of-day bound and its own echo. The
 * trimmed-away data is still reachable — see `clamped`.
 *
 * `apiFrom` is the lower bound the API reports, or undefined when it reported
 * none — which is what an older build serving mid-deploy looks like, and is
 * never grounds to rewrite the window.
 */
export function periodAsRead(
  period: Period,
  apiFrom: string | null | undefined,
  timeZone: string,
): Period {
  if (!apiFrom) {
    return period;
  }

  const readFrom = dayInTimeZone(timeZone, new Date(apiFrom));

  if (readFrom <= period.from) {
    return period;
  }

  return {
    ...period,
    from: readFrom,
    // A trimmed window is nobody's preset and nobody's default.
    preset: "custom",
    isDefault: false,
    clamped: true,
  };
}

/**
 * Which preset a range is, if any: a preset always ends today, so a range that
 * ends earlier is a custom one even when its length happens to match.
 */
function matchPeriodPreset(
  range: DayRange,
  today: string,
): PeriodPreset | "custom" {
  if (range.to !== today) {
    return "custom";
  }

  const length = daysBetween(range.from, range.to);

  return (
    PERIOD_PRESETS.find((preset) => PERIOD_PRESET_DAYS[preset] === length) ??
    "custom"
  );
}

// Translator scoped to `common.period` (from `useTranslations` or
// `getTranslations`), the one dictionary every screen names periods from.
export type PeriodTranslator = ReturnType<
  typeof useTranslations<"common.period">
>;

/**
 * What the window is called wherever it is shown: a preset by its name, a
 * hand-picked range by its two ends. Never "everything" — every list this
 * labels is bounded.
 */
export function periodLabel(
  t: PeriodTranslator,
  format: IntlFormatter,
  period: DayRange & { preset: PeriodPreset | "custom" },
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

  return t("custom", { from: day(period.from), to: day(period.to) });
}

/**
 * The window of the same length sitting immediately before this one — where the
 * list continues once the current window is read out. No gap and no overlap, so
 * paging back through periods never skips or repeats a day.
 */
export function previousPeriod(range: DayRange): DayRange {
  const length = daysBetween(range.from, range.to);

  return { from: shiftDay(range.from, -length), to: shiftDay(range.from, -1) };
}

/**
 * Where this history begins — three states, because the API answers three
 * different things and only one of them is a date.
 *
 * `day` is the calendar day (tenant timezone) of the earliest row in scope,
 * which only the API can know. This replaced an arithmetic floor of "today
 * minus 12 months", a contract that does not exist: the clamp bounds a window's
 * length, so a reader can always reach further back by naming an earlier range.
 * The only true bottom is the first row ever recorded.
 *
 * `empty` is the API saying, with authority, that this scope holds nothing at
 * all — a rep who has not worked yet, or a status nothing was ever filed under.
 * There is no earlier period to offer, because there is no period.
 *
 * `unknown` is not an answer: the request failed, or an older build is serving
 * during a deploy. Nothing may be claimed from it.
 *
 * Collapsing `empty` into `unknown` is what this type exists to prevent — they
 * lead to opposite behavior, and a truthful "nothing was ever recorded" that
 * arrives as "no information" turns into an endless walk back through empty
 * windows.
 */
export type HistoryFloor =
  { state: "day"; day: string } | { state: "empty" } | { state: "unknown" };

export function historyFloor(
  // `null` and `undefined` mean different things here, so this deliberately
  // does not test for truthiness.
  historyStart: string | null | undefined,
  timeZone: string,
): HistoryFloor {
  if (historyStart === undefined) {
    return { state: "unknown" };
  }

  if (historyStart === null) {
    return { state: "empty" };
  }

  return { state: "day", day: dayInTimeZone(timeZone, new Date(historyStart)) };
}

/**
 * Whether the list may offer a step back into the window behind this one.
 *
 * The screens' shared rule, in one place: with no answer about where the
 * history begins the step stays offered rather than announcing an end nobody
 * confirmed; a confirmed-empty scope withholds it, because there is no earlier
 * period when there is no period.
 */
export function hasEarlierPeriod(
  range: DayRange,
  floor: HistoryFloor,
): boolean {
  return (
    floor.state === "unknown" ||
    (floor.state === "day" && previousPeriod(range).to >= floor.day)
  );
}
