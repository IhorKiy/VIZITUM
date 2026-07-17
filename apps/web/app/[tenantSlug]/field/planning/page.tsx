import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  addRouteItem,
  createRoutePlan,
  getCurrentSession,
  listLocations,
  listRoutes,
  updateRouteItem,
  type Location,
  type RoutePlan,
} from "../../../../lib/api-client";
import type { IntlFormatter } from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";

type PlanningPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    month?: string;
    date?: string;
    planning?: string;
    error?: string;
  }>;
};

export default async function PlanningPage({
  params,
  searchParams,
}: PlanningPageProps) {
  const { tenantSlug } = await params;
  const { month, date, planning, error } = await searchParams;
  const [t, tCommon, format] = await Promise.all([
    getTranslations("field.planning"),
    getTranslations("common"),
    getFormatter(),
  ]);

  const selectedDate = isDateString(date) ? date : todayString();
  const currentMonth = isMonthString(month) ? month : selectedDate.slice(0, 7);

  async function addStopAction(formData: FormData) {
    "use server";

    const planDate = getFormString(formData, "planDate").trim();
    const locationId = getFormString(formData, "locationId").trim();
    const sessionResult = await getCurrentSession();

    if (!isDateString(planDate) || !locationId || !sessionResult.ok) {
      redirect(planningHref(tenantSlug, planDate || selectedDate, "add"));
    }

    const planResult = await createRoutePlan({
      representativeUserId: sessionResult.data.user.id,
      planDate,
    });

    if (!planResult.ok) {
      redirect(planningHref(tenantSlug, planDate, "add"));
    }

    const nextSequence = planResult.data.items.length
      ? Math.max(...planResult.data.items.map((item) => item.sequence)) + 1
      : 1;
    const itemResult = await addRouteItem(planResult.data.id, {
      locationId,
      sequence: nextSequence,
    });

    if (!itemResult.ok) {
      redirect(planningHref(tenantSlug, planDate, "add"));
    }

    redirect(planningHref(tenantSlug, planDate, undefined, "added"));
  }

  async function moveStopAction(formData: FormData) {
    "use server";

    const routePlanId = getFormString(formData, "routePlanId").trim();
    const routeItemId = getFormString(formData, "routeItemId").trim();
    const planDate = getFormString(formData, "planDate").trim();
    const direction = formData.get("direction") === "up" ? "up" : "down";
    const backHref = planningHref(tenantSlug, planDate || selectedDate);

    const routesResult = await listRoutes("pageSize=200");

    if (!routesResult.ok) {
      redirect(planningHref(tenantSlug, planDate, "move"));
    }

    const plan = routesResult.data.items.find(
      (candidate) => candidate.id === routePlanId,
    );

    if (!plan) {
      redirect(planningHref(tenantSlug, planDate, "move"));
    }

    const active = activeStops(plan);
    const index = active.findIndex((item) => item.id === routeItemId);
    const otherIndex = direction === "up" ? index - 1 : index + 1;

    if (index < 0 || otherIndex < 0 || otherIndex >= active.length) {
      redirect(backHref);
    }

    const item = active[index];
    const other = active[otherIndex];
    // Sequence is unique per plan, so swap through a free temporary slot.
    const tempSequence = Math.max(...plan.items.map((row) => row.sequence)) + 1;

    const step1 = await updateRouteItem(plan.id, item.id, {
      sequence: tempSequence,
    });
    const step2 = step1.ok
      ? await updateRouteItem(plan.id, other.id, { sequence: item.sequence })
      : step1;
    const step3 = step2.ok
      ? await updateRouteItem(plan.id, item.id, { sequence: other.sequence })
      : step2;

    if (!step3.ok) {
      redirect(planningHref(tenantSlug, planDate, "move"));
    }

    redirect(planningHref(tenantSlug, planDate, undefined, "reordered"));
  }

  async function removeStopAction(formData: FormData) {
    "use server";

    const routePlanId = getFormString(formData, "routePlanId").trim();
    const routeItemId = getFormString(formData, "routeItemId").trim();
    const planDate = getFormString(formData, "planDate").trim();

    if (!routePlanId || !routeItemId) {
      redirect(planningHref(tenantSlug, planDate || selectedDate, "remove"));
    }

    const result = await updateRouteItem(routePlanId, routeItemId, {
      status: "skipped",
    });

    if (!result.ok) {
      redirect(planningHref(tenantSlug, planDate, "remove"));
    }

    redirect(planningHref(tenantSlug, planDate, undefined, "removed"));
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

  const routesResult = await listRoutes("pageSize=200");
  const locationsResult = await listLocations();
  const plans = routesResult.ok ? routesResult.data.items : [];
  const locations = locationsResult.ok ? locationsResult.data.items : [];

  const selectedPlan = plans.find((plan) => plan.planDate === selectedDate);
  const selectedStops = selectedPlan ? activeStops(selectedPlan) : [];
  const usedLocationIds = new Set(selectedStops.map((stop) => stop.locationId));
  const availableLocations = locations.filter(
    (location) => !usedLocationIds.has(location.id),
  );
  const plannedDates = new Set(
    plans
      .filter((plan) => activeStops(plan).length > 0)
      .map((plan) => plan.planDate),
  );

  const grid = buildMonthGrid(currentMonth, format);
  const prevMonth = shiftMonth(currentMonth, -1);
  const nextMonth = shiftMonth(currentMonth, 1);
  const weekdayLabels = buildWeekdayLabels(format);

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field-planning">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </div>
        <div className="toolbar" aria-label={t("planningActions")}>
          <a className="secondary-button" href={`/${tenantSlug}/field`}>
            {t("backToField")}
          </a>
        </div>
      </header>

      {planning === "added" ? (
        <DismissableNotice
          ariaLabel={t("statusAria")}
          body={t("addedBody")}
          clearParams={["planning"]}
          eyebrow={tCommon("notice.updated")}
          title={t("addedTitle")}
          tone="success"
        />
      ) : null}
      {planning === "removed" ? (
        <DismissableNotice
          ariaLabel={t("statusAria")}
          body={t("removedBody")}
          clearParams={["planning"]}
          eyebrow={tCommon("notice.updated")}
          title={t("removedTitle")}
          tone="success"
        />
      ) : null}
      {planning === "reordered" ? (
        <DismissableNotice
          ariaLabel={t("statusAria")}
          body={t("reorderedBody")}
          clearParams={["planning"]}
          eyebrow={tCommon("notice.updated")}
          title={t("reorderedTitle")}
          tone="success"
        />
      ) : null}
      {error ? (
        <DismissableNotice
          ariaLabel={t("statusAria")}
          body={t("failedBody")}
          clearParams={["error"]}
          eyebrow={tCommon("notice.error")}
          title={t("failedTitle")}
          tone="danger"
        />
      ) : null}

      <section className="dashboard-grid" aria-label={t("workspaceAria")}>
        <div className="panel">
          <div className="route-section-head">
            <Link
              className="secondary-button"
              href={monthHref(tenantSlug, prevMonth, selectedDate)}
              aria-label={t("previousMonth")}
            >
              ‹
            </Link>
            <h2>{grid.label}</h2>
            <Link
              className="secondary-button"
              href={monthHref(tenantSlug, nextMonth, selectedDate)}
              aria-label={t("nextMonth")}
            >
              ›
            </Link>
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
                  href={dateHref(tenantSlug, currentMonth, day.dateStr)}
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

        <aside className="panel" aria-label={t("selectedDayAria")}>
          <h2>{formatLongDate(selectedDate, format)}</h2>

          {selectedStops.length > 0 ? (
            <ol className="route-stop-list">
              {selectedStops.map((stop, index) => (
                <li className="route-stop" key={stop.id}>
                  <span className="route-stop-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="route-stop-body">
                    <h3>{stop.location.name}</h3>
                    <p className="visit-meta">
                      {[stop.location.addressLine, stop.location.city]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                  <div className="route-stop-actions">
                    <form
                      action={moveStopAction}
                      className="inline-control-form"
                    >
                      <input
                        name="routePlanId"
                        type="hidden"
                        value={stop.routePlanId}
                      />
                      <input name="routeItemId" type="hidden" value={stop.id} />
                      <input
                        name="planDate"
                        type="hidden"
                        value={selectedDate}
                      />
                      <input name="direction" type="hidden" value="up" />
                      <button
                        className="secondary-button"
                        disabled={index === 0}
                        type="submit"
                        aria-label={t("moveUpAria", {
                          name: stop.location.name,
                        })}
                      >
                        ↑
                      </button>
                    </form>
                    <form
                      action={moveStopAction}
                      className="inline-control-form"
                    >
                      <input
                        name="routePlanId"
                        type="hidden"
                        value={stop.routePlanId}
                      />
                      <input name="routeItemId" type="hidden" value={stop.id} />
                      <input
                        name="planDate"
                        type="hidden"
                        value={selectedDate}
                      />
                      <input name="direction" type="hidden" value="down" />
                      <button
                        className="secondary-button"
                        disabled={index === selectedStops.length - 1}
                        type="submit"
                        aria-label={t("moveDownAria", {
                          name: stop.location.name,
                        })}
                      >
                        ↓
                      </button>
                    </form>
                    <form
                      action={removeStopAction}
                      className="inline-control-form"
                    >
                      <input
                        name="routePlanId"
                        type="hidden"
                        value={stop.routePlanId}
                      />
                      <input name="routeItemId" type="hidden" value={stop.id} />
                      <input
                        name="planDate"
                        type="hidden"
                        value={selectedDate}
                      />
                      <PendingSubmitButton
                        className="secondary-button"
                        pendingLabel={t("removing")}
                      >
                        {t("remove")}
                      </PendingSubmitButton>
                    </form>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-state">{t("noStops")}</p>
          )}

          <section className="field-panel-section">
            <h2>{t("addStop")}</h2>
            {availableLocations.length > 0 ? (
              <form action={addStopAction} className="visit-form compact">
                <input name="planDate" type="hidden" value={selectedDate} />
                <label>
                  {t("locationLabel")}
                  <select name="locationId" required>
                    {availableLocations.map((location: Location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                        {location.city ? ` · ${location.city}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <PendingSubmitButton
                  className="primary-button"
                  pendingLabel={t("adding")}
                >
                  {t("addToRoute")}
                </PendingSubmitButton>
              </form>
            ) : (
              <p className="empty-state">
                {locations.length === 0
                  ? t("noLocations")
                  : t("allLocationsUsed")}
              </p>
            )}
          </section>
        </aside>
      </section>
    </AppShell>
  );
}

type PlanningStop = RoutePlan["items"][number] & { routePlanId: string };

function activeStops(plan: RoutePlan): PlanningStop[] {
  return plan.items
    .filter((item) => item.status !== "skipped")
    .map((item) => ({ ...item, routePlanId: plan.id }))
    .sort((a, b) => a.sequence - b.sequence);
}

function planningHref(
  tenantSlug: string,
  date: string,
  error?: string,
  planning?: string,
): string {
  const params = new URLSearchParams();
  params.set("month", date.slice(0, 7));
  params.set("date", date);
  if (planning) {
    params.set("planning", planning);
  }
  if (error) {
    params.set("error", error);
  }
  return `/${tenantSlug}/field/planning?${params.toString()}`;
}

function monthHref(tenantSlug: string, month: string, date: string): string {
  const params = new URLSearchParams({ month, date });
  return `/${tenantSlug}/field/planning?${params.toString()}`;
}

function dateHref(tenantSlug: string, month: string, date: string): string {
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
