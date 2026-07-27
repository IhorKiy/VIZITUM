import { useFormatter, useTranslations } from "next-intl";
import { getTimeZone, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { FilterDateRange } from "../../../../components/filter-date-range";
import { FilterDisclosure } from "../../../../components/filter-disclosure";
import {
  FilterFooter,
  filterCountTags,
} from "../../../../components/filter-footer";
import { FilterForm } from "../../../../components/filter-form";
import { FilterPills } from "../../../../components/filter-pills";
import {
  getCurrentSession,
  listVisitDaySummary,
  listVisits,
  type ApiResult,
  type PaginatedResponse,
  type Visit,
  type VisitDaySummaryEntry,
  type VisitStatus,
} from "../../../../lib/api-client";
import {
  formatEnumLabel,
  formatTime,
  statusPillTone,
} from "../../../../lib/format";

type FieldHistoryPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    page?: string;
    startedFrom?: string;
    startedTo?: string;
    status?: string;
  }>;
};

const visitStatuses: VisitStatus[] = [
  "draft",
  "in_progress",
  "completed",
  "cancelled",
];

// Half the API's max: the list renders one card per visit under a day header,
// so a full 100 would be a very long scroll on the phone this zone is built
// for. Anything older is one "earlier visits" step away.
const PAGE_SIZE = 50;

export default async function FieldHistoryPage({
  params,
  searchParams,
}: FieldHistoryPageProps) {
  const { tenantSlug } = await params;
  const [t, tField, tCommon, timeZone] = await Promise.all([
    getTranslations("field.history"),
    getTranslations("field"),
    getTranslations("common"),
    getTimeZone(),
  ]);
  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("visits.read_own")
  ) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field-history">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("permissionBody")}</p>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>

        <section
          className="notice-panel"
          aria-label={t("permissionStatusAria")}
        >
          <div>
            <p className="eyebrow">{t("permissionRequiredEyebrow")}</p>
            <h2>{t("permissionRequiredTitle")}</h2>
            <p>{t("permissionRequiredBody")}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const pageState = await searchParams;
  const selectedStatus = normalizeVisitStatus(pageState.status);
  const startedFrom = normalizeDateFilter(pageState.startedFrom);
  const startedTo = normalizeDateFilter(pageState.startedTo);
  const page = normalizePage(pageState.page);
  const hasFilters = Boolean(selectedStatus || startedFrom || startedTo);

  const periodParams = new URLSearchParams();

  if (startedFrom) {
    periodParams.set("startedFrom", startedFrom);
  }

  if (startedTo) {
    periodParams.set("startedTo", startedTo);
  }

  const query = new URLSearchParams(periodParams);
  query.set("page", String(page));
  query.set("pageSize", String(PAGE_SIZE));

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  // Same filter as the list above, minus pagination: the day recap has to
  // cover every visit in the filtered set, not just the ones on this page.
  const daySummaryQuery = new URLSearchParams(query);
  daySummaryQuery.delete("page");
  daySummaryQuery.delete("pageSize");

  // The counters summarise the whole selected period and deliberately ignore
  // the status pill — the pill narrows the list below, while the counters stay
  // the "how is this period going" recap the pills are picked from. Each is its
  // own count query rather than a tally of the loaded page, which only ever
  // described the first 50 visits.
  const countQuery = (status?: VisitStatus | VisitStatus[]) => {
    const params = new URLSearchParams(periodParams);
    params.set("pageSize", "1");

    // `status` alone would treat an empty array as truthy and send a bare
    // `status=`, so the array branch checks its own length instead.
    if (status && (!Array.isArray(status) || status.length > 0)) {
      params.set("status", Array.isArray(status) ? status.join(",") : status);
    }

    return params.toString();
  };

  const [
    visitsResult,
    periodResult,
    completedResult,
    followUpResult,
    daySummaryResult,
  ] = await Promise.all([
    listVisits(query.toString()),
    // With no status pill the list query already counts exactly the period's
    // rows, so its own total stands in and the request is skipped.
    selectedStatus ? listVisits(countQuery()) : null,
    listVisits(countQuery("completed")),
    // The API accepts a comma-separated status list, so "needs follow-up"
    // (draft + in_progress) is one count query instead of two summed ones.
    listVisits(countQuery(["draft", "in_progress"])),
    listVisitDaySummary(daySummaryQuery.toString()),
  ]);
  // A failed request falls back to the old page-local tally further down
  // rather than blocking the whole list on one auxiliary call.
  const daySummary = daySummaryResult.ok ? daySummaryResult.data.days : null;

  if (!visitsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field-history">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("connectionBody")}</p>
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
  const counters = buildHistoryCounters(
    {
      period: periodResult ? totalOf(periodResult) : visitsResult.data.total,
      completed: totalOf(completedResult),
      followUp: totalOf(followUpResult),
    },
    t,
  );
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
      ? `/${tenantSlug}/field/history?${search}`
      : `/${tenantSlug}/field/history`;
  };

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field-history">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tField("flowEyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/field`}>
            {t("today")}
          </a>
          <a className="primary-button" href={`/${tenantSlug}/field#new-visit`}>
            {t("newVisit")}
          </a>
        </div>
      </header>

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

      <section aria-label={t("myVisits")} className="panel drilldown-panel">
        <FilterForm action={`/${tenantSlug}/field/history`}>
          <div className="panel-toolbar">
            <FilterPills
              ariaLabel={t("statusFiltersAria")}
              name="status"
              options={[
                { label: tCommon("all"), value: "" },
                ...visitStatuses.map((status) => ({
                  label: formatEnumLabel(tCommon, status),
                  value: status,
                })),
              ]}
              value={selectedStatus ?? ""}
            />
          </div>

          <FilterDisclosure
            hasFilters={hasFilters}
            label={tCommon("filtersLabel")}
          >
            <div className="filter-form field-history-filter-form">
              <FilterDateRange
                fromLabel={t("startedFrom")}
                fromName="startedFrom"
                fromValue={startedFrom ?? ""}
                label={t("visitPeriod")}
                placeholder={tCommon("datePlaceholder")}
                toLabel={t("startedTo")}
                toName="startedTo"
                toValue={startedTo ?? ""}
              />
              <FilterFooter
                resetHref={
                  hasFilters ? `/${tenantSlug}/field/history` : undefined
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
            <HistoryDays
              daySummary={daySummary}
              page={page}
              pageSize={PAGE_SIZE}
              tenantSlug={tenantSlug}
              timeZone={timeZone}
              visits={visits}
            />
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
                  href={`/${tenantSlug}/field/history`}
                >
                  {t("showAllVisits")}
                </a>
              ) : null}
              <a className="primary-button" href={`/${tenantSlug}/field`}>
                {t("openToday")}
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

// The day is the rep's unit of work, so it is the list's unit too: visits are
// bucketed by the calendar day they happened on *in the tenant's timezone*,
// newest day first, and each day carries its own recap. Unfinished visits keep
// a gold rail and a "finish report" call to action, so the loose ends of a day
// are visible without reaching for the status filter.
function HistoryDays({
  daySummary,
  page,
  pageSize,
  tenantSlug,
  timeZone,
  visits,
}: {
  daySummary: VisitDaySummaryEntry[] | null;
  page: number;
  pageSize: number;
  tenantSlug: string;
  timeZone: string;
  visits: Visit[];
}) {
  const t = useTranslations("field.history");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  // en-CA renders as YYYY-MM-DD, which is both a stable bucket key and sortable
  // as a plain string — the locale here is an implementation detail, never
  // shown (the visible day label goes through the next-intl formatter below).
  const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  });
  const toDayKey = (value: string) => dayKeyFormat.format(new Date(value));
  const todayKey = toDayKey(new Date().toISOString());
  const yesterdayKey = shiftDayKey(todayKey, -1);
  const groups = groupVisitsByDay(visits, toDayKey);
  // Newest first, same order the list itself is fetched in, so the running
  // total below lines up with each day's actual position in the full result.
  const orderedDaySummary = [...(daySummary ?? [])].sort((left, right) =>
    right.day.localeCompare(left.day),
  );
  const daySummaryByDay = new Map(
    orderedDaySummary.map((entry) => [entry.day, entry]),
  );
  // How many visits newer than `dayKey` exist in the whole filtered set —
  // if that's already more than this page's starting offset, some of them
  // were shown on an earlier page, so this page's first day continues one
  // already headed there.
  //
  // This assumes each day's visits are one contiguous run in the list's own
  // fetch order (createdAt desc) — true as long as a visit's day key
  // (COALESCE(startedAt, createdAt), which this reads) tracks createdAt's
  // calendar day. A visit whose startedAt was edited onto a different day
  // than it was created breaks that: its day's visits could scatter across
  // non-adjacent pages, and this label could land on the wrong page or miss
  // a real continuation. Cosmetic only — the total/completed counts above
  // stay correct regardless, since they come from the aggregate rather than
  // this heuristic. The same assumption was already implicit in
  // groupVisitsByDay's per-page bucketing.
  const cumulativeBeforeDay = (dayKey: string): number => {
    let sum = 0;

    for (const entry of orderedDaySummary) {
      if (entry.day === dayKey) {
        break;
      }

      sum += entry.total;
    }

    return sum;
  };

  return (
    <div className="visit-day-groups">
      {groups.map((group, groupIndex) => {
        const summaryEntry = daySummaryByDay.get(group.key);
        const completed =
          summaryEntry?.completed ??
          group.visits.filter((visit) => visit.status === "completed").length;
        const count = summaryEntry?.total ?? group.visits.length;
        const isContinuedFromPreviousPage =
          groupIndex === 0 &&
          page > 1 &&
          daySummary !== null &&
          cumulativeBeforeDay(group.key) < (page - 1) * pageSize;
        const dayDate = new Date(visitDayTimestamp(group.visits[0]));
        const isToday = group.key === todayKey;
        const isYesterday = group.key === yesterdayKey;
        const dateLabel = format.dateTime(
          dayDate,
          isToday || isYesterday
            ? { day: "numeric", month: "long" }
            : {
                day: "numeric",
                month: "long",
                weekday: "long",
                // Only spell the year out once the history reaches back past
                // the current one, where the weekday alone stops being enough
                // to place the day.
                ...(group.key.slice(0, 4) === todayKey.slice(0, 4)
                  ? {}
                  : { year: "numeric" }),
              },
        );

        return (
          <section className="visit-day" key={group.key}>
            <div className="visit-day-header">
              {/* The day is the level above the visit cards, whose titles are
                  h3s — so it takes h2 and the page's h1 stays the only one. */}
              <h2>
                {isToday
                  ? t("dayToday", { date: dateLabel })
                  : isYesterday
                    ? t("dayYesterday", { date: dateLabel })
                    : dateLabel}
              </h2>
              {isContinuedFromPreviousPage ? (
                <p className="small-label">{t("dayContinued")}</p>
              ) : null}
              <p className="small-label">
                {t("daySummary", { completed, count })}
              </p>
            </div>
            <div className="field-card-list">
              {group.visits.map((visit) => {
                const unfinished =
                  visit.status === "draft" || visit.status === "in_progress";

                return (
                  <a
                    className={`location-mini-card location-mini-card-link visit-history-card${
                      unfinished ? " is-unfinished" : ""
                    }`}
                    href={`/${tenantSlug}/field/visits/${visit.id}`}
                    key={visit.id}
                  >
                    <header>
                      <div>
                        <h3>{visit.location.name}</h3>
                        <p>
                          {[visit.location.addressLine, visit.location.city]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      </div>
                      <span
                        className={`status-pill ${statusPillTone(visit.status)}`}
                      >
                        {formatEnumLabel(tCommon, visit.status)}
                      </span>
                    </header>
                    <p className="visit-meta">
                      {formatEnumLabel(tCommon, visit.visitType)}
                      {" · "}
                      {visitTimeText(t, format, visit)}
                    </p>
                    <span className="list-card-open">
                      {unfinished
                        ? t("finishReport")
                        : visit.status === "completed"
                          ? t("openReport")
                          : t("openVisit")}
                    </span>
                  </a>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

type VisitDayGroup = {
  key: string;
  visits: Visit[];
};

// A draft the rep never started still belongs somewhere, so the day falls back
// to when the visit was created.
function visitDayTimestamp(visit: Visit): string {
  return visit.startedAt ?? visit.createdAt;
}

function groupVisitsByDay(
  visits: Visit[],
  toDayKey: (value: string) => string,
): VisitDayGroup[] {
  const groups = new Map<string, Visit[]>();

  for (const visit of visits) {
    const key = toDayKey(visitDayTimestamp(visit));
    const bucket = groups.get(key);

    if (bucket) {
      bucket.push(visit);
    } else {
      groups.set(key, [visit]);
    }
  }

  // The API orders by creation, which is not quite the moment a visit was
  // started: sorting both the buckets and their contents keeps days strictly
  // newest-first (no day under two headers) and keeps a day's own visits in the
  // order they actually happened, rather than the order they were opened in.
  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, dayVisits]) => ({
      key,
      visits: [...dayVisits].sort(
        (left, right) =>
          Date.parse(visitDayTimestamp(right)) -
          Date.parse(visitDayTimestamp(left)),
      ),
    }));
}

// Day arithmetic on the YYYY-MM-DD key rather than on the timestamp: taking 24h
// off "now" lands on the wrong calendar day around a DST change.
function shiftDayKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function visitTimeText(
  t: ReturnType<typeof useTranslations<"field.history">>,
  format: ReturnType<typeof useFormatter>,
  visit: Visit,
): string {
  if (!visit.startedAt) {
    return t("notStarted");
  }

  const from = formatTime(format, visit.startedAt);

  return visit.completedAt
    ? t("timeRange", { from, to: formatTime(format, visit.completedAt) })
    : t("timeStarted", { from });
}

function totalOf(result: ApiResult<PaginatedResponse<Visit>>): number | null {
  return result.ok ? result.data.total : null;
}

type HistoryTranslator = Awaited<
  ReturnType<typeof getTranslations<"field.history">>
>;

function buildHistoryCounters(
  totals: {
    period: number | null;
    completed: number | null;
    followUp: number | null;
  },
  t: HistoryTranslator,
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  return [
    {
      label: t("totalLabel"),
      value: counterValue(totals.period),
      detail: t("totalDetail"),
      tone: "active",
    },
    {
      label: t("completedLabel"),
      value: counterValue(totals.completed),
      detail: t("completedDetail"),
      tone: totals.completed ? "active" : "info",
    },
    {
      label: t("needsFollowUp"),
      value: counterValue(totals.followUp),
      detail: t("needsFollowUpDetail"),
      tone: totals.followUp ? "warning" : "active",
    },
  ];
}

// A counter whose own count request failed shows the same dash the formatters
// use for a missing value rather than a zero that would read as a fact.
function counterValue(total: number | null): string {
  return total === null ? "-" : String(total);
}

function normalizeVisitStatus(value: string | undefined): VisitStatus | null {
  if (
    value === "draft" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return null;
}

function normalizeDateFilter(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

function normalizePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}
