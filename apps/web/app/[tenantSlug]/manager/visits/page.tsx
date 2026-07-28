import { useFormatter, useTranslations } from "next-intl";
import {
  getFormatter,
  getLocale,
  getTimeZone,
  getTranslations,
} from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { CardFact } from "../../../../components/card-fact";
import { FilterDateRange } from "../../../../components/filter-date-range";
import { FilterDisclosure } from "../../../../components/filter-disclosure";
import { FilterField } from "../../../../components/filter-field";
import {
  FilterFooter,
  filterCountTags,
} from "../../../../components/filter-footer";
import { FilterForm } from "../../../../components/filter-form";
import { FilterPills } from "../../../../components/filter-pills";
import {
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  MapPinIcon,
  RouteIcon,
  TagIcon,
  UserIcon,
} from "../../../../components/icons";
import { PeriodPills } from "../../../../components/period-pills";
import {
  listAdminLocations,
  listTodayRoutes,
  listVisits,
  type Visit,
  type VisitStatus,
  type VisitStatusTotals,
} from "../../../../lib/api-client";
import {
  normalizeDayParam,
  normalizePage,
  periodAsRead,
  periodLabel as formatPeriodLabel,
  periodSearchParams,
  resolvePeriod,
  VISIT_PERIOD_PARAMS,
} from "../../../../lib/period";
import { backOrigin, withBackOrigin } from "../../../../lib/back-navigation";
import { formatCancellationReason } from "../../../../lib/visit-cancellation";
import {
  buildLocationOptions,
  buildRouteOptions,
  type FilterOption,
} from "../../../../lib/filter-options";
import {
  formatDateTime,
  formatEnumLabel,
  statusPillTone,
} from "../../../../lib/format";

type ManagerVisitsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    locationId?: string;
    page?: string;
    // Set by the "Period…" pill: the range itself is already in the URL, this
    // only asks the filter panel to open on it.
    period?: string;
    representativeUserId?: string;
    routePlanId?: string;
    startedFrom?: string;
    startedTo?: string;
    status?: string;
  }>;
};

// "draft" is a real VisitStatus enum value but createVisit always writes
// "in_progress" immediately — nothing in the product ever leaves a visit
// in "draft", so it's excluded here rather than offered as a dead filter.
const visitStatuses: VisitStatus[] = ["in_progress", "completed", "cancelled"];

// The list used to ask for 100 rows and show them all, under a counter that
// named the period's real total — so past 100 the screen quietly disagreed
// with itself. Paginated at 50, the same page size the field history list
// uses, with the count above it staying the period's own.
const PAGE_SIZE = 50;

export default async function ManagerVisitsPage({
  params,
  searchParams,
}: ManagerVisitsPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [locale, t, tManager, tCommon, tPeriod, format, timeZone] =
    await Promise.all([
      getLocale(),
      getTranslations("manager.visits"),
      getTranslations("manager"),
      getTranslations("common"),
      getTranslations("common.period"),
      getFormatter(),
      getTimeZone(),
    ]);
  const selectedStatus = normalizeVisitStatus(pageState.status);
  const selectedRepresentativeId = normalizeFilterValue(
    pageState.representativeUserId,
  );
  const selectedLocationId = normalizeFilterValue(pageState.locationId);
  const selectedRoutePlanId = normalizeFilterValue(pageState.routePlanId);
  // Team-wide, so the window matters more here than in field history: with no
  // period the list asks for every visit every representative ever made. With
  // nothing in the URL that window is the last 30 days in the tenant's
  // timezone, and it is named above the list rather than assumed.
  const requestedPeriod = resolvePeriod(
    {
      from: normalizeDayParam(pageState.startedFrom),
      to: normalizeDayParam(pageState.startedTo),
    },
    timeZone,
  );
  const page = normalizePage(pageState.page);
  // A visit opened from this list returns to it with the same filters — and
  // the same window — still applied, rather than to a bare list.
  const origin = backOrigin("/manager/visits", {
    locationId: selectedLocationId,
    page: page > 1 ? page : undefined,
    representativeUserId: selectedRepresentativeId,
    routePlanId: selectedRoutePlanId,
    startedFrom: requestedPeriod.from,
    startedTo: requestedPeriod.to,
    status: selectedStatus,
  });
  const periodParams = new URLSearchParams(
    periodSearchParams(requestedPeriod, VISIT_PERIOD_PARAMS),
  );
  const query = new URLSearchParams(periodParams);
  query.set("page", String(page));
  query.set("pageSize", String(PAGE_SIZE));
  // The default window is nobody's choice, so it doesn't count as a filter:
  // it neither lights the panel's active dot nor makes the reset link appear.
  const hasFilters = Boolean(
    selectedStatus ||
    selectedRepresentativeId ||
    selectedLocationId ||
    selectedRoutePlanId ||
    !requestedPeriod.isDefault,
  );

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (selectedRepresentativeId) {
    query.set("representativeUserId", selectedRepresentativeId);
  }

  if (selectedLocationId) {
    query.set("locationId", selectedLocationId);
  }

  if (selectedRoutePlanId) {
    query.set("routePlanId", selectedRoutePlanId);
  }

  const visitsResult = await listVisits(query.toString());
  // The representative dropdown lists whoever worked in this window, so it is
  // scoped to the period but not to the other filters — picking a
  // representative must not empty the list you picked them from.
  const allVisitsResult = hasFilters
    ? await listVisits(`pageSize=100&${periodParams.toString()}`)
    : visitsResult;
  const routesResult = await listTodayRoutes();
  const locationsResult = await listAdminLocations("pageSize=100");

  if (!visitsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-visits">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tManager("eyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("signedOutBody")}</p>
          </div>
          <div className="toolbar">
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
            <h2>{t("notConnectedTitle")}</h2>
            <p>{visitsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visits = visitsResult.data.items;
  const totalPages = visitsResult.data.totalPages;
  // What the API actually read, which is what the cards name: a window longer
  // than the 12-month maximum comes back trimmed, and a card that still
  // announced the requested range would be counting a wider window than the
  // one it read.
  const period = periodAsRead(
    requestedPeriod,
    visitsResult.data.period?.startedFrom,
    timeZone,
  );
  const periodLabel = formatPeriodLabel(tPeriod, format, period);
  // Absent for a minute or two mid-deploy, when this build is already serving
  // pages against the previous API. Three cards reading zero above a list full
  // of visits would be worse than no cards, so the row sits it out.
  const counters = visitsResult.data.statusTotals
    ? buildVisitCounters(visitsResult.data.statusTotals, periodLabel, t)
    : [];
  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams(query);
    params.delete("pageSize");

    if (targetPage <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(targetPage));
    }

    const search = params.toString();

    return search
      ? `/${tenantSlug}/manager/visits?${search}`
      : `/${tenantSlug}/manager/visits`;
  };
  const representativeOptions = allVisitsResult.ok
    ? buildRepresentativeOptions(allVisitsResult.data.items, locale)
    : [];
  const locationOptions = locationsResult.ok
    ? buildLocationOptions(locationsResult.data.items, locale)
    : [];
  const routeOptions = routesResult.ok
    ? buildRouteOptions(routesResult.data, locale)
    : [];

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-visits">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tManager("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
      </header>

      {counters.length > 0 ? (
        <section className="manager-grid" aria-label={t("metricsAria")}>
          {counters.map((counter) => (
            <article className="metric-card" key={counter.label}>
              <header>
                <p className="metric-label">{counter.label}</p>
                <span className={`status-pill ${counter.tone}`}>
                  {counter.tone === "active"
                    ? tCommon("tone.ok")
                    : tCommon(`tone.${counter.tone}`)}
                </span>
              </header>
              <p className="metric-value">{counter.value}</p>
              <p className="small-label">{counter.detail}</p>
            </article>
          ))}
        </section>
      ) : null}

      <section aria-label={t("visitList")} className="panel drilldown-panel">
        <FilterForm action={`/${tenantSlug}/manager/visits`}>
          <div className="panel-toolbar panel-toolbar-filters">
            {/* How deep the list reads sits above what it is cut by — the
                counters at the top of the screen are counts of this window. */}
            <PeriodPills
              action={`/${tenantSlug}/manager/visits`}
              ariaLabel={t("visitPeriod")}
              names={VISIT_PERIOD_PARAMS}
              otherParams={
                new URLSearchParams([
                  ...(selectedStatus ? [["status", selectedStatus]] : []),
                  ...(selectedRepresentativeId
                    ? [["representativeUserId", selectedRepresentativeId]]
                    : []),
                  ...(selectedLocationId
                    ? [["locationId", selectedLocationId]]
                    : []),
                  ...(selectedRoutePlanId
                    ? [["routePlanId", selectedRoutePlanId]]
                    : []),
                ])
              }
              period={period}
              timeZone={timeZone}
            />
            <FilterPills
              ariaLabel={t("statusFiltersAria")}
              name="status"
              options={[
                { label: tCommon("all"), value: "" },
                ...visitStatuses.map((visitStatus) => ({
                  label: formatEnumLabel(tCommon, visitStatus),
                  value: visitStatus,
                })),
              ]}
              value={selectedStatus ?? ""}
            />
          </div>

          <FilterDisclosure
            hasFilters={hasFilters || pageState.period === "custom"}
            label={tCommon("filtersLabel")}
          >
            <div className="filter-form">
              <FilterField icon={<RouteIcon />} label={t("route")}>
                <select
                  defaultValue={selectedRoutePlanId ?? ""}
                  name="routePlanId"
                >
                  <option value="">{tCommon("anyOption")}</option>
                  {routeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField icon={<MapPinIcon />} label={t("location")}>
                <select
                  defaultValue={selectedLocationId ?? ""}
                  name="locationId"
                >
                  <option value="">{tCommon("anyOption")}</option>
                  {locationOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField icon={<UserIcon />} label={t("representative")}>
                <select
                  defaultValue={selectedRepresentativeId ?? ""}
                  name="representativeUserId"
                >
                  <option value="">{tCommon("anyOption")}</option>
                  {representativeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              {/* Seeded with the resolved window rather than with whatever the
                  URL happened to carry: editing one end of the default period
                  should narrow those 30 days, not open an unbounded range. */}
              <FilterDateRange
                fromLabel={t("startedFrom")}
                fromName="startedFrom"
                fromValue={period.from}
                label={t("visitPeriod")}
                placeholder={tCommon("datePlaceholder")}
                toLabel={t("startedTo")}
                toName="startedTo"
                toValue={period.to}
              />
              <FilterFooter
                resetHref={
                  hasFilters ? `/${tenantSlug}/manager/visits` : undefined
                }
                resetLabel={tCommon("reset")}
                resultText={t.rich("filterResultCount", {
                  ...filterCountTags,
                  count: visitsResult.data.total,
                })}
              />
            </div>
          </FilterDisclosure>
        </FilterForm>

        {visits.length > 0 ? (
          <>
            <VisitsCards
              origin={origin}
              tenantSlug={tenantSlug}
              visits={visits}
            />
            {/* The counters above count the whole period, so the list under
                them has to be able to reach all of it rather than stopping
                silently at the first page. */}
            {totalPages > 1 ? (
              <nav aria-label={t("paginationAria")} className="list-pagination">
                {page > 1 ? (
                  <a className="secondary-button" href={pageHref(page - 1)}>
                    {t("showNewer")}
                  </a>
                ) : null}
                <p className="small-label">
                  {t("pagePosition", { page, totalPages })}
                </p>
                {page < totalPages ? (
                  <a className="secondary-button" href={pageHref(page + 1)}>
                    {t("showEarlier")}
                  </a>
                ) : null}
              </nav>
            ) : null}
          </>
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
            <div className="toolbar">
              {hasFilters || page > 1 ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/visits`}
                >
                  {t("showAllVisits")}
                </a>
              ) : null}
              <a className="primary-button" href={`/${tenantSlug}/field`}>
                {t("openFieldWorkspace")}
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function buildRepresentativeOptions(
  visits: Visit[],
  locale: string,
): FilterOption[] {
  const options = new Map<string, FilterOption>();

  for (const visit of visits) {
    options.set(visit.representative.id, {
      id: visit.representative.id,
      label: visit.representative.name,
    });
  }

  return [...options.values()].sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}

function VisitsCards({
  origin,
  tenantSlug,
  visits,
}: {
  origin: string;
  tenantSlug: string;
  visits: Visit[];
}) {
  const t = useTranslations("manager.visits");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  // The location is the title, the status pill sits top-right, and the "open"
  // link in the footer drills into the visit page.
  return (
    <ul className="list-cards">
      {visits.map((visit) => (
        <li className="list-card" key={visit.id}>
          <div className="list-card-top">
            <h3 className="list-card-title">{visit.location.name}</h3>
            <span className={`status-pill ${statusPillTone(visit.status)}`}>
              {formatEnumLabel(tCommon, visit.status)}
            </span>
          </div>
          <dl className="list-card-facts">
            <CardFact icon={<UserIcon />} label={t("tableRepresentative")}>
              {visit.representative.name}
            </CardFact>
            <CardFact icon={<MapPinIcon />} label={t("tableLocation")}>
              {visit.location.addressLine}, {visit.location.city}
            </CardFact>
            <CardFact icon={<TagIcon />} label={t("tableType")}>
              {formatEnumLabel(tCommon, visit.visitType)}
            </CardFact>
            <CardFact icon={<CalendarIcon />} label={t("tableStarted")}>
              {formatDateTime(format, visit.startedAt)}
            </CardFact>
            {visit.completedAt ? (
              <CardFact icon={<CheckIcon />} label={t("tableCompleted")}>
                {formatDateTime(format, visit.completedAt)}
              </CardFact>
            ) : null}
            {visit.status === "cancelled" && visit.cancellationReason ? (
              <CardFact icon={<CloseIcon />} label={t("tableCancelReason")}>
                {formatCancellationReason(tCommon, visit.cancellationReason)}
              </CardFact>
            ) : null}
          </dl>
          <a
            className="list-card-open"
            href={withBackOrigin(
              `/${tenantSlug}/manager/visits/${visit.id}`,
              origin,
            )}
          >
            {t("open")}
          </a>
        </li>
      ))}
    </ul>
  );
}

// The three metric cards, read off the period's own status aggregate rather
// than off the loaded page: they used to count the first 100 rows and call the
// result "reports confirmed", which quietly stopped being true on tenant 101.
// The window they describe is named on the first card, since a count of
// completed visits means nothing without one.
function buildVisitCounters(
  totals: VisitStatusTotals,
  periodLabel: string,
  t: Awaited<ReturnType<typeof getTranslations<"manager.visits">>>,
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  return [
    {
      label: periodLabel,
      value: String(totals.total),
      detail: t("periodDetail"),
      tone: "active",
    },
    {
      label: t("reportsConfirmed"),
      value: String(totals.completed),
      detail: t("waitingDetail", { count: totals.inProgress }),
      tone: totals.completed > 0 ? "active" : "info",
    },
    {
      label: t("inProgress"),
      value: String(totals.inProgress),
      detail: t("inProgressDetail"),
      tone: totals.inProgress > 0 ? "warning" : "active",
    },
  ];
}

function normalizeVisitStatus(value: string | undefined): VisitStatus | null {
  if (
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return null;
}

function normalizeFilterValue(value: string | undefined): string | null {
  const normalizedValue = value?.trim();
  return normalizedValue || null;
}
