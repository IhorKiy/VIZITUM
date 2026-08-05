/**
 * Which calendar the planning screen draws. Shared by the server component
 * that resolves it and the client switcher that remembers it, so the cookie
 * name and the accepted values are stated once.
 */

export type PlanningView = "week" | "month";

export const PLANNING_VIEW_COOKIE = "vizitum_planning_view";

export const DEFAULT_PLANNING_VIEW: PlanningView = "week";

function asPlanningView(value: string | undefined): PlanningView | null {
  return value === "week" || value === "month" ? value : null;
}

/**
 * The URL wins over the remembered preference, and the preference over the
 * default — so a shared link opens the mode it names, whatever the reader
 * last chose here, while their own next visit still opens where they left
 * off. Anything unrecognised in either place falls through rather than
 * erroring: this only decides which of two calendars to draw.
 */
export function resolvePlanningView(
  fromUrl: string | undefined,
  fromCookie: string | undefined,
): PlanningView {
  return (
    asPlanningView(fromUrl) ??
    asPlanningView(fromCookie) ??
    DEFAULT_PLANNING_VIEW
  );
}
