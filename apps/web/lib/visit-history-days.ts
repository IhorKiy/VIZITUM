/**
 * Whether a day belongs in the field visit history's finished tail — the one
 * collapsed section under the days that still need something — rather than in
 * the running list.
 *
 * The list exists to surface loose ends, so a day where every workable visit
 * is completed has nothing left to act on. Filing it away is only right under
 * three conditions, all of which this function insists on: getting any of them
 * wrong puts a day that still needs work behind a lid, which is why the rule
 * lives here with a test rather than inline in the component.
 */
export function isDayFullyDone({
  completed,
  dayTotalsTrusted,
  statusFilterActive,
  workable,
}: {
  /** Visits on the day that reached "completed". */
  completed: number;
  /**
   * Whether the per-day totals came from the day-summary aggregate, which
   * covers the whole filtered set, rather than from the visits on this page.
   *
   * The page-local fallback only ever describes this page's slice of a day. A
   * day split across a page boundary whose slice happens to be all completed
   * would be filed as finished while the day itself is still unfinished — an
   * inaccurate percentage is survivable, work behind the wrong lid is not.
   */
  dayTotalsTrusted: boolean;
  /**
   * Whether a status pill is narrowing the list. Under one the rep asked for
   * those exact visits, fully-done days included, so nothing is folded away.
   */
  statusFilterActive: boolean;
  /**
   * Visits on the day that were there to be worked — the total minus the
   * cancelled ones, which were closed with a reason rather than left undone.
   */
  workable: number;
}): boolean {
  if (statusFilterActive || !dayTotalsTrusted) {
    return false;
  }

  // Nothing was there to finish — every visit on the day was cancelled — so
  // the day is not "done"; its cards carry their own cancelled pills.
  if (workable <= 0) {
    return false;
  }

  // Counted, never read off the rendered share: that share goes through
  // Math.round, so a day of 199 completed out of 200 displays as 100% while a
  // visit is still open. Rounding may flatter the header; it must not decide
  // that work is finished.
  return completed >= workable;
}
