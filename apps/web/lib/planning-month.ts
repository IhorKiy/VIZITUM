/**
 * Month arithmetic for the field planning screen's month mode, alongside the
 * Monday-first week arithmetic in `./planning-week`.
 *
 * Same rule as there: a plan date is a calendar date (`YYYY-MM-DD`), never a
 * timestamp, and every step runs at UTC so a DST boundary cannot move a day.
 */

import { addDaysToDate, isDateString } from "./planning-week";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** Shape *and* range — "2026-13" is refused, not rolled into January 2027. */
export function isMonthString(
  value: string | undefined | null,
): value is string {
  if (typeof value !== "string" || !MONTH_PATTERN.test(value)) {
    return false;
  }

  const monthNumber = Number(value.slice(5, 7));

  return monthNumber >= 1 && monthNumber <= 12;
}

/** The month a date belongs to: "2026-08-06" → "2026-08". */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function startOfMonth(month: string): string {
  return `${month}-01`;
}

/**
 * The last day of a month, found by stepping back one day from the first of
 * the next — which avoids restating the 28/29/30/31 table and gets leap
 * years right for free.
 */
export function endOfMonth(month: string): string {
  return addDaysToDate(startOfMonth(addMonths(month, 1)), -1);
}

export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  // Date.UTC normalizes an out-of-range month index itself, so December + 1
  // becomes the next January without a carry of our own.
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));

  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string): number {
  return Number(endOfMonth(month).slice(8, 10));
}

/**
 * A month laid out for a Monday-first grid: the dates themselves plus the
 * count of empty cells before the 1st, which the caller renders as grid
 * placeholders so the 1st lands under its own weekday.
 */
export function monthGrid(month: string): {
  leadingBlanks: number;
  dates: string[];
} {
  const first = startOfMonth(month);
  // getUTCDay() is Sunday-based; shift so Monday is 0 and Sunday is 6.
  const weekday = new Date(`${first}T00:00:00.000Z`).getUTCDay();

  return {
    leadingBlanks: (weekday + 6) % 7,
    dates: Array.from({ length: daysInMonth(month) }, (_, index) =>
      addDaysToDate(first, index),
    ),
  };
}

/**
 * Every date from `from` to `to` inclusive, both ends being calendar dates.
 * Backs shift-click range selection on the month grid; an inverted pair is
 * read in the order that makes a range, since which end the reader clicked
 * first says nothing about which is earlier.
 */
export function datesBetween(from: string, to: string): string[] {
  if (!isDateString(from) || !isDateString(to)) {
    return [];
  }

  const [start, end] = from <= to ? [from, to] : [to, from];
  const dates: string[] = [];

  for (let date = start; date <= end; date = addDaysToDate(date, 1)) {
    dates.push(date);
  }

  return dates;
}
