/**
 * Monday-first week arithmetic for the field planning screen.
 *
 * Every date here is a plain calendar date (`YYYY-MM-DD`), never a timestamp:
 * a plan date is the day a representative works, not an instant, and the
 * backend stores it as `@db.Date`. Arithmetic runs at UTC midnight so adding
 * days can't land on a DST boundary and lose or gain an hour — a local-time
 * `Date` shifted by 24h across a spring-forward returns the same day.
 *
 * Formatting keeps a separate convention: `dateToUtcNoon` hands the next-intl
 * formatters a UTC-noon instant, so rendering with `timeZone: "UTC"` can't
 * slip to the neighbouring day the way midnight would.
 */

export const DAYS_IN_WEEK = 7;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Shape *and* calendar validity — "2026-02-31" is rejected, not rolled over. */
export function isDateString(
  value: string | undefined | null,
): value is string {
  if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toUtcMidnight(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Today in the server's own zone, as a calendar date. */
export function todayDateString(): string {
  const now = new Date();

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDaysToDate(dateStr: string, days: number): string {
  return toDateString(
    new Date(toUtcMidnight(dateStr).getTime() + days * MILLISECONDS_PER_DAY),
  );
}

/**
 * The Monday of `dateStr`'s week. `getUTCDay()` is Sunday-based (0), so
 * Sunday has to fall back a full six days rather than forward one — the
 * off-by-one that turns "this week" into "next week" every seventh day.
 */
export function startOfWeek(dateStr: string): string {
  const weekday = toUtcMidnight(dateStr).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;

  return addDaysToDate(dateStr, -daysSinceMonday);
}

/** The seven calendar dates of the week starting at `weekStart`, Monday first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, index) =>
    addDaysToDate(weekStart, index),
  );
}

/**
 * A UTC-noon instant for a calendar date, for handing to the next-intl
 * formatters alongside `timeZone: "UTC"`.
 */
export function dateToUtcNoon(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day, 12));
}
