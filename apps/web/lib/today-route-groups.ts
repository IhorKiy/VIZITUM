/** The one field of a stop this grouping reads. */
type GroupableStop = {
  routePlanId: string;
};

export type RoutePlanGroup<TStop extends GroupableStop> = {
  routePlanId: string;
  /**
   * Where this group's stops start in the single run of numbers the reader
   * sees — the count of every stop in the groups above it.
   */
  startIndex: number;
  stops: TStop[];
};

/**
 * Today's stops split by the plan each came from, in the order the plans first
 * appear.
 *
 * The split is invisible to the reader, who sees one list for the day: it
 * exists because each plan is its own drag context, so a stop can never be
 * dragged out of its plan and into another — which matters most for a viewer
 * with team-wide access, whose list merges every representative's plan for
 * today (see getTodayRoutes).
 *
 * Since the numbers the reader sees run straight through that single list,
 * each group carries where its own stops start in it. The position *inside* a
 * group is not fixed — that is what the handle changes — so it is counted at
 * render against the live order rather than stored here.
 *
 * Lives in lib/ rather than beside its caller so it can be read by a test
 * without rendering the list (tests/web-field-route-day-numbering.test.ts).
 */
export function groupByRoutePlan<TStop extends GroupableStop>(
  stops: TStop[],
): Array<RoutePlanGroup<TStop>> {
  const order: string[] = [];
  const byPlan = new Map<string, TStop[]>();

  for (const stop of stops) {
    let planStops = byPlan.get(stop.routePlanId);

    if (!planStops) {
      planStops = [];
      byPlan.set(stop.routePlanId, planStops);
      order.push(stop.routePlanId);
    }

    planStops.push(stop);
  }

  let startIndex = 0;

  return order.map((routePlanId) => {
    const planStops = byPlan.get(routePlanId) as TStop[];
    const group = { routePlanId, startIndex, stops: planStops };

    startIndex += planStops.length;

    return group;
  });
}
