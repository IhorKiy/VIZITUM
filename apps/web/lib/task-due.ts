import type { TaskStatus } from "./api-client";
import type { IntlFormatter } from "./format";
import { isTaskUnfinished } from "./task-status";

// What the date rail on a field task card shows, and the tone it shows it in.
// The rail is the whole point of that card layout: a rep scanning the list
// reads one column of dates rather than a due line buried in each card, so the
// state of the deadline has to be decidable from the task alone.
export type TaskDueTone =
  | "overdue"
  | "today"
  | "upcoming"
  | "undated"
  // A finished task's due date is history — not late, not "today", just when
  // it had been due — so it reads in one quiet tone whatever the date says.
  | "done";

export type TaskDueState = {
  tone: TaskDueTone;
  // Whole calendar days from today to the due date, negative once the date has
  // passed and 0 on the day itself. `null` when the task has no due date (or
  // carries one this app cannot read). Days, not milliseconds, because the rail
  // reads it out as "-34 d".
  dayOffset: number | null;
  // Midnight UTC on the due day. Format it with formatDueDate below and
  // nothing else. `null` alongside a `null` dayOffset.
  dueAt: Date | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function describeTaskDue(
  task: { dueDate: string | null; status: TaskStatus },
  // Today's date in the tenant timezone, "YYYY-MM-DD" — resolved by the caller,
  // never from the server's local midnight.
  todayIsoDate: string,
): TaskDueState {
  const dueIsoDate = readIsoDate(task.dueDate);
  const dayOffset = dueIsoDate ? countDays(todayIsoDate, dueIsoDate) : null;
  const dated =
    dueIsoDate && dayOffset !== null
      ? { dayOffset, dueAt: dueDayInstant(dueIsoDate) }
      : { dayOffset: null, dueAt: null };

  if (!isTaskUnfinished(task.status)) {
    return { tone: "done", ...dated };
  }

  if (dated.dayOffset === null) {
    return { tone: "undated", ...dated };
  }

  if (dated.dayOffset < 0) {
    return { tone: "overdue", ...dated };
  }

  return { tone: dated.dayOffset === 0 ? "today" : "upcoming", ...dated };
}

// The bands the open task list is cut into, in the order they are shown. A rep
// works the list from the top, so the order is what is already late, then what
// the day asks for, then what is coming, then work with no day attached at all.
export const TASK_DUE_GROUP_KEYS = [
  "overdue",
  "today",
  "upcoming",
  "undated",
] as const;

export type TaskDueGroupKey = (typeof TASK_DUE_GROUP_KEYS)[number];

export type TaskDueGroup<T> = {
  key: TaskDueGroupKey;
  entries: { task: T; due: TaskDueState }[];
};

/**
 * Cuts a list of open tasks into the bands above, dropping empty ones so a
 * heading never stands over nothing. Banding is by date alone — a task's status
 * decides whether it belongs in this list at all, which is the caller's
 * question, not this one's.
 *
 * Dated tasks sort by due date ascending inside their band, which puts the
 * longest-overdue task at the top of the list; undated ones keep the order they
 * arrived in, since there is no date to sort them by.
 */
export function groupTasksByDue<
  T extends { dueDate: string | null; status: TaskStatus },
>(tasks: T[], todayIsoDate: string): TaskDueGroup<T>[] {
  const bands = new Map<TaskDueGroupKey, { task: T; due: TaskDueState }[]>();

  for (const task of tasks) {
    const due = describeTaskDue(task, todayIsoDate);
    const key: TaskDueGroupKey =
      due.dayOffset === null
        ? "undated"
        : due.dayOffset < 0
          ? "overdue"
          : due.dayOffset === 0
            ? "today"
            : "upcoming";
    const band = bands.get(key);

    if (band) {
      band.push({ task, due });
    } else {
      bands.set(key, [{ task, due }]);
    }
  }

  return TASK_DUE_GROUP_KEYS.flatMap((key) => {
    const entries = bands.get(key);

    if (!entries) {
      return [];
    }

    if (key !== "undated") {
      entries.sort((a, b) => (a.due.dayOffset ?? 0) - (b.due.dayOffset ?? 0));
    }

    return [{ key, entries }];
  });
}

function dueDayInstant(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/**
 * The one way to render a due day. A due date is a date, not a moment: it says
 * "the 3rd" and nothing about a time or a zone. Every other formatter on the
 * frontend renders in the tenant timezone, which is right for timestamps and
 * wrong here — the same instant is the 2nd in Los Angeles and the 4th in
 * Auckland, so the tenant's zone would silently move the deadline a day for
 * anyone outside Europe. Pinning the format to UTC, the zone the date-only
 * value was minted in, keeps the day the API sent; the locale (month names,
 * numbering) still comes from the reader's dictionary.
 */
export function formatDueDate(
  format: IntlFormatter,
  dueAt: Date,
  // Date parts only — a due date has no time to render, and the zone is this
  // function's whole point and not the caller's to pick.
  options: Pick<
    Intl.DateTimeFormatOptions,
    "dateStyle" | "day" | "month" | "weekday" | "year"
  >,
): string {
  return format.dateTime(dueAt, { ...options, timeZone: "UTC" });
}

// Both ends are read as UTC midnight, so the subtraction never crosses a DST
// boundary: the tenant's day is already baked into the two strings, and only
// the calendar distance between them is being taken here.
function countDays(fromIsoDate: string, toIsoDate: string): number | null {
  const from = readIsoDate(fromIsoDate);

  if (!from) {
    return null;
  }

  return Math.round(
    (Date.parse(`${toIsoDate}T00:00:00.000Z`) -
      Date.parse(`${from}T00:00:00.000Z`)) /
      MS_PER_DAY,
  );
}

// Accepts both a bare "YYYY-MM-DD" and a full timestamp, since the API has
// carried both shapes for dueDate. Anything else is treated as no date at all:
// a card with an unreadable rail is better than one claiming a wrong day.
function readIsoDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const isoDate = value.slice(0, 10);

  if (
    !ISO_DATE.test(isoDate) ||
    Number.isNaN(Date.parse(`${isoDate}T00:00:00.000Z`))
  ) {
    return null;
  }

  return isoDate;
}
