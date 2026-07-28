/**
 * Whether a day belongs in the field visit history's finished tail — the one
 * collapsed section under the days that still need something — rather than in
 * the running list.
 *
 * The list exists to surface loose ends, so a day where every workable visit
 * is completed has nothing left to act on. Filing it away is only right under
 * two conditions, both of which this function insists on: getting either wrong
 * puts a day that still needs work behind a lid, which is why the rule lives
 * here with a test rather than inline in the component.
 */
export function isDayFullyDone({
  completedPercent,
  dayTotalsTrusted,
  statusFilterActive,
}: {
  /** Completed share of the day's workable (non-cancelled) visits, or null when there is nothing to take a share of. */
  completedPercent: number | null;
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
}): boolean {
  if (statusFilterActive || !dayTotalsTrusted) {
    return false;
  }

  return completedPercent === 100;
}
