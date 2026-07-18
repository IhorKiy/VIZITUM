import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { DeleteRouteButton } from "../../../../components/delete-route-button";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import {
  CalendarIcon,
  CopyIcon,
  MapPinIcon,
  RouteIcon,
} from "../../../../components/icons";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import { UnassignRouteButton } from "../../../../components/unassign-route-button";
import {
  addRouteTemplateItem,
  assignRouteTemplate,
  copyRoutePlansFromLastMonth,
  createRouteTemplate,
  deleteRoutePlan,
  deleteRouteTemplate,
  deleteRouteTemplateItem,
  getCurrentSession,
  getRouteTemplate,
  listLocations,
  listRouteTemplates,
  listRoutes,
  moveRouteTemplateItem,
  type Location,
  type RoutePlan,
  type RouteTemplate,
} from "../../../../lib/api-client";
import type { CommonTranslator, IntlFormatter } from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";

type PlanningPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    tab?: string;
    route?: string;
    template?: string;
    month?: string;
    date?: string;
    planning?: string;
  }>;
};

type PlanningTab = "routes" | "planning";

export default async function PlanningPage({
  params,
  searchParams,
}: PlanningPageProps) {
  const { tenantSlug } = await params;
  const { tab, route, template, month, date, planning } = await searchParams;
  const [t, tCommon, format] = await Promise.all([
    getTranslations("field.planning"),
    getTranslations("common"),
    getFormatter(),
  ]);

  const activeTab: PlanningTab = tab === "planning" ? "planning" : "routes";
  const selectedDate = isDateString(date) ? date : todayString();
  const currentMonth = isMonthString(month) ? month : selectedDate.slice(0, 7);

  async function createRouteTemplateAction(formData: FormData) {
    "use server";

    const name = getFormString(formData, "name").trim();
    const sessionResult = await getCurrentSession();

    if (!name || !sessionResult.ok) {
      redirect(routesTabHref(tenantSlug, "new", "failed"));
    }

    const result = await createRouteTemplate({
      representativeUserId: sessionResult.data.user.id,
      name,
    });

    if (!result.ok) {
      redirect(routesTabHref(tenantSlug, "new", "failed"));
    }

    redirect(routesTabHref(tenantSlug, result.data.id, "created"));
  }

  async function deleteRouteTemplateAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "templateId").trim();

    if (!templateId) {
      redirect(routesTabHref(tenantSlug, undefined, "failed"));
    }

    const result = await deleteRouteTemplate(templateId);

    if (!result.ok) {
      redirect(routesTabHref(tenantSlug, templateId, "failed"));
    }

    redirect(routesTabHref(tenantSlug, undefined, "deleted"));
  }

  async function addTemplateStopAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "templateId").trim();
    const locationId = getFormString(formData, "locationId").trim();

    if (!templateId || !locationId) {
      redirect(routesTabHref(tenantSlug, templateId || undefined, "failed"));
    }

    const activeTemplate = await findOwnRouteTemplate(templateId);

    if (!activeTemplate) {
      redirect(routesTabHref(tenantSlug, undefined, "failed"));
    }

    const nextSequence = activeTemplate.items.length
      ? Math.max(...activeTemplate.items.map((item) => item.sequence)) + 1
      : 1;

    const result = await addRouteTemplateItem(templateId, {
      locationId,
      sequence: nextSequence,
    });

    if (!result.ok) {
      redirect(routesTabHref(tenantSlug, templateId, "failed"));
    }

    redirect(routesTabHref(tenantSlug, templateId, "item-added"));
  }

  async function moveTemplateStopAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "templateId").trim();
    const itemId = getFormString(formData, "itemId").trim();
    const direction = formData.get("direction") === "up" ? "up" : "down";

    if (!templateId || !itemId) {
      redirect(routesTabHref(tenantSlug, templateId || undefined, "failed"));
    }

    // The swap (temp slot + two final updates) runs atomically on the
    // server, in one transaction — a mid-swap failure can no longer strand
    // an item at a temporary sequence.
    const result = await moveRouteTemplateItem(templateId, itemId, direction);

    if (!result.ok) {
      redirect(routesTabHref(tenantSlug, templateId, "failed"));
    }

    redirect(routesTabHref(tenantSlug, templateId, "item-reordered"));
  }

  async function removeTemplateStopAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "templateId").trim();
    const itemId = getFormString(formData, "itemId").trim();

    if (!templateId || !itemId) {
      redirect(routesTabHref(tenantSlug, templateId || undefined, "failed"));
    }

    const result = await deleteRouteTemplateItem(templateId, itemId);

    if (!result.ok) {
      redirect(routesTabHref(tenantSlug, templateId, "failed"));
    }

    redirect(routesTabHref(tenantSlug, templateId, "item-removed"));
  }

  async function assignRouteTemplateAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "routeTemplateId").trim();
    const planDate = getFormString(formData, "planDate").trim() || selectedDate;

    if (!templateId) {
      redirect(planningTabHref(tenantSlug, planDate, "failed"));
    }

    const result = await assignRouteTemplate(templateId, { planDate });

    if (!result.ok) {
      redirect(planningTabHref(tenantSlug, planDate, "failed"));
    }

    redirect(planningTabHref(tenantSlug, planDate, "assigned"));
  }

  async function unassignRoutePlanAction(formData: FormData) {
    "use server";

    const routePlanId = getFormString(formData, "routePlanId").trim();
    const planDate = getFormString(formData, "planDate").trim() || selectedDate;

    if (!routePlanId) {
      redirect(planningTabHref(tenantSlug, planDate, "failed"));
    }

    const result = await deleteRoutePlan(routePlanId);

    if (!result.ok) {
      redirect(planningTabHref(tenantSlug, planDate, "failed"));
    }

    redirect(planningTabHref(tenantSlug, planDate, "unassigned"));
  }

  async function copyRoutePlansAction(formData: FormData) {
    "use server";

    const targetMonth = getFormString(formData, "month").trim() || currentMonth;
    const result = await copyRoutePlansFromLastMonth({ month: targetMonth });

    if (!result.ok) {
      redirect(planningTabHref(tenantSlug, selectedDate, "failed"));
    }

    redirect(
      planningTabHref(
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

  // Explicit `representativeUserId` so a caller who also holds
  // `routes.manage_team` (e.g. this repo's "all roles" demo account) still
  // sees their own routes here — without it, the backend treats an omitted
  // filter as "team view" and requires the param instead of defaulting to self.
  const ownRepresentativeQuery = `representativeUserId=${sessionResult.data.user.id}`;
  const [templatesResult, routesResult, locationsResult] = await Promise.all([
    listRouteTemplates(`pageSize=100&${ownRepresentativeQuery}`),
    listRoutes(`pageSize=200&${ownRepresentativeQuery}`),
    listLocations(),
  ]);
  const routeTemplates = templatesResult.ok ? templatesResult.data.items : [];
  const routePlans = routesResult.ok ? routesResult.data.items : [];
  const locations = locationsResult.ok ? locationsResult.data.items : [];

  const isCreatingTemplate = route === "new";
  const activeTemplate =
    route && !isCreatingTemplate
      ? routeTemplates.find((item) => item.id === route)
      : undefined;

  const selectedPlan = routePlans.find(
    (plan) => plan.planDate === selectedDate,
  );
  const plannedDates = new Set(routePlans.map((plan) => plan.planDate));
  const daysPlannedThisMonth = routePlans.filter((plan) =>
    plan.planDate.startsWith(currentMonth),
  ).length;

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
          <p>{formatLongDate(todayString(), format)}</p>
        </div>
        <div className="toolbar" aria-label={t("planningActions")}>
          <a className="secondary-button" href={`/${tenantSlug}/field`}>
            {t("backToField")}
          </a>
        </div>
      </header>

      <nav className="tab-switcher" aria-label={t("tabsAria")}>
        <Link
          className={`tab-switcher-link${
            activeTab === "routes" ? " is-active" : ""
          }`}
          href={routesTabHref(tenantSlug)}
        >
          <RouteIcon />
          {t("routesTab")}
        </Link>
        <Link
          className={`tab-switcher-link${
            activeTab === "planning" ? " is-active" : ""
          }`}
          href={planningTabHref(tenantSlug, selectedDate)}
        >
          <CalendarIcon />
          {t("planningTab")}
        </Link>
      </nav>

      {activeTab === "routes" ? (
        <RoutesTabView
          activeTemplate={activeTemplate}
          addTemplateStopAction={addTemplateStopAction}
          createRouteTemplateAction={createRouteTemplateAction}
          deleteRouteTemplateAction={deleteRouteTemplateAction}
          isCreatingTemplate={isCreatingTemplate}
          locations={locations}
          moveTemplateStopAction={moveTemplateStopAction}
          removeTemplateStopAction={removeTemplateStopAction}
          routeTemplates={routeTemplates}
          t={t}
          tCommon={tCommon}
          tenantSlug={tenantSlug}
          templateStatus={template}
        />
      ) : (
        <PlanningTabView
          assignRouteTemplateAction={assignRouteTemplateAction}
          copyRoutePlansAction={copyRoutePlansAction}
          currentMonth={currentMonth}
          daysPlannedThisMonth={daysPlannedThisMonth}
          format={format}
          grid={grid}
          nextMonth={nextMonth}
          planningStatus={planning}
          plannedDates={plannedDates}
          prevMonth={prevMonth}
          routeTemplates={routeTemplates}
          selectedDate={selectedDate}
          selectedPlan={selectedPlan}
          t={t}
          tenantSlug={tenantSlug}
          unassignRoutePlanAction={unassignRoutePlanAction}
          weekdayLabels={weekdayLabels}
        />
      )}
    </AppShell>
  );
}

type PlanningTranslator = Awaited<
  ReturnType<typeof getTranslations<"field.planning">>
>;
type ServerAction = (formData: FormData) => Promise<void>;

function RoutesTabView({
  activeTemplate,
  addTemplateStopAction,
  createRouteTemplateAction,
  deleteRouteTemplateAction,
  isCreatingTemplate,
  locations,
  moveTemplateStopAction,
  removeTemplateStopAction,
  routeTemplates,
  t,
  tCommon,
  tenantSlug,
  templateStatus,
}: {
  activeTemplate: RouteTemplate | undefined;
  addTemplateStopAction: ServerAction;
  createRouteTemplateAction: ServerAction;
  deleteRouteTemplateAction: ServerAction;
  isCreatingTemplate: boolean;
  locations: Location[];
  moveTemplateStopAction: ServerAction;
  removeTemplateStopAction: ServerAction;
  routeTemplates: RouteTemplate[];
  t: PlanningTranslator;
  tCommon: CommonTranslator;
  tenantSlug: string;
  templateStatus: string | undefined;
}) {
  const statusNotice = buildTemplateStatusNotice(templateStatus, t, tCommon);

  if (isCreatingTemplate) {
    return (
      <div className="panel">
        <div className="panel-title-stack">
          <h2>{t("addRoute")}</h2>
        </div>
        <form action={createRouteTemplateAction} className="visit-form compact">
          <label>
            {t("createRouteNameLabel")}
            <input autoFocus name="name" required type="text" />
          </label>
          <div className="toolbar">
            <Link className="secondary-button" href={routesTabHref(tenantSlug)}>
              {tCommon("cancel")}
            </Link>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={t("creatingRoute")}
            >
              {t("createRouteSubmit")}
            </PendingSubmitButton>
          </div>
        </form>
      </div>
    );
  }

  if (activeTemplate) {
    const usedLocationIds = new Set(
      activeTemplate.items.map((item) => item.locationId),
    );
    const availableLocations = locations.filter(
      (location) => !usedLocationIds.has(location.id),
    );
    const stops = [...activeTemplate.items].sort(
      (a, b) => a.sequence - b.sequence,
    );

    return (
      <>
        {statusNotice}
        <div className="panel">
          <div className="route-section-head">
            <Link className="secondary-button" href={routesTabHref(tenantSlug)}>
              {t("routeEditorBack")}
            </Link>
            <h2>{activeTemplate.name}</h2>
            <DeleteRouteButton
              deleteAction={deleteRouteTemplateAction}
              routeId={activeTemplate.id}
              routeName={activeTemplate.name}
            />
          </div>

          {stops.length > 0 ? (
            <ol className="route-stop-list">
              {stops.map((stop, index) => (
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
                      action={moveTemplateStopAction}
                      className="inline-control-form"
                    >
                      <input
                        name="templateId"
                        type="hidden"
                        value={activeTemplate.id}
                      />
                      <input name="itemId" type="hidden" value={stop.id} />
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
                      action={moveTemplateStopAction}
                      className="inline-control-form"
                    >
                      <input
                        name="templateId"
                        type="hidden"
                        value={activeTemplate.id}
                      />
                      <input name="itemId" type="hidden" value={stop.id} />
                      <input name="direction" type="hidden" value="down" />
                      <button
                        className="secondary-button"
                        disabled={index === stops.length - 1}
                        type="submit"
                        aria-label={t("moveDownAria", {
                          name: stop.location.name,
                        })}
                      >
                        ↓
                      </button>
                    </form>
                    <form
                      action={removeTemplateStopAction}
                      className="inline-control-form"
                    >
                      <input
                        name="templateId"
                        type="hidden"
                        value={activeTemplate.id}
                      />
                      <input name="itemId" type="hidden" value={stop.id} />
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
              <form
                action={addTemplateStopAction}
                className="visit-form compact"
              >
                <input
                  name="templateId"
                  type="hidden"
                  value={activeTemplate.id}
                />
                <label>
                  {t("locationLabel")}
                  <select name="locationId" required>
                    {availableLocations.map((location) => (
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
        </div>
      </>
    );
  }

  const totalStopsCount = new Set(
    routeTemplates.flatMap((item) => item.items.map((stop) => stop.locationId)),
  ).size;

  return (
    <>
      {statusNotice}
      <div className="toolbar">
        <Link
          className="primary-button"
          href={routesTabHref(tenantSlug, "new")}
        >
          + {t("addRoute")}
        </Link>
      </div>

      <section className="manager-grid" aria-label={t("routesMetricsAria")}>
        <article className="metric-card">
          <p className="metric-label">{t("totalStopsMetric")}</p>
          <p className="metric-value">{totalStopsCount}</p>
          <p className="small-label">
            {t("pointsUnit", { count: totalStopsCount })}
          </p>
        </article>
        <Link className="metric-card" href={`/${tenantSlug}/field/general`}>
          <header>
            <p className="metric-label">{t("myLocationsMetric")}</p>
            <span className="metric-card-chevron" aria-hidden="true">
              ›
            </span>
          </header>
          <p className="metric-value">{locations.length}</p>
          <p className="small-label">
            {t("pointsUnit", { count: locations.length })}
          </p>
        </Link>
      </section>

      {routeTemplates.length > 0 ? (
        <ul className="route-card-list">
          {routeTemplates.map((routeTemplate) => (
            <li key={routeTemplate.id}>
              <Link
                className="route-card"
                href={routesTabHref(tenantSlug, routeTemplate.id)}
              >
                <span className="route-card-icon" aria-hidden="true">
                  <RouteIcon />
                </span>
                <span className="route-card-body">
                  <h3>{routeTemplate.name}</h3>
                  <span className="route-card-meta">
                    <MapPinIcon />
                    {t("routeStopsCount", {
                      count: routeTemplate.items.length,
                    })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state-panel">
          <h2>{t("emptyRoutesTitle")}</h2>
          <p>{t("emptyRoutesBody")}</p>
        </div>
      )}
    </>
  );
}

function PlanningTabView({
  assignRouteTemplateAction,
  copyRoutePlansAction,
  currentMonth,
  daysPlannedThisMonth,
  format,
  grid,
  nextMonth,
  planningStatus,
  plannedDates,
  prevMonth,
  routeTemplates,
  selectedDate,
  selectedPlan,
  t,
  tenantSlug,
  unassignRoutePlanAction,
  weekdayLabels,
}: {
  assignRouteTemplateAction: ServerAction;
  copyRoutePlansAction: ServerAction;
  currentMonth: string;
  daysPlannedThisMonth: number;
  format: IntlFormatter;
  grid: ReturnType<typeof buildMonthGrid>;
  nextMonth: string;
  planningStatus: string | undefined;
  plannedDates: Set<string>;
  prevMonth: string;
  routeTemplates: RouteTemplate[];
  selectedDate: string;
  selectedPlan: RoutePlan | undefined;
  t: PlanningTranslator;
  tenantSlug: string;
  unassignRoutePlanAction: ServerAction;
  weekdayLabels: string[];
}) {
  const statusNotice = buildPlanningStatusNotice(planningStatus, t);

  return (
    <>
      {statusNotice}
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
        <p className="small-label">
          {t("daysPlannedLabel", { count: daysPlannedThisMonth })}
        </p>

        <form action={copyRoutePlansAction}>
          <input name="month" type="hidden" value={currentMonth} />
          <PendingSubmitButton
            className="dashed-action-button"
            pendingLabel={t("copyingMonth")}
          >
            <CopyIcon />
            {t("monthCopyAction")}
          </PendingSubmitButton>
        </form>

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
        <div className="route-card-meta">
          <CalendarIcon />
          {t("todayLegend")}
        </div>
        <h2>{formatLongDate(selectedDate, format)}</h2>

        {selectedPlan ? (
          <>
            <p className="small-label">
              {selectedPlan.routeTemplate?.name ?? t("assignedPlanNoTemplate")}
            </p>
            {selectedPlan.items.length > 0 ? (
              <ol className="route-stop-list">
                {selectedPlan.items.map((stop, index) => (
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
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty-state">{t("noStops")}</p>
            )}
            {selectedPlan.status === "draft" ? (
              <UnassignRouteButton
                routePlanId={selectedPlan.id}
                unassignAction={unassignRoutePlanAction}
              />
            ) : null}
          </>
        ) : routeTemplates.length > 0 ? (
          <form
            action={assignRouteTemplateAction}
            className="visit-form compact"
          >
            <input name="planDate" type="hidden" value={selectedDate} />
            <label>
              {t("assignRouteSelectLabel")}
              <select name="routeTemplateId" required>
                {routeTemplates.map((routeTemplate) => (
                  <option key={routeTemplate.id} value={routeTemplate.id}>
                    {routeTemplate.name}
                  </option>
                ))}
              </select>
            </label>
            <PendingSubmitButton
              className="dashed-action-button"
              pendingLabel={t("assigningRoute")}
            >
              + {t("assignRoute")}
            </PendingSubmitButton>
          </form>
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyRoutesTitle")}</h2>
            <p>{t("noTemplatesForAssignBody")}</p>
            <Link className="secondary-button" href={routesTabHref(tenantSlug)}>
              {t("goToRoutesTab")}
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

function buildTemplateStatusNotice(
  status: string | undefined,
  t: PlanningTranslator,
  tCommon: CommonTranslator,
) {
  if (!status) {
    return null;
  }

  const noticeMap: Record<
    string,
    { title: string; body: string; tone: "success" | "danger" } | undefined
  > = {
    created: {
      title: t("routeCreatedTitle"),
      body: t("routeCreatedBody"),
      tone: "success",
    },
    deleted: {
      title: t("routeDeletedTitle"),
      body: t("routeDeletedBody"),
      tone: "success",
    },
    "item-added": {
      title: t("itemAddedTitle"),
      body: t("itemAddedBody"),
      tone: "success",
    },
    "item-removed": {
      title: t("itemRemovedTitle"),
      body: t("itemRemovedBody"),
      tone: "success",
    },
    "item-reordered": {
      title: t("reorderedTitle"),
      body: t("reorderedBody"),
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
      clearParams={["template"]}
      eyebrow={
        notice.tone === "success"
          ? tCommon("notice.updated")
          : tCommon("notice.error")
      }
      title={notice.title}
      tone={notice.tone}
    />
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

  const noticeMap: Record<
    string,
    { title: string; body: string; tone: "success" | "danger" } | undefined
  > = {
    assigned: {
      title: t("assignedTitle"),
      body: t("assignedBody"),
      tone: "success",
    },
    unassigned: {
      title: t("unassignedTitle"),
      body: t("unassignedBody"),
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

// Same reasoning as the ownRepresentativeQuery in the page body: an explicit
// representativeUserId is required so a caller who also holds
// `routes.manage_team` still gets their own template back instead of a
// backend 403 (an omitted filter means "team view", not "self").
async function findOwnRouteTemplate(
  templateId: string,
): Promise<RouteTemplate | undefined> {
  // findTenantRouteTemplate (behind this endpoint) already scopes by
  // ownership server-side, so this needs no representativeUserId of its
  // own — just the one template, not the caller's whole list.
  const result = await getRouteTemplate(templateId);

  return result.ok ? result.data : undefined;
}

function routesTabHref(
  tenantSlug: string,
  routeId?: string,
  status?: string,
): string {
  const params = new URLSearchParams({ tab: "routes" });
  if (routeId) {
    params.set("route", routeId);
  }
  if (status) {
    params.set("template", status);
  }
  return `/${tenantSlug}/field/planning?${params.toString()}`;
}

function planningTabHref(
  tenantSlug: string,
  date: string,
  planning?: string,
): string {
  const params = new URLSearchParams({
    tab: "planning",
    month: date.slice(0, 7),
    date,
  });
  if (planning) {
    params.set("planning", planning);
  }
  return `/${tenantSlug}/field/planning?${params.toString()}`;
}

function monthHref(tenantSlug: string, month: string, date: string): string {
  const params = new URLSearchParams({ tab: "planning", month, date });
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
