import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { AssignRouteButton } from "../../../../../components/assign-route-button";
import { CopyLastMonthButton } from "../../../../../components/copy-last-month-button";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import {
  CalendarIcon,
  MapPinIcon,
  RouteIcon,
} from "../../../../../components/icons";
import { UnassignRouteButton } from "../../../../../components/unassign-route-button";
import {
  assignRouteTemplate,
  copyRoutePlansFromLastMonth,
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

type PlanningPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    month?: string;
    date?: string;
    planning?: string;
    // Only read to recognise and forward a link written for the old combined
    // screen; see the redirect below.
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

  const selectedDate = isDateString(date) ? date : todayString();
  const currentMonth = isMonthString(month) ? month : selectedDate.slice(0, 7);

  async function assignRouteTemplateAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "routeTemplateId").trim();
    const planDate = getFormString(formData, "planDate").trim() || selectedDate;

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
    const planDate = getFormString(formData, "planDate").trim() || selectedDate;

    if (!routePlanId) {
      redirect(planningHref(tenantSlug, planDate, "failed"));
    }

    const result = await deleteRoutePlan(routePlanId);

    if (!result.ok) {
      redirect(planningHref(tenantSlug, planDate, "failed"));
    }

    redirect(planningHref(tenantSlug, planDate, "unassigned"));
  }

  async function copyRoutePlansAction(formData: FormData) {
    "use server";

    const targetMonth = getFormString(formData, "month").trim() || currentMonth;
    const result = await copyRoutePlansFromLastMonth({ month: targetMonth });

    if (!result.ok) {
      redirect(planningHref(tenantSlug, selectedDate, "failed"));
    }

    redirect(
      planningHref(
        tenantSlug,
        selectedDate,
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
  // This fetches the rep's whole plan history/future in one page, not just
  // the visible month — listRoutes has no date-range filter, only an exact
  // planDate — so plannedDates/daysPlannedThisMonth/selectedPlans below are
  // all derived by filtering this one page client-side. The requested
  // pageSize is capped server-side at MAX_PAGE_SIZE (100, see
  // src/common/pagination.ts) regardless of what's asked for here, so this
  // already only ever sees the rep's 100 most recent plans (by planDate).
  // Now that a day can hold several plans (one per template) instead of
  // one, that window shrinks proportionally: a rep assigning N templates to
  // every day exhausts it in ~100/N days instead of 100. There's no cheap
  // fix from this file alone — the real fix is a server-side date-range
  // filter on GET /routes so this only requests the visible month.
  const [templatesResult, routesResult] = await Promise.all([
    listRouteTemplates(`pageSize=100&${ownRepresentativeQuery}`),
    listRoutes(`pageSize=100&${ownRepresentativeQuery}`),
  ]);
  const routeTemplates = templatesResult.ok ? templatesResult.data.items : [];
  const routePlans = routesResult.ok ? routesResult.data.items : [];

  // A day can now hold several route plans (one per distinct template), so
  // this is an array, not a single find() — and daysPlannedThisMonth counts
  // distinct planDates, not plan rows, or a day with two plans would count
  // as two "days planned".
  const selectedPlans = routePlans.filter(
    (plan) => plan.planDate === selectedDate,
  );
  const plannedDates = new Set(routePlans.map((plan) => plan.planDate));
  const daysPlannedThisMonth = new Set(
    routePlans
      .filter((plan) => plan.planDate.startsWith(currentMonth))
      .map((plan) => plan.planDate),
  ).size;

  const grid = buildMonthGrid(currentMonth, format);
  const prevMonth = shiftMonth(currentMonth, -1);
  const nextMonth = shiftMonth(currentMonth, 1);
  const weekdayLabels = buildWeekdayLabels(format);
  const statusNotice = buildPlanningStatusNotice(planning, t);
  const assignableRouteTemplates = availableRouteTemplates(
    routeTemplates,
    selectedPlans,
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field-planning">
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
          <p>{formatLongDate(todayString(), format)}</p>
        </div>
      </header>

      {statusNotice}
      <div className="panel">
        <div className="route-section-head">
          <Link
            className="secondary-button is-accent"
            href={monthHref(tenantSlug, prevMonth, selectedDate)}
            aria-label={t("previousMonth")}
          >
            ‹
          </Link>
          <h2>{grid.label}</h2>
          <Link
            className="secondary-button is-accent"
            href={monthHref(tenantSlug, nextMonth, selectedDate)}
            aria-label={t("nextMonth")}
          >
            ›
          </Link>
        </div>
        <div className="days-planned-row">
          <p className="small-label">
            {t("daysPlannedLabel", { count: daysPlannedThisMonth })}
          </p>
          <CopyLastMonthButton
            copyAction={copyRoutePlansAction}
            month={currentMonth}
          />
        </div>

        <div className="calendar-grid">
          {weekdayLabels.map((weekday) => (
            <div className="calendar-weekday" key={weekday}>
              {weekday}
            </div>
          ))}
          {grid.leadingBlanks.map((blank) => (
            <div className="calendar-cell empty" key={`blank-${blank}`} />
          ))}
          {grid.days.map((day) => {
            const isSelected = day.dateStr === selectedDate;
            const isToday = day.dateStr === todayString();
            const hasPlan = plannedDates.has(day.dateStr);

            return (
              <Link
                aria-current={isSelected ? "date" : undefined}
                className={`calendar-cell${isSelected ? " selected" : ""}${
                  isToday ? " today" : ""
                }`}
                href={monthHref(tenantSlug, currentMonth, day.dateStr)}
                key={day.dateStr}
              >
                <span className="calendar-day-number">{day.day}</span>
                {hasPlan ? (
                  <span className="calendar-dot" aria-hidden="true" />
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="panel" aria-label={t("selectedDayAria")}>
        {selectedDate === todayString() ? (
          <div className="route-card-meta">
            <CalendarIcon />
            {t("todayLegend")}
          </div>
        ) : null}
        <h2>{formatLongDate(selectedDate, format)}</h2>

        {selectedPlans.length > 0 ? (
          <ul className="route-card-list">
            {selectedPlans.map((plan) => (
              <li className="route-card" key={plan.id}>
                <span className="route-card-icon" aria-hidden="true">
                  <RouteIcon />
                </span>
                <span className="route-card-body">
                  <h3>
                    {plan.routeTemplate?.name ?? t("assignedPlanNoTemplate")}
                  </h3>
                  <span className="route-card-meta">
                    <MapPinIcon />
                    {t("routeStopsCount", { count: plan.items.length })}
                  </span>
                </span>
                {plan.status === "draft" ? (
                  <UnassignRouteButton
                    routePlanId={plan.id}
                    routeName={
                      plan.routeTemplate?.name ?? t("assignedPlanNoTemplate")
                    }
                    unassignAction={unassignRoutePlanAction}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {assignableRouteTemplates.length > 0 ? (
          <AssignRouteButton
            assignAction={assignRouteTemplateAction}
            hasExistingPlans={selectedPlans.length > 0}
            planDate={selectedDate}
            routeTemplates={assignableRouteTemplates}
          />
        ) : selectedPlans.length === 0 ? (
          <div className="empty-state-panel">
            <h2>{t("emptyRoutesTitle")}</h2>
            <p>{t("noTemplatesForAssignBody")}</p>
            {/* The routes screen moved into the field menu, so it no longer
                has a nav slot to come back from: this hand-off states the
                calendar — on the month and day the rep is looking at — as the
                origin, and the routes screen resolves it. */}
            <Link
              className="secondary-button"
              href={withBackOrigin(
                `/${tenantSlug}/field/routes`,
                backOrigin("/field/planning", {
                  month: currentMonth,
                  date: selectedDate,
                }),
              )}
            >
              {t("goToRoutes")}
            </Link>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

type PlanningTranslator = Awaited<
  ReturnType<typeof getTranslations<"field.planning">>
>;

// Templates not already assigned to this day — keeps the "add another
// route" select from offering (and the backend from rejecting with a 409)
// the same template twice on one day.
function availableRouteTemplates(
  routeTemplates: RouteTemplate[],
  selectedPlans: RoutePlan[],
): RouteTemplate[] {
  const assignedTemplateIds = new Set(
    selectedPlans
      .map((plan) => plan.routeTemplateId)
      .filter((id): id is string => id !== null),
  );

  return routeTemplates.filter(
    (template) => !assignedTemplateIds.has(template.id),
  );
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
        body={t("monthCopiedBody", {
          createdCount: Number(createdCount) || 0,
          skippedCount: Number(skippedCount) || 0,
        })}
        clearParams={["planning"]}
        eyebrow={t("monthCopiedTitle")}
        title={t("monthCopiedTitle")}
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
  const params = new URLSearchParams({
    month: date.slice(0, 7),
    date,
  });
  if (planning) {
    params.set("planning", planning);
  }
  return `/${tenantSlug}/field/planning?${params.toString()}`;
}

function monthHref(tenantSlug: string, month: string, date: string): string {
  const params = new URLSearchParams({ month, date });
  return `/${tenantSlug}/field/planning?${params.toString()}`;
}

function isDateString(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isMonthString(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const base = new Date(year, monthNumber - 1 + delta, 1);
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}`;
}

// Monday-first weekday header labels in the request locale.
function buildWeekdayLabels(format: IntlFormatter): string[] {
  return Array.from({ length: 7 }, (_, index) =>
    format.dateTime(
      // 2024-01-01 is a Monday; format sequential days in UTC.
      new Date(Date.UTC(2024, 0, 1 + index, 12)),
      { weekday: "short", timeZone: "UTC" },
    ),
  );
}

function buildMonthGrid(
  month: string,
  format: IntlFormatter,
): {
  label: string;
  leadingBlanks: number[];
  days: Array<{ day: number; dateStr: string }>;
} {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthIndex = monthNumber - 1;
  const firstOfMonth = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leadingCount = (firstOfMonth.getDay() + 6) % 7; // Monday-first

  return {
    label: format.dateTime(new Date(Date.UTC(year, monthIndex, 1, 12)), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    leadingBlanks: Array.from({ length: leadingCount }, (_, index) => index),
    days: Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      return {
        day,
        dateStr: `${year}-${pad(monthNumber)}-${pad(day)}`,
      };
    }),
  };
}

function formatLongDate(dateStr: string, format: IntlFormatter): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return format.dateTime(new Date(Date.UTC(year, month - 1, day, 12)), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
