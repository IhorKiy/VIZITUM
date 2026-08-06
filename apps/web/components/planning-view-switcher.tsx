"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { PLANNING_VIEW_COOKIE, type PlanningView } from "../lib/planning-view";

type PlanningViewSwitcherProps = {
  view: PlanningView;
  weekHref: string;
  monthHref: string;
};

/**
 * Week/month segmented control.
 *
 * The choice is remembered in a **cookie**, not `localStorage`, so the server
 * component can read it while rendering: the page is a Server Component that
 * already picks which calendar to draw, and a preference only the browser
 * knows would mean drawing the wrong one and swapping it after hydration.
 * The cookie is written here on click rather than by a server action, since
 * navigation itself is a `<Link>` — it works without JS, and the preference
 * is the one part that legitimately does not.
 */
export function PlanningViewSwitcher({
  view,
  weekHref,
  monthHref,
}: PlanningViewSwitcherProps) {
  const t = useTranslations("field.planning");

  function remember(next: PlanningView) {
    // A year, path-wide, Lax: a display preference, so it neither needs to
    // survive a cleared browser nor travel cross-site.
    document.cookie = `${PLANNING_VIEW_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div
      className="planning-view-switcher"
      role="group"
      aria-label={t("viewAria")}
    >
      <Link
        aria-current={view === "week" ? "page" : undefined}
        className={`planning-view-segment${view === "week" ? " is-active" : ""}`}
        href={weekHref}
        onClick={() => remember("week")}
      >
        {t("viewWeek")}
      </Link>
      <Link
        aria-current={view === "month" ? "page" : undefined}
        className={`planning-view-segment${view === "month" ? " is-active" : ""}`}
        href={monthHref}
        onClick={() => remember("month")}
      >
        {t("viewMonth")}
      </Link>
    </div>
  );
}
