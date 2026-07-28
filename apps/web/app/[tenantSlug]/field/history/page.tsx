import { useFormatter, useTranslations } from "next-intl";
import { getFormatter, getTimeZone, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { FilterDateRange } from "../../../../components/filter-date-range";
import { FilterDisclosure } from "../../../../components/filter-disclosure";
import { FilterFooter } from "../../../../components/filter-footer";
import { FilterForm } from "../../../../components/filter-form";
import { FilterPills } from "../../../../components/filter-pills";
import { ChevronDownIcon } from "../../../../components/icons";
import { PeriodPills } from "../../../../components/period-pills";
import {
  getCurrentSession,
  listVisitDaySummary,
  listVisits,
  type Visit,
  type VisitDaySummaryEntry,
  type VisitStatus,
  type VisitStatusTotals,
} from "../../../../lib/api-client";
import { backOrigin, withBackOrigin } from "../../../../lib/back-navigation";
import { formatCancellationReason } from "../../../../lib/visit-cancellation";
import { isDayFullyDone } from "../../../../lib/visit-history-days";
import { formatEnumLabel, statusPillTone } from "../../../../lib/format";
import {
  hasEarlierPeriod as canStepBack,
  historyFloor as resolveHistoryFloor,
  normalizeDayParam,
  normalizePage,
  periodAsRead,
  periodLabel as formatPeriodLabel,
  periodSearchParams,
  PERIOD_MAX_MONTHS,
  previousPeriod,
  resolvePeriod,
  VISIT_PERIOD_PARAMS,
} from "../../../../lib/period";

type FieldHistoryPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    page?: string;
    // Set by the "Period…" pill: the range itself is already in the URL, this
    // only asks the filter panel to open on it.
    period?: string;
    startedFrom?: string;
    startedTo?: string;
    status?: string;
  }>;
};

// "draft" is a real VisitStatus enum value but createVisit always writes
// "in_progress" immediately — nothing in the product ever leaves a visit
// in "draft", so it's excluded here rather than offered as a dead filter.
const visitStatuses: VisitStatus[] = ["in_progress", "completed", "cancelled"];

// Half the API's max: the list renders one card per visit under a day header,
// so a full 100 would be a very long scroll on the phone this zone is built
// for. Anything older is one "earlier visits" step away.
const PAGE_SIZE = 50;

export default async function FieldHistoryPage({
  params,
  searchParams,
}: FieldHistoryPageProps) {
  const { tenantSlug } = await params;
  const [t, tField, tCommon, tPeriod, format, timeZone] = await Promise.all([
    getTranslations("field.history"),
    getTranslations("field"),
    getTranslations("common"),
    getTranslations("common.period"),
    getFormatter(),
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
  const requestedFrom = normalizeDayParam(pageState.startedFrom);
  const requestedTo = normalizeDayParam(pageState.startedTo);
  // The list is always read through a named window: with nothing in the URL
  // that is the last 30 days in the tenant's timezone, not all of history.
  // Resolved here rather than left to the API so the recap below can say which
  // period the numbers describe.
  const requestedPeriod = resolvePeriod(
    { from: requestedFrom, to: requestedTo },
    timeZone,
  );
  const page = normalizePage(pageState.page);
  // The default window is nobody's choice, so it doesn't light the filter
  // panel; a period the rep picked does.
  const hasFilters = Boolean(selectedStatus) || !requestedPeriod.isDefault;
  // A visit report opens from here, from the location card and from a
  // location's own history; it returns to whichever one it was opened from,
  // with this list's period/status/page still applied. The window travels as
  // dates rather than as a preset name so the return lands on the same days,
  // not on a relative window that has since slid.
  const historyOrigin = backOrigin("/field/history", {
    page: page > 1 ? page : undefined,
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

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  // Same filter as the list above, minus pagination: the day recap has to
  // cover every visit in the filtered set, not just the ones on this page.
  const daySummaryQuery = new URLSearchParams(query);
  daySummaryQuery.delete("page");
  daySummaryQuery.delete("pageSize");

  // Two requests for the whole screen: the page of visits (whose response
  // carries the period's status split, so the recap costs nothing extra) and
  // the per-day aggregate the day headers read.
  const [visitsResult, daySummaryResult] = await Promise.all([
    listVisits(query.toString()),
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
  // What the API actually read, which is what the recap names: a window longer
  // than the 12-month maximum comes back trimmed, and announcing the requested
  // range would claim visits nobody looked for. The trimmed-away months are
  // still reachable — as their own window, which the note under the list says.
  const period = periodAsRead(
    requestedPeriod,
    visitsResult.data.period?.startedFrom,
    timeZone,
  );
  const periodLabel = formatPeriodLabel(tPeriod, format, period);
  // The whole period's split, ignoring the status pill — it arrives with the
  // list itself, so picking a pill promotes one of these numbers to the front
  // of the line without asking the API anything more.
  //
  // Absent for a minute or two mid-deploy, when this build is already serving
  // pages against the previous API. A recap reading "0 visits" above a list of
  // visible cards is worse than no recap, so the whole line sits it out.
  const statusTotals = visitsResult.data.statusTotals;
  const counts = statusTotals
    ? buildHistoryCounts(statusTotals, selectedStatus, t)
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
      ? `/${tenantSlug}/field/history?${search}`
      : `/${tenantSlug}/field/history`;
  };
  // Where the list continues once this window is read out: the window of the
  // same length immediately behind it, on page one.
  const earlier = previousPeriod(period);
  // ...unless there is nothing behind it. The bottom of this list is the rep's
  // own first visit, which only the API can name (`historyStart`, unbounded by
  // the window and scoped exactly like the day aggregate). It is *not* "twelve
  // months ago": the API caps how long one window may be, not how far back a
  // window may point, so a rep who names an older range still gets its data.
  // Without a real floor the handover would either walk into empty window
  // after empty window forever, or stop at a line the data doesn't have.
  //
  // A failed day-summary request passes `undefined`, not `null`: "the API did
  // not answer" and "the API answered, and this scope is empty" are both
  // truthful states with opposite consequences, and flattening them is how a
  // confirmed "nothing was ever recorded" turns back into an endless walk.
  const historyFloor = resolveHistoryFloor(
    daySummaryResult.ok ? daySummaryResult.data.historyStart : undefined,
    timeZone,
  );
  // Nothing was ever recorded in this scope — which is *not* the same as this
  // window being empty. A status pill or a narrow window empties the list all
  // the time while older visits sit right behind it; only `historyStart` can
  // tell those apart, so `visits.length` is deliberately not consulted here.
  const historyIsEmpty = historyFloor.state === "empty";
  // With no answer at all, the step back stays offered rather than announcing
  // an end nobody confirmed.
  const hasEarlierPeriod = canStepBack(period, historyFloor);
  const earlierPeriodParams = new URLSearchParams({
    ...periodSearchParams(earlier, VISIT_PERIOD_PARAMS),
    ...(selectedStatus ? { status: selectedStatus } : {}),
    // Opens the filter panel on the range it just moved to, so the next step
    // back is one edit away rather than a second guess.
    period: "custom",
  });
  const earlierPeriodLabel = formatPeriodLabel(tPeriod, format, {
    ...earlier,
    preset: "custom",
  });
  // Two different endings, which the old copy collapsed into one false claim.
  // Reaching the first visit really is the end of the history. Hitting the
  // maximum window length is not — the months behind a trimmed window are one
  // date range away — so that case points at the filter instead of announcing
  // a bottom, and the step back stays offered.
  //
  // The trimmed note stands down once the first visit is inside the window:
  // "nothing was recorded before this" is the stronger, more specific answer,
  // and inviting someone to dig deeper for data that does not exist is exactly
  // the walk-into-nothing this whole block exists to prevent.
  const earlierPeriodLink = (
    <>
      {hasEarlierPeriod ? (
        <>
          <a
            className="secondary-button"
            href={`/${tenantSlug}/field/history?${earlierPeriodParams.toString()}`}
          >
            {t("periodEarlier", { period: earlierPeriodLabel })}
          </a>
          {period.clamped ? (
            <p className="small-label">
              {t("periodWindowCapped", { months: PERIOD_MAX_MONTHS })}
            </p>
          ) : null}
        </>
      ) : historyIsEmpty ? (
        <p className="small-label">{t("emptyEverTitle")}</p>
      ) : (
        <p className="small-label">{t("periodOldestReached")}</p>
      )}
    </>
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field-history">
      {/* The rep opens this screen to read the list, so the header is the
          title and nothing else: the period recap moved down to the list it
          describes, and "today"/"new visit" are one tap away in the tab bar. */}
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
        </div>
      </header>

      <section aria-label={t("myVisits")} className="panel drilldown-panel">
        <FilterForm action={`/${tenantSlug}/field/history`}>
          <div className="panel-toolbar panel-toolbar-filters">
            {/* How deep the list reads sits above what it is cut by: the
                period is the denominator every count below is measured
                against, the status pill only narrows the cards. */}
            <PeriodPills
              action={`/${tenantSlug}/field/history`}
              ariaLabel={t("visitPeriod")}
              names={VISIT_PERIOD_PARAMS}
              otherParams={
                new URLSearchParams(
                  selectedStatus ? { status: selectedStatus } : {},
                )
              }
              period={period}
              timeZone={timeZone}
            />
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
            hasFilters={hasFilters || pageState.period === "custom"}
            label={tCommon("filtersLabel")}
          >
            <div className="filter-form field-history-filter-form">
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
              {/* No match count here: the recap line under the panel already
                  leads with the count for this very selection. */}
              <FilterFooter
                resetHref={
                  hasFilters ? `/${tenantSlug}/field/history` : undefined
                }
                resetLabel={tCommon("reset")}
              />
            </div>
          </FilterDisclosure>
        </FilterForm>

        {/* No aria-label here: ARIA prohibits naming a paragraph, and the line
            reads as its own label anyway. */}
        {/* The period leads the line: a count with no window behind it is a
            number without a denominator. */}
        {statusTotals ? (
          <p className="list-count-summary">
            <strong>{periodLabel}</strong>
            {counts.map((part) => (
              <span key={part}>{part}</span>
            ))}
          </p>
        ) : null}

        {visits.length > 0 ? (
          <>
            <HistoryDays
              daySummary={daySummary}
              origin={historyOrigin}
              page={page}
              pageSize={PAGE_SIZE}
              // Under a status pill the day recap would only ever describe that
              // one status — "0% completed" on every day of an in-progress
              // list — so the share sits it out until the pill is cleared.
              showCompletedShare={!selectedStatus}
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
            {/* Paging stops at the edge of the window rather than sliding
                silently into the archive: the last page hands over to the
                period control, which is the thing that actually reaches
                further back. */}
            {page >= totalPages ? (
              <div className="period-exhausted">
                <p className="small-label">{t("periodExhaustedTitle")}</p>
                <p>{t("periodExhaustedBody")}</p>
                {earlierPeriodLink}
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-state-panel">
            {/* An empty *window* and an empty *history* are different answers
                and get different words. "No visits match this filter" is true
                of a narrow window or a status pill and points at both; it is
                wrong for a rep who has never worked, where no filter and no
                date will ever help. */}
            <h2>{historyIsEmpty ? t("emptyEverTitle") : t("emptyTitle")}</h2>
            <p>{historyIsEmpty ? t("emptyEverBody") : t("emptyBody")}</p>
            <div className="toolbar">
              {/* An empty window is the one case where reaching further back
                  is the obvious next move, so the same handover the end of a
                  full list offers sits here too — and it stops at the same
                  floor rather than offering an endless walk into nothing.
                  With nothing recorded anywhere there is no step to offer, and
                  the panel above has already said so once; a second copy of
                  that sentence in the toolbar would be the two-messages-side-
                  by-side this replaced. */}
              {historyIsEmpty ? null : earlierPeriodLink}
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
  origin,
  page,
  pageSize,
  showCompletedShare,
  tenantSlug,
  timeZone,
  visits,
}: {
  daySummary: VisitDaySummaryEntry[] | null;
  origin: string;
  page: number;
  pageSize: number;
  showCompletedShare: boolean;
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
  // Oldest day still inside the current week of work (today plus the six days
  // behind it) — the window where a weekday name still means something to the
  // rep reading the list.
  const weekStartKey = shiftDayKey(todayKey, -6);
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

  // Each day's recap numbers, resolved once so the fully-done filter below and
  // the rendered header read the same figures.
  const groupsWithStats = groups.map((group, groupIndex) => {
    const summaryEntry = daySummaryByDay.get(group.key);
    const completed =
      summaryEntry?.completed ??
      group.visits.filter((visit) => visit.status === "completed").length;
    const count = summaryEntry?.total ?? group.visits.length;
    const cancelled =
      summaryEntry?.cancelled ??
      group.visits.filter((visit) => visit.status === "cancelled").length;
    // The share, not the tally: how a day went is one number, and the day
    // opens onto its own visits for anyone who wants them counted. The raw
    // tally stays on the hover title.
    //
    // Cancelled visits leave the denominator: they were closed with a
    // reason, not left undone, so a day of four completed and four
    // cancelled reads as finished rather than half done. A day that was
    // cancelled outright has nothing left to take a share of, so it shows
    // no percentage at all — its cards carry the cancelled pill.
    const workable = count - cancelled;
    const completedPercent =
      workable > 0 ? Math.round((completed / workable) * 100) : null;

    return {
      cancelled,
      completed,
      completedPercent,
      group,
      groupIndex,
      workable,
    };
  });
  // A day where every workable visit is completed has nothing left to act on,
  // so it steps out of the running list and into one collapsed section at the
  // bottom — see isDayFullyDone for the two conditions that make it safe to
  // treat a day as done. `showCompletedShare` is precisely "no pill is active".
  //
  // Collected rather than dropped: the rep who goes looking for a day they know
  // they worked still finds it here, in the same list, one tap away — no filter
  // change, no lost scroll position.
  const openGroups: typeof groupsWithStats = [];
  const doneGroups: typeof groupsWithStats = [];

  for (const entry of groupsWithStats) {
    const bucket = isDayFullyDone({
      completedPercent: entry.completedPercent,
      dayTotalsTrusted: daySummary !== null,
      statusFilterActive: !showCompletedShare,
    })
      ? doneGroups
      : openGroups;

    bucket.push(entry);
  }

  // One day, rendered the same whether it sits in the running list or inside
  // the collapsed section — a completed day keeps its header, its share and its
  // visit cards, it just isn't in the way.
  const renderDay = ({
    cancelled,
    completed,
    completedPercent,
    group,
    groupIndex,
    workable,
  }: (typeof groupsWithStats)[number]) => {
    const isContinuedFromPreviousPage =
      groupIndex === 0 &&
      page > 1 &&
      daySummary !== null &&
      cumulativeBeforeDay(group.key) < (page - 1) * pageSize;
    const dayDate = new Date(visitDayTimestamp(group.visits[0]));
    const isToday = group.key === todayKey;
    const isYesterday = group.key === yesterdayKey;
    // The date leads; the weekday is an aid for placing a day the rep still
    // remembers by name, so it only rides along for the current week and
    // drops off entirely further back.
    const isThisWeek = group.key >= weekStartKey;
    const dateLabel = format.dateTime(dayDate, {
      day: "numeric",
      month: "long",
      // Only spell the year out once the history reaches back past the
      // current one, where day and month alone stop placing the day.
      ...(group.key.slice(0, 4) === todayKey.slice(0, 4)
        ? {}
        : { year: "numeric" }),
    });
    const dayLabel = isToday
      ? t("dayToday", { date: dateLabel })
      : isYesterday
        ? t("dayYesterday", { date: dateLabel })
        : isThisWeek
          ? t("dayWithWeekday", {
              date: dateLabel,
              weekday: format.dateTime(dayDate, { weekday: "long" }),
            })
          : dateLabel;

    return (
      <details className="visit-day" key={group.key}>
        {/* The day is the level above the visit cards, whose titles are
                h3s — so it takes h2 and the page's h1 stays the only one. */}
        <summary className="visit-day-header">
          <span className="visit-day-header-text">
            <h2>{dayLabel}</h2>
            {isContinuedFromPreviousPage ? (
              <span className="small-label">{t("dayContinued")}</span>
            ) : null}
            {showCompletedShare && completedPercent !== null ? (
              <span
                className="small-label"
                title={
                  cancelled > 0
                    ? t("daySummaryTitleCancelled", {
                        cancelled,
                        completed,
                        count: workable,
                      })
                    : t("daySummaryTitle", { completed, count: workable })
                }
              >
                {t("daySummary", { completedPercent })}
              </span>
            ) : null}
          </span>
          <span aria-hidden="true" className="visit-day-chevron">
            <ChevronDownIcon />
          </span>
        </summary>
        <div className="field-card-list">
          {group.visits.map((visit) => {
            const unfinished = visit.status === "in_progress";

            return (
              <a
                className={`location-mini-card location-mini-card-link visit-history-card${
                  unfinished ? " is-unfinished" : ""
                }`}
                href={withBackOrigin(
                  `/${tenantSlug}/field/visits/${visit.id}`,
                  origin,
                )}
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
                {/* Why a visit was cancelled is the one thing the card
                        can't convey with its status pill alone, so it stays
                        even on the slimmed-down card. */}
                {visit.status === "cancelled" && visit.cancellationReason ? (
                  <p className="visit-meta">
                    {t("cancelReasonLabel")}
                    {": "}
                    {formatCancellationReason(
                      tCommon,
                      visit.cancellationReason,
                    )}
                  </p>
                ) : null}
              </a>
            );
          })}
        </div>
      </details>
    );
  };

  return (
    <div className="visit-day-groups">
      {openGroups.map(renderDay)}
      {doneGroups.length > 0 ? (
        <details className="visit-days-done">
          <summary className="visit-days-done-header">
            <span className="small-label">
              {t("completedDaysSection", { count: doneGroups.length })}
            </span>
            <span aria-hidden="true" className="visit-day-chevron">
              <ChevronDownIcon />
            </span>
          </summary>
          <div className="visit-days-done-list">
            {doneGroups.map(renderDay)}
          </div>
        </details>
      ) : null}
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

type HistoryTranslator = Awaited<
  ReturnType<typeof getTranslations<"field.history">>
>;

// The rest of the recap line, after the period that leads it: with no status
// pill it reads as the period's own total and its two working numbers, and
// picking a status promotes that status's count to the front while the split
// stays visible behind it. Cancelled is only ever the selected count — the
// resting line keeps to the two numbers a rep acts on, done and still open.
//
// Every number comes from one status aggregate the list response already
// carried, so the pill changes the phrasing, never the request count.
function buildHistoryCounts(
  totals: VisitStatusTotals,
  selectedStatus: VisitStatus | null,
  t: HistoryTranslator,
): string[] {
  // A period with nothing in it needs no tally: the empty state below already
  // says so, and a row of zeroes just repeats the news — the period label
  // leading the line still stands on its own.
  if (totals.total === 0) {
    return [];
  }

  const total = t("countTotal", { count: totals.total });
  const completed = t("countCompleted", { count: totals.completed });
  const inProgress = t("countInProgress", { count: totals.inProgress });

  if (!selectedStatus) {
    return [t("countVisits", { count: totals.total }), completed, inProgress];
  }

  // "draft" is a real VisitStatus but never offered as a filter, so it has no
  // count phrasing of its own and simply leaves the line to the split below.
  const selected =
    selectedStatus === "completed"
      ? completed
      : selectedStatus === "in_progress"
        ? inProgress
        : selectedStatus === "cancelled"
          ? t("countCancelled", { count: totals.cancelled })
          : null;

  return [
    selected,
    selectedStatus === "completed" ? inProgress : completed,
    total,
  ].filter((part): part is string => part !== null);
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
