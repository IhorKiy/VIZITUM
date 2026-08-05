import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { AssignRouteButton } from "../../../../../components/assign-route-button";
import { CopyWeekButton } from "../../../../../components/copy-week-button";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import { UnassignRouteButton } from "../../../../../components/unassign-route-button";
import {
  assignRouteTemplate,
  copyRouteWeek,
  deleteRoutePlan,
  getCurrentSession,
  listRouteTemplates,
  listRoutes,
  type RoutePlan,
  type RouteTemplate,
} from "../../../../../lib/api-client";
import { backOrigin, withBackOrigin } from "../../../../../lib/back-navigation";
import type { IntlFormatter } from "../../../../../lib/format";
import { getFormString } from "../../../../../lib/form";
import {
  addDaysToDate,
  dateToUtcNoon,
  DAYS_IN_WEEK,
  isDateString,
  startOfWeek,
  todayDateString,
  weekDates,
} from "../../../../../lib/planning-week";

type PlanningPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    date?: string;
    planning?: string;
    // Read only to recognise links written for earlier shapes of this screen;
    // see the redirect and the `month` fallback below.
    month?: string;
    tab?: string;
    route?: string;
    template?: string;
  }>;
};

export default async function PlanningPage({
  params,
  searchParams,
}: PlanningPageProps) {
  const { tenantSlug } = await params;
  const { tab, route, template, month, date, planning } = await searchParams;

  // Routes moved to their own screen, now reached from the field menu. Links
  // written for the old tabbed screen — bookmarks, a `from` origin already
  // handed out, the route editor's own deep links — still name this path, so
  // they are forwarded rather than silently landing on the calendar.
  //
  // The whole shape travels, not just the path: a redirect landing mid-flight
  // from a server action (`?template=created`) would otherwise swallow the
  // notice that says the action worked.
  if (tab === "routes" || route || template) {
    const forwarded = new URLSearchParams();

    if (route) {
      forwarded.set("route", route);
    }

    if (template) {
      forwarded.set("template", template);
    }

    const search = forwarded.toString();

    redirect(
      search
        ? `/${tenantSlug}/field/routes?${search}`
        : `/${tenantSlug}/field/routes`,
    );
  }

  const [t, tCommon, format] = await Promise.all([
    getTranslations("field.planning"),
    getTranslations("common"),
    getFormatter(),
  ]);

  // `month` is what the month calendar this screen replaced put in its links,
  // and those are still in the wild — bookmarks, and every `from` origin the
  // routes screen was handed. Honouring it as an anchor keeps such a link
  // landing on the week the reader meant instead of silently on this one.
  const anchorDate = resolveAnchorDate(date, month);
  const weekStart = startOfWeek(anchorDate);
  const weekDays = weekDates(weekStart);
  const weekEnd = weekDays[DAYS_IN_WEEK - 1];
  const today = todayDateString();

  async function assignRouteTemplateAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "routeTemplateId").trim();
    const planDate = getFormString(formData, "planDate").trim() || anchorDate;

    if (!templateId) {
      redirect(planningHref(tenantSlug, planDate, "failed"));
    }

    const result = await assignRouteTemplate(templateId, { planDate });

    if (!result.ok) {
      redirect(planningHref(tenantSlug, planDate, "failed"));
    }

    redirect(planningHref(tenantSlug, planDate, "assigned"));
  }

  async function unassignRoutePlanAction(formData: FormData) {
    "use server";

    const routePlanId = getFormString(formData, "routePlanId").trim();

    if (!routePlanId) {
      redirect(planningHref(tenantSlug, anchorDate, "failed"));
    }

    const result = await deleteRoutePlan(routePlanId);

    if (!result.ok) {
      redirect(planningHref(tenantSlug, anchorDate, "failed"));
    }

    redirect(planningHref(tenantSlug, anchorDate, "unassigned"));
  }

  async function copyWeekAction(formData: FormData) {
    "use server";

    const sourceWeekStart =
      getFormString(formData, "weekStart").trim() || weekStart;
    const targetWeekStart = addDaysToDate(sourceWeekStart, DAYS_IN_WEEK);
    const result = await copyRouteWeek({
      fromWeekStart: sourceWeekStart,
      toWeekStart: targetWeekStart,
    });

    if (!result.ok) {
      redirect(planningHref(tenantSlug, anchorDate, "failed"));
    }

    // Lands on the week that just received the copy, not the one it came
    // from: the counts below are about days the reader cannot see from here,
    // and a success notice pointing at an unchanged screen reads as a no-op.
    redirect(
      planningHref(
        tenantSlug,
        targetWeekStart,
        `copied:${result.data.createdCount}:${result.data.skippedCount}`,
      ),
    );
  }

  const sessionResult = await getCurrentSession();

  if (!sessionResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field-planning">
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("eyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("signedOutBody")}</p>
          </div>
          <div
            className="toolbar"
            aria-label={tCommon("notice.sessionActions")}
          >
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>
        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{tCommon("notice.backendNotConnected")}</h2>
            <p>{sessionResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  // Explicit `representativeUserId` is what keeps this screen personal for a
  // caller who also holds `routes.manage_team` (e.g. this repo's "all roles"
  // demo account, or any team_manager who is also a field rep). The backend
  // reads an omitted filter as team-wide and answers with the whole tenant,
  // so dropping this param would quietly show a dual-role rep every
  // colleague's plans on their own field screen. It used to fail loudly
  // instead — an omitted filter was a 403 — so there is no longer an error
  // to catch its absence, only this line.
  const ownRepresentativeQuery = `representativeUserId=${sessionResult.data.user.id}`;
  // Scoped to the seven days on screen via the date-range filter, so paging
  // can no longer decide what the week shows. The month calendar this screen
  // replaced had no such filter and asked for the rep's 100 most recent plans
  // instead, then filtered them here — which silently emptied any week that
  // had fallen out of that window, and emptied it faster the more templates a
  // rep assigned per day.
  const [templatesResult, routesResult] = await Promise.all([
    listRouteTemplates(`pageSize=100&${ownRepresentativeQuery}`),
    listRoutes(
      `pageSize=100&${ownRepresentativeQuery}&planDateFrom=${weekStart}&planDateTo=${weekEnd}`,
    ),
  ]);
  const routeTemplates = templatesResult.ok ? templatesResult.data.items : [];
  const routePlans = routesResult.ok ? routesResult.data.items : [];

  const plansByDate = groupPlansByDate(routePlans);
  const weekStopCount = routePlans.reduce(
    (total, plan) => total + plan.items.length,
    0,
  );
  const plannedDayCount = weekDays.filter((day) => plansByDate.has(day)).length;

  const previousWeek = addDaysToDate(weekStart, -DAYS_IN_WEEK);
  const nextWeek = addDaysToDate(weekStart, DAYS_IN_WEEK);
  const statusNotice = buildPlanningStatusNotice(planning, t);
  const hasAnyTemplate = routeTemplates.length > 0;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field-planning">
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
        </div>
      </header>

      {statusNotice}

      <div className="panel week-card">
        <div className="route-section-head">
          <Link
            className="secondary-button is-accent"
            href={planningHref(tenantSlug, previousWeek)}
            aria-label={t("previousWeek")}
          >
            ‹
          </Link>
          <div className="week-card-heading">
            <h2>{formatWeekRange(weekStart, weekEnd, format)}</h2>
            <p className="week-card-summary">
              {t("weekSummary", {
                stops: weekStopCount,
                planned: plannedDayCount,
                total: DAYS_IN_WEEK,
              })}
            </p>
          </div>
          <Link
            className="secondary-button is-accent"
            href={planningHref(tenantSlug, nextWeek)}
            aria-label={t("nextWeek")}
          >
            ›
          </Link>
        </div>

        <div className="week-grid">
          {weekDays.map((day) => {
            const plans = plansByDate.get(day) ?? [];
            const stopCount = plans.reduce(
              (total, plan) => total + plan.items.length,
              0,
            );
            const isSelected = day === anchorDate;
            const isToday = day === today;

            return (
              <Link
                aria-current={isSelected ? "date" : undefined}
                aria-label={dayCellLabel(day, plans, format, t)}
                className={`week-cell${plans.length > 0 ? " has-plan" : " is-empty"}${
                  isSelected ? " is-selected" : ""
                }`}
                // Selecting a day also anchors at its row, so a tap on the
                // grid lands the reader on the thing they tapped rather than
                // leaving them to find it in the list below.
                href={`${planningHref(tenantSlug, day)}#${dayRowId(day)}`}
                key={day}
              >
                <span
                  className={`week-cell-weekday${isToday ? " is-today" : ""}`}
                >
                  {formatWeekday(day, format)}
                </span>
                <span className="week-cell-number">{dayOfMonth(day)}</span>
                {plans.length > 0 ? (
                  <span className="week-cell-count">{stopCount}</span>
                ) : (
                  <span className="week-cell-add" aria-hidden="true">
                    +
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      <section className="week-days" aria-label={t("weekDaysAria")}>
        <div className="week-days-head">
          <h2 className="week-days-title">{t("weekDaysTitle")}</h2>
          {hasAnyTemplate ? (
            <CopyWeekButton copyAction={copyWeekAction} weekStart={weekStart} />
          ) : null}
        </div>

        {hasAnyTemplate ? (
          <ul className="week-day-list">
            {weekDays.map((day) => (
              <li id={dayRowId(day)} key={day}>
                {renderDayRow({
                  assignAction: assignRouteTemplateAction,
                  day,
                  format,
                  isSelected: day === anchorDate,
                  isToday: day === today,
                  plans: plansByDate.get(day) ?? [],
                  routeTemplates,
                  t,
                  unassignAction: unassignRoutePlanAction,
                })}
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyRoutesTitle")}</h2>
            <p>{t("noTemplatesForAssignBody")}</p>
            {/* The routes screen moved into the field menu, so it no longer
                has a nav slot to come back from: this hand-off states the
                calendar — on the day the rep is looking at — as the origin,
                and the routes screen resolves it. */}
            <Link
              className="secondary-button"
              href={withBackOrigin(
                `/${tenantSlug}/field/routes`,
                backOrigin("/field/planning", { date: anchorDate }),
              )}
            >
              {t("goToRoutes")}
            </Link>
          </div>
        )}
      </section>
    </AppShell>
  );
}

type PlanningTranslator = Awaited<
  ReturnType<typeof getTranslations<"field.planning">>
>;

type DayRowProps = {
  assignAction: (formData: FormData) => Promise<void>;
  day: string;
  format: IntlFormatter;
  isSelected: boolean;
  isToday: boolean;
  plans: RoutePlan[];
  routeTemplates: RouteTemplate[];
  t: PlanningTranslator;
  unassignAction: (formData: FormData) => Promise<void>;
};

/**
 * One row per day, not per assignment: a day can hold several route plans
 * (one per template — see the partial unique indexes on RoutePlan), and
 * repeating the date column for each would break the week's one-row-per-day
 * rhythm and make an unplanned day and a second route look alike.
 */
function renderDayRow({
  assignAction,
  day,
  format,
  isSelected,
  isToday,
  plans,
  routeTemplates,
  t,
  unassignAction,
}: DayRowProps) {
  const weekdayLabel = formatWeekday(day, format);
  // Templates already on this day are withheld from its picker, so the
  // backend never has to answer the same (day, template) pair with a 409.
  const assignable = availableRouteTemplates(routeTemplates, plans);

  if (plans.length === 0) {
    return assignable.length > 0 ? (
      <AssignRouteButton
        assignAction={assignAction}
        dayNumber={dayOfMonth(day)}
        isToday={isToday}
        planDate={day}
        routeTemplates={assignable}
        variant="day"
        weekdayLabel={weekdayLabel}
      />
    ) : null;
  }

  return (
    <div
      className={`week-day-row${isToday ? " is-today" : ""}${
        isSelected ? " is-selected" : ""
      }`}
    >
      <span className="week-day-col">
        <span className="week-day-weekday">{weekdayLabel}</span>
        <span className="week-day-number">{dayOfMonth(day)}</span>
      </span>
      <span className="week-day-divider" aria-hidden="true" />
      <div className="week-day-body">
        {isToday ? (
          <span className="week-day-today-badge">{t("todayBadge")}</span>
        ) : null}
        <ul className="week-day-routes">
          {plans.map((plan) => (
            <li className="week-day-route" key={plan.id}>
              <span className="week-day-route-text">
                <span className="week-day-route-name">
                  {plan.routeTemplate?.name ?? t("assignedPlanNoTemplate")}
                </span>
                <span className="week-day-route-meta">
                  {t("routeStopsCount", { count: plan.items.length })}
                </span>
              </span>
              {/* Only a draft can be withdrawn — once the day is published or
                  under way, removing it is not this screen's call. */}
              {plan.status === "draft" ? (
                <UnassignRouteButton
                  routePlanId={plan.id}
                  routeName={
                    plan.routeTemplate?.name ?? t("assignedPlanNoTemplate")
                  }
                  unassignAction={unassignAction}
                />
              ) : null}
            </li>
          ))}
        </ul>
        {assignable.length > 0 ? (
          <AssignRouteButton
            assignAction={assignAction}
            planDate={day}
            routeTemplates={assignable}
            variant="inline"
          />
        ) : null}
      </div>
    </div>
  );
}

// Templates not already assigned to this day — keeps the "add another
// route" picker from offering (and the backend from rejecting with a 409)
// the same template twice on one day.
function availableRouteTemplates(
  routeTemplates: RouteTemplate[],
  plans: RoutePlan[],
): RouteTemplate[] {
  const assignedTemplateIds = new Set(
    plans
      .map((plan) => plan.routeTemplateId)
      .filter((id): id is string => id !== null),
  );

  return routeTemplates.filter(
    (template) => !assignedTemplateIds.has(template.id),
  );
}

function groupPlansByDate(plans: RoutePlan[]): Map<string, RoutePlan[]> {
  const grouped = new Map<string, RoutePlan[]>();

  for (const plan of plans) {
    // `planDate` is a date-only column, but it arrives as JSON so it may be
    // serialized either bare or as a full ISO instant; both start with the
    // calendar date this screen keys on.
    const key = plan.planDate.slice(0, 10);
    const existing = grouped.get(key);

    if (existing) {
      existing.push(plan);
    } else {
      grouped.set(key, [plan]);
    }
  }

  return grouped;
}

function resolveAnchorDate(
  date: string | undefined,
  month: string | undefined,
): string {
  if (isDateString(date)) {
    return date;
  }

  if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) {
    const firstOfMonth = `${month}-01`;

    if (isDateString(firstOfMonth)) {
      return firstOfMonth;
    }
  }

  return todayDateString();
}

function buildPlanningStatusNotice(
  status: string | undefined,
  t: PlanningTranslator,
) {
  if (!status) {
    return null;
  }

  if (status.startsWith("copied:")) {
    const [, createdCount, skippedCount] = status.split(":");
    return (
      <DismissableNotice
        ariaLabel={t("statusAria")}
        body={t("weekCopiedBody", {
          createdCount: Number(createdCount) || 0,
          skippedCount: Number(skippedCount) || 0,
        })}
        clearParams={["planning"]}
        eyebrow={t("weekCopiedTitle")}
        title={t("weekCopiedTitle")}
        tone="success"
      />
    );
  }

  // Success entries stay title-only so they render as the compact line.
  const noticeMap: Record<
    string,
    { title: string; body?: string; tone: "success" | "danger" } | undefined
  > = {
    assigned: {
      title: t("assignedTitle"),
      tone: "success",
    },
    unassigned: {
      title: t("unassignedTitle"),
      tone: "success",
    },
    failed: {
      title: t("failedTitle"),
      body: t("failedBody"),
      tone: "danger",
    },
  };

  const notice = noticeMap[status];

  if (!notice) {
    return null;
  }

  return (
    <DismissableNotice
      ariaLabel={t("statusAria")}
      body={notice.body}
      clearParams={["planning"]}
      eyebrow={notice.title}
      title={notice.title}
      tone={notice.tone}
    />
  );
}

function planningHref(
  tenantSlug: string,
  date: string,
  planning?: string,
): string {
  const params = new URLSearchParams({ date });

  if (planning) {
    params.set("planning", planning);
  }

  return `/${tenantSlug}/field/planning?${params.toString()}`;
}

function dayRowId(date: string): string {
  return `plan-day-${date}`;
}

function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

function formatWeekday(date: string, format: IntlFormatter): string {
  return format.dateTime(dateToUtcNoon(date), {
    weekday: "short",
    timeZone: "UTC",
  });
}

/**
 * "3 — 9 August" / "31 July — 6 August" — `dateTimeRange` collapses the
 * shared parts itself per locale, so neither the month nor the year is
 * repeated when both ends share it.
 */
function formatWeekRange(
  weekStart: string,
  weekEnd: string,
  format: IntlFormatter,
): string {
  return format.dateTimeRange(
    dateToUtcNoon(weekStart),
    dateToUtcNoon(weekEnd),
    { day: "numeric", month: "long", timeZone: "UTC" },
  );
}

/**
 * The grid cell's own accessible name. Colour and a bare number carry the
 * day's state visually; without this a screen reader hears "6" and cannot
 * tell a planned day from an empty one.
 */
function dayCellLabel(
  date: string,
  plans: RoutePlan[],
  format: IntlFormatter,
  t: PlanningTranslator,
): string {
  const dayLabel = format.dateTime(dateToUtcNoon(date), {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  if (plans.length === 0) {
    return t("dayCellEmptyAria", { day: dayLabel });
  }

  return t("dayCellPlannedAria", {
    day: dayLabel,
    routes: plans
      .map((plan) => plan.routeTemplate?.name ?? t("assignedPlanNoTemplate"))
      .join(", "),
    count: plans.reduce((total, plan) => total + plan.items.length, 0),
  });
}
