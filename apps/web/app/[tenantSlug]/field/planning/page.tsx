import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { AssignRouteButton } from "../../../../components/assign-route-button";
import { CopyLastMonthButton } from "../../../../components/copy-last-month-button";
import { DeleteRouteButton } from "../../../../components/delete-route-button";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import {
  CalendarIcon,
  GripIcon,
  MapPinIcon,
  RouteIcon,
} from "../../../../components/icons";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import { RenameRouteButton } from "../../../../components/rename-route-button";
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
  reorderRouteTemplateItems,
  updateRouteTemplate,
  type Location,
  type RoutePlan,
  type RouteTemplate,
} from "../../../../lib/api-client";
import type { CommonTranslator, IntlFormatter } from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";
import { INPUT_LIMITS } from "../../../../lib/input-limits";
import { RouteStopDragList } from "./route-stop-drag-list";

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

  async function renameRouteTemplateAction(formData: FormData) {
    "use server";

    const templateId = getFormString(formData, "templateId").trim();
    const name = getFormString(formData, "name").trim();

    if (!templateId || !name) {
      redirect(routesTabHref(tenantSlug, templateId || undefined, "failed"));
    }

    const result = await updateRouteTemplate(templateId, { name });

    if (!result.ok) {
      redirect(routesTabHref(tenantSlug, templateId, "failed"));
    }

    redirect(routesTabHref(tenantSlug, templateId, "renamed"));
  }

  // Called directly from the client-side drag list (not a <form> submit) once
  // a drag or arrow-key move settles on a new order — see
  // route-stop-drag-list.tsx.
  async function reorderTemplateStopsAction(
    templateId: string,
    itemIds: string[],
  ) {
    "use server";

    if (!templateId || itemIds.length === 0) {
      redirect(routesTabHref(tenantSlug, templateId || undefined, "failed"));
    }

    const result = await reorderRouteTemplateItems(templateId, itemIds);

    if (!result.ok) {
      redirect(routesTabHref(tenantSlug, templateId, "failed"));
    }

    // No success notice here — the drag itself (or the arrow-key move) is
    // already the feedback; a banner on top of every reorder would be noise.
    redirect(routesTabHref(tenantSlug, templateId));
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
  const [templatesResult, routesResult, locationsResult] = await Promise.all([
    listRouteTemplates(`pageSize=100&${ownRepresentativeQuery}`),
    listRoutes(`pageSize=100&${ownRepresentativeQuery}`),
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

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field-planning">
      {/* Drilling into a route replaces this title/tab chrome with its own
          back link (see the activeTemplate branch of RoutesTabView) rather
          than stacking a second navigation layer above it. */}
      {!activeTemplate && (
        <>
          <header className="page-header">
            <div>
              <h1>
                {activeTab === "planning" ? t("planningTab") : t("title")}
              </h1>
              <p>{formatLongDate(todayString(), format)}</p>
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
        </>
      )}

      {activeTab === "routes" ? (
        <RoutesTabView
          activeTemplate={activeTemplate}
          addTemplateStopAction={addTemplateStopAction}
          createRouteTemplateAction={createRouteTemplateAction}
          deleteRouteTemplateAction={deleteRouteTemplateAction}
          isCreatingTemplate={isCreatingTemplate}
          locations={locations}
          removeTemplateStopAction={removeTemplateStopAction}
          renameRouteTemplateAction={renameRouteTemplateAction}
          reorderTemplateStopsAction={reorderTemplateStopsAction}
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
          selectedPlans={selectedPlans}
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
type ReorderAction = (templateId: string, itemIds: string[]) => Promise<void>;

function RoutesTabView({
  activeTemplate,
  addTemplateStopAction,
  createRouteTemplateAction,
  deleteRouteTemplateAction,
  isCreatingTemplate,
  locations,
  removeTemplateStopAction,
  renameRouteTemplateAction,
  reorderTemplateStopsAction,
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
  removeTemplateStopAction: ServerAction;
  renameRouteTemplateAction: ServerAction;
  reorderTemplateStopsAction: ReorderAction;
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
            <input
              autoFocus
              maxLength={INPUT_LIMITS.name}
              name="name"
              required
              type="text"
            />
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

        <Link className="route-back-link" href={routesTabHref(tenantSlug)}>
          <span aria-hidden="true">‹</span> {t("routeEditorBack")}
        </Link>

        <div className="route-name-card">
          <div className="route-name-summary">
            <div>
              <h2>{activeTemplate.name}</h2>
              <p className="route-name-meta">
                <MapPinIcon />
                {t("routeStopsCount", { count: stops.length })}
              </p>
            </div>
            <span className="route-name-actions">
              <RenameRouteButton
                renameAction={renameRouteTemplateAction}
                templateId={activeTemplate.id}
                templateName={activeTemplate.name}
              />
              <DeleteRouteButton
                deleteAction={deleteRouteTemplateAction}
                routeId={activeTemplate.id}
                routeName={activeTemplate.name}
              />
            </span>
          </div>
        </div>

        <details className="route-add-stop">
          <summary className="route-add-stop-trigger">
            <span aria-hidden="true">+</span> {t("addStop")}
          </summary>
          {availableLocations.length > 0 ? (
            <form action={addTemplateStopAction} className="visit-form compact">
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
        </details>

        {stops.length > 0 ? (
          <>
            <div className="route-stops-section-head">
              <p className="route-stops-section-label">
                {t("stopsSectionLabel")}
              </p>
              <p className="route-stops-drag-hint">
                <GripIcon />
                {t("dragToReorderHint")}
              </p>
            </div>
            <RouteStopDragList
              removeAction={removeTemplateStopAction}
              reorderAction={reorderTemplateStopsAction}
              stops={stops}
              templateId={activeTemplate.id}
              tenantSlug={tenantSlug}
            />
          </>
        ) : (
          <p className="empty-state">{t("noStops")}</p>
        )}
      </>
    );
  }

  return (
    <>
      {statusNotice}
      <div className="panel">
        <Link
          className="dashed-action-button route-add-trigger"
          href={routesTabHref(tenantSlug, "new")}
        >
          + {t("addRoute")}
        </Link>

        {routeTemplates.length > 0 ? (
          <>
            <p className="small-label route-count-label">
              {t("routesCountLabel", { count: routeTemplates.length })}
            </p>
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
          </>
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyRoutesTitle")}</h2>
            <p>{t("emptyRoutesBody")}</p>
          </div>
        )}
      </div>
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
  selectedPlans,
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
  selectedPlans: RoutePlan[];
  t: PlanningTranslator;
  tenantSlug: string;
  unassignRoutePlanAction: ServerAction;
  weekdayLabels: string[];
}) {
  const statusNotice = buildPlanningStatusNotice(planningStatus, t);
  const assignableRouteTemplates = availableRouteTemplates(
    routeTemplates,
    selectedPlans,
  );

  return (
    <>
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
            <Link className="secondary-button" href={routesTabHref(tenantSlug)}>
              {t("goToRoutesTab")}
            </Link>
          </div>
        ) : null}
      </div>
    </>
  );
}

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
