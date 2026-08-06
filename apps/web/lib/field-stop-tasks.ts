/**
 * What is open at a location, as the field home's stop card reports it: how
 * many tasks are late, how many are due today, and how many there are at all.
 */
export type StopTaskSummary = {
  overdue: number;
  dueToday: number;
  total: number;
};

/** The two fields of a task this fold reads, and nothing else. */
type SummarisableTask = {
  locationId: string | null;
  dueDate: string | null;
};

/**
 * Open tasks folded down to one line per location.
 *
 * Tasks with no location belong to no stop and are dropped. A due date before
 * the reader's today is late; one matching it is due today; a later one, or
 * none at all, still counts toward the total — the card's "N tasks" is every
 * open task there, not only the dated ones.
 *
 * Both comparisons are string comparisons over "YYYY-MM-DD", which is why the
 * caller resolves today in the tenant timezone and passes it in rather than
 * this parsing a Date: a Date would compare against the server's midnight,
 * which is a different day for part of every day.
 *
 * Lives in lib/ rather than beside its caller so it can be read by a test
 * without the Next runtime the page pulls in (tests/web-field-stop-task-
 * summaries.test.ts).
 */
export function summariseTasksByLocation(
  tasks: SummarisableTask[],
  todayIsoDate: string,
): Record<string, StopTaskSummary> {
  const summaries: Record<string, StopTaskSummary> = {};

  for (const task of tasks) {
    if (!task.locationId) {
      continue;
    }

    const summary = (summaries[task.locationId] ??= {
      overdue: 0,
      dueToday: 0,
      total: 0,
    });

    summary.total += 1;

    const dueDate = task.dueDate?.slice(0, 10);

    if (!dueDate) {
      continue;
    }

    if (dueDate < todayIsoDate) {
      summary.overdue += 1;
    } else if (dueDate === todayIsoDate) {
      summary.dueToday += 1;
    }
  }

  return summaries;
}
