import type { Visit, VisitDaySummaryEntry } from "./api-client";

/**
 * What became of one day's visits, as the field visit history's day header
 * states it.
 *
 * The numbers come from the day-summary aggregate wherever there is one,
 * because that covers the whole filtered set while the cards under the header
 * only cover this page: a day straddling the 50-item page boundary would
 * otherwise be headed "2" on one page and "3" on the next, and a rep counting
 * their own work would be reading a page size rather than a day.
 */
export type VisitDayCounts = {
  cancelled: number;
  completed: number;
  /**
   * Everything that is neither completed nor cancelled — a report still to be
   * confirmed, and the draft that in practice never occurs.
   *
   * Derived rather than read: the aggregate carries `total`, `completed` and
   * `cancelled` only, and adding a fourth column to it to name a number that is
   * already implied would be a second place for the same fact to drift.
   */
  inProgress: number;
  total: number;
};

export function summarizeVisitDay({
  summaryEntry,
  visits,
}: {
  /** This day's row of the aggregate, absent when that request failed. */
  summaryEntry: VisitDaySummaryEntry | undefined;
  /** The day's visits on this page — the fallback, and never more than that. */
  visits: Visit[];
}): VisitDayCounts {
  const completed =
    summaryEntry?.completed ??
    visits.filter((visit) => visit.status === "completed").length;
  const cancelled =
    summaryEntry?.cancelled ??
    visits.filter((visit) => visit.status === "cancelled").length;
  const total = summaryEntry?.total ?? visits.length;

  return {
    cancelled,
    completed,
    // Floored at zero: the aggregate and the page are two reads a moment apart,
    // and a visit completed between them would otherwise show as "-1 open".
    inProgress: Math.max(0, total - completed - cancelled),
    total,
  };
}
