/**
 * Whether a day disappears from the field visit history.
 *
 * The list exists to surface loose ends, so a day where every workable visit
 * is completed has nothing left to say. Hiding it is only safe under two
 * conditions, both of which this function insists on — the filter itself is
 * one line, but getting either condition wrong silently drops real work off
 * the screen, which is why it lives here with a test rather than inline.
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
   * would vanish while the day itself is still unfinished — an inaccurate
   * percentage is survivable, a missing day is not.
   */
  dayTotalsTrusted: boolean;
  /**
   * Whether a status pill is narrowing the list. Under one the rep asked for
   * those exact visits, fully-done days included, so nothing is hidden.
   */
  statusFilterActive: boolean;
}): boolean {
  if (statusFilterActive || !dayTotalsTrusted) {
    return false;
  }

  return completedPercent === 100;
}
