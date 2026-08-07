import { useTranslations } from "next-intl";
import {
  getFormatter,
  getLocale,
  getTimeZone,
  getTranslations,
} from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { FilterCount } from "../../../../../components/filter-count";
import { FilterForm } from "../../../../../components/filter-form";
import { ChevronDownIcon, MapPinIcon } from "../../../../../components/icons";
import { PeriodPill } from "../../../../../components/period-pill";
import { PeriodSheet } from "../../../../../components/period-sheet";
import { ScrollStrip } from "../../../../../components/scroll-strip";
import { VisitHistoryCard } from "../../../../../components/visit-history-card";
import {
  getCurrentSession,
  listVisitDaySummary,
  listVisits,
  type Visit,
  type VisitDaySummaryEntry,
  type VisitStatus,
  type VisitStatusTotals,
} from "../../../../../lib/api-client";
import { backOrigin, withBackOrigin } from "../../../../../lib/back-navigation";
import { formatCancellationReason } from "../../../../../lib/visit-cancellation";
import { formatEnumLabel } from "../../../../../lib/format";
import {
  hasEarlierPeriod as canStepBack,
  historyFloor as resolveHistoryFloor,
  normalizeDayParam,
  normalizePage,
  periodAsRead,
  periodSearchParams,
  periodShortLabel,
  PERIOD_MAX_MONTHS,
  PERIOD_PICKER_VALUE,
  previousPeriod,
  resolvePeriod,
  VISIT_PERIOD_PARAMS,
} from "../../../../../lib/period";
import { summarizeVisitDay } from "../../../../../lib/visit-day-summary";

type FieldHistoryPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    page?: string;
    // Set by the period pill: the window itself is already in the URL, this
    // only says the picker is open over it.
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
  const [t, tField, tCommon, tPeriod, format, locale, timeZone] =
    await Promise.all([
      getTranslations("field.history"),
      getTranslations("field"),
      getTranslations("common"),
      getTranslations("common.period"),
      getFormatter(),
      getLocale(),
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
  // Resolved here rather than left to the API so the pill above the list can
  // name the period the numbers describe.
  const requestedPeriod = resolvePeriod(
    { from: requestedFrom, to: requestedTo },
    timeZone,
  );
  const page = normalizePage(pageState.page);
  const isPickerOpen = pageState.period === PERIOD_PICKER_VALUE;
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
  // carries the period's status split, so the chip counts cost nothing extra)
  // and the per-day aggregate the day headers read.
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
  // What the API actually read, which is what the pill names: a window longer
  // than the 12-month maximum comes back trimmed, and announcing the requested
  // range would claim visits nobody looked for. The trimmed-away months are
  // still reachable — as their own window, which the note under the list says.
  const period = periodAsRead(
    requestedPeriod,
    visitsResult.data.period?.startedFrom,
    timeZone,
  );
  // The whole period's split, ignoring the status chip — it arrives with the
  // list itself, so every chip can carry its own count without asking the API
  // anything more.
  //
  // Absent for a minute or two mid-deploy, when this build is already serving
  // pages against the previous API; the chips simply lose their numbers rather
  // than claiming zeroes over a visible list.
  const statusTotals = visitsResult.data.statusTotals;
  const screenHref = `/${tenantSlug}/field/history`;
  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams(query);
    params.delete("pageSize");

    if (targetPage <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(targetPage));
    }

    const search = params.toString();

    return search ? `${screenHref}?${search}` : screenHref;
  };
  // What the picker has to carry through and cannot write itself: the status
  // chip, and nothing else. Deliberately without the two date params — the
  // picker renders these as hidden fields beside its own date inputs, and a
  // second `startedFrom` in the same form would reach the URL twice.
  const pickerOtherParams = new URLSearchParams(
    selectedStatus ? { status: selectedStatus } : {},
  );
  // The window in the address, so opening and closing the picker reads the same
  // period the list is showing — but only once it is a window someone chose.
  // Writing the default 30 days into every URL would leave the screens this one
  // links to carrying dates nobody picked (see `isDefault`).
  const windowParams = period.isDefault
    ? {}
    : periodSearchParams(period, VISIT_PERIOD_PARAMS);
  const withParams = (params: Record<string, string>) => {
    const search = new URLSearchParams(pickerOtherParams);

    for (const [name, value] of Object.entries(params)) {
      search.set(name, value);
    }

    const query = search.toString();

    return query ? `${screenHref}?${query}` : screenHref;
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
  // window being empty. A status chip or a narrow window empties the list all
  // the time while older visits sit right behind it; only `historyStart` can
  // tell those apart, so `visits.length` is deliberately not consulted here.
  const historyIsEmpty = historyFloor.state === "empty";
  // With no answer at all, the step back stays offered rather than announcing
  // an end nobody confirmed.
  const hasEarlierPeriod = canStepBack(period, historyFloor);
  const earlierPeriodParams = new URLSearchParams({
    ...periodSearchParams(earlier, VISIT_PERIOD_PARAMS),
    ...(selectedStatus ? { status: selectedStatus } : {}),
  });
  // Short form, like the pill: the step sits at the bottom of a phone list and
  // has a sentence in front of it ("Earlier period: …"), so two spelled-out
  // years would wrap the control it labels.
  const earlierPeriodLabel = periodShortLabel(
    tPeriod,
    format,
    { ...earlier, preset: "custom" },
    timeZone,
  );
  // Two different endings, which the old copy collapsed into one false claim.
  // Reaching the first visit really is the end of the history. Hitting the
  // maximum window length is not — the months behind a trimmed window are one
  // date range away — so that case points at the picker instead of announcing
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
            className="period-step-back"
            href={`${screenHref}?${earlierPeriodParams.toString()}`}
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
      {/* The rep opens this screen to read the list, so the header is the title
          and the one control that says how far back it reads. The status chips
          under it say which of those visits are on screen. */}
      <header className="page-header page-header--compact history-header">
        <h1>{t("title")}</h1>
        <PeriodPill
          ariaLabel={t("visitPeriod")}
          href={withParams({
            ...windowParams,
            period: PERIOD_PICKER_VALUE,
          })}
          label={periodShortLabel(tPeriod, format, period, timeZone)}
        />
      </header>

      <section aria-label={t("myVisits")} className="visit-history">
        <FilterForm action={screenHref}>
          {/* The window travels with the chip, or picking one would drop the
              period back to the default 30 days. Hidden rather than visible
              for the same reason it is absent from the URL by default: the
              only window worth carrying is one someone chose. */}
          {period.isDefault ? null : (
            <>
              <input
                name={VISIT_PERIOD_PARAMS.from}
                type="hidden"
                value={period.from}
              />
              <input
                name={VISIT_PERIOD_PARAMS.to}
                type="hidden"
                value={period.to}
              />
            </>
          )}
          {/* One strip that scrolls sideways rather than a block that wraps:
              four chips with counts wrap to two rows on a 375px phone, and the
              second row costs the first visit its place on the screen. */}
          <ScrollStrip>
            <div
              aria-label={t("statusFiltersAria")}
              className="filter-pills filter-strip-row"
              role="radiogroup"
            >
              <label>
                <input
                  defaultChecked={selectedStatus === null}
                  name="status"
                  type="radio"
                  value=""
                />
                <span>
                  {tCommon("all")}
                  <FilterCount value={statusTotals?.total} />
                </span>
              </label>
              {visitStatuses.map((status) => (
                <label key={status}>
                  <input
                    defaultChecked={selectedStatus === status}
                    name="status"
                    type="radio"
                    value={status}
                  />
                  <span>
                    {formatEnumLabel(tCommon, status)}
                    <FilterCount value={statusCount(statusTotals, status)} />
                  </span>
                </label>
              ))}
            </div>
          </ScrollStrip>
        </FilterForm>

        {visits.length > 0 ? (
          <>
            <HistoryDays
              daySummary={daySummary}
              locale={locale}
              origin={historyOrigin}
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
            {/* Paging stops at the edge of the window rather than sliding
                silently into the archive: the last page hands over to the
                period behind this one, which is the thing that actually reaches
                further back. */}
            {page >= totalPages ? (
              <div className="period-handover">{earlierPeriodLink}</div>
            ) : null}
          </>
        ) : (
          <div className="empty-state-panel">
            {/* An empty *window* and an empty *history* are different answers
                and get different words. "No visits match this filter" is true
                of a narrow window or a status chip and points at both; it is
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
              {selectedStatus || !period.isDefault || page > 1 ? (
                <a className="secondary-button" href={screenHref}>
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

      {isPickerOpen ? (
        <PeriodSheet
          action={screenHref}
          closeHref={withParams(windowParams)}
          fromLabel={t("startedFrom")}
          names={VISIT_PERIOD_PARAMS}
          otherParams={pickerOtherParams}
          period={period}
          resetHref={period.isDefault ? undefined : screenHref}
          timeZone={timeZone}
          toLabel={t("startedTo")}
        />
      ) : null}
    </AppShell>
  );
}

// The day is the rep's unit of work, so it is the list's unit too: visits are
// bucketed by the calendar day they happened on *in the tenant's timezone*,
// newest day first, and each day carries its own count. The newest day is open
// and the ones behind it are folded, so the screen opens on the work the rep
// most likely came for without hiding anything they may go looking for.
function HistoryDays({
  daySummary,
  locale,
  origin,
  page,
  pageSize,
  tenantSlug,
  timeZone,
  visits,
}: {
  daySummary: VisitDaySummaryEntry[] | null;
  locale: string;
  origin: string;
  page: number;
  pageSize: number;
  tenantSlug: string;
  timeZone: string;
  visits: Visit[];
}) {
  const t = useTranslations("field.history");
  const tCommon = useTranslations("common");

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
  // a real continuation. Cosmetic only — the counts in the header stay
  // correct regardless, since they come from the aggregate rather than this
  // heuristic. The same assumption was already implicit in groupVisitsByDay's
  // per-page bucketing.
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
        const summary = summarizeVisitDay({
          summaryEntry: daySummaryByDay.get(group.key),
          visits: group.visits,
        });
        const isContinuedFromPreviousPage =
          groupIndex === 0 &&
          page > 1 &&
          daySummary !== null &&
          cumulativeBeforeDay(group.key) < (page - 1) * pageSize;
        const dayDate = new Date(visitDayTimestamp(group.visits[0]));
        const isToday = group.key === todayKey;
        const isYesterday = group.key === yesterdayKey;
        // Built from the date's own parts rather than as one string, so the
        // month can be set smaller than the day number beside it: the number is
        // what separates one heading from the next down a screen of them, and
        // the month repeats for a fortnight at a time.
        //
        // Raw Intl rather than the next-intl formatter, which has no parts API
        // — hence the explicit timeZone, which the formatter would otherwise
        // have applied from the tenant's own setting.
        const dateNode = new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "long",
          timeZone,
          // Only spell the year out once the history reaches back past the
          // current one, where day and month alone stop placing the day.
          ...(group.key.slice(0, 4) === todayKey.slice(0, 4)
            ? {}
            : { year: "numeric" }),
        })
          .formatToParts(dayDate)
          .map((part, partIndex) =>
            part.type === "month" ? (
              <span className="visit-day-month" key={partIndex}>
                {part.value}
              </span>
            ) : (
              part.value
            ),
          );
        // The date reaches the message as a tag rather than as a value: a
        // placeholder takes a string, and this one is elements. The tag carries
        // no content of its own — where the date sits in "Today, …" is the
        // translator's call, which is the whole point of it being in the
        // message at all.
        const dayLabel = isToday
          ? t.rich("dayToday", { date: () => <>{dateNode}</> })
          : isYesterday
            ? t.rich("dayYesterday", { date: () => <>{dateNode}</> })
            : dateNode;
        // What became of the day, in the header — so a folded day still says
        // whether it holds anything to come back to. Only what actually
        // happened is named: a day with nothing completed says nothing about
        // completions rather than "0 completed", which reads as a failure on a
        // day that was entirely cancelled.
        //
        // Each number wears its own status colour — the same three the cards
        // below use — so a folded day is read at a glance rather than word by
        // word: green for done, gold for still open, red for cancelled. Only
        // the number is coloured; the word after it stays grey, or the line
        // becomes three coloured phrases competing with the visits underneath,
        // which is the noise the rest of this header just lost.
        const recap = [
          summary.completed > 0
            ? {
                key: "completed",
                text: t.rich("countCompleted", {
                  count: summary.completed,
                  n: (chunks) => <b>{chunks}</b>,
                }),
              }
            : null,
          summary.inProgress > 0
            ? {
                key: "in-progress",
                text: t.rich("countInProgress", {
                  count: summary.inProgress,
                  n: (chunks) => <b>{chunks}</b>,
                }),
              }
            : null,
          summary.cancelled > 0
            ? {
                key: "cancelled",
                text: t.rich("countCancelled", {
                  count: summary.cancelled,
                  n: (chunks) => <b>{chunks}</b>,
                }),
              }
            : null,
        ].filter((part) => part !== null);

        return (
          // Only the newest day is open. It is the one a rep opening this
          // screen is looking at nine times out of ten, and every day below it
          // is a header-height line rather than a screenful of cards — so the
          // shape of the whole window is readable without a scroll.
          <details
            className="visit-day"
            key={group.key}
            open={groupIndex === 0}
          >
            {/* The day is the level above the visit cards, whose titles are
                h3s — so it takes h2 and the page's h1 stays the only one. */}
            <summary className="visit-day-header">
              <h2>{dayLabel}</h2>
              {/* No total here. It sat between the date and the recap saying
                  what the recap says again — "1 · 1 completed" on most days —
                  and once the recap's numbers took their status colours it was
                  the one number on the line with nothing to say. A day whose
                  work is split across states adds its own parts up. */}
              {isContinuedFromPreviousPage ? (
                <span className="small-label">{t("dayContinued")}</span>
              ) : null}
              {/* Hidden while the day is open, where the cards below say the
                  same thing in more detail — the recap is what a folded day
                  has instead of its cards, not a second copy of them. */}
              <span className="visit-day-recap">
                {recap.map((part) => (
                  <span className={`is-${part.key}`} key={part.key}>
                    {part.text}
                  </span>
                ))}
              </span>
              <span aria-hidden="true" className="visit-day-rule" />
              <span aria-hidden="true" className="visit-day-chevron">
                <ChevronDownIcon />
              </span>
            </summary>
            <div className="field-card-list">
              {group.visits.map((visit) => (
                <VisitHistoryCard
                  date={new Date(visitDayTimestamp(visit))}
                  href={withBackOrigin(
                    `/${tenantSlug}/field/visits/${visit.id}`,
                    origin,
                  )}
                  key={visit.id}
                  // Why a visit was cancelled is the one thing the row can't
                  // convey with its colour alone, so it stays on the card.
                  reason={
                    visit.status === "cancelled" && visit.cancellationReason
                      ? `${t("cancelReasonLabel")}: ${formatCancellationReason(
                          tCommon,
                          visit.cancellationReason,
                        )}`
                      : undefined
                  }
                  status={visit.status}
                  statusLabel={formatEnumLabel(tCommon, visit.status)}
                  subtitle={[visit.location.addressLine, visit.location.city]
                    .filter(Boolean)
                    .join(", ")}
                  subtitleIcon={<MapPinIcon size={13} />}
                  title={visit.location.name}
                />
              ))}
            </div>
          </details>
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

// The count behind one status chip. `undefined` rather than zero when the whole
// aggregate is missing, so the chips lose their numbers together instead of
// claiming a window holds nothing.
function statusCount(
  totals: VisitStatusTotals | undefined,
  status: VisitStatus,
): number | undefined {
  if (!totals) {
    return undefined;
  }

  if (status === "completed") {
    return totals.completed;
  }

  if (status === "in_progress") {
    return totals.inProgress;
  }

  if (status === "cancelled") {
    return totals.cancelled;
  }

  return undefined;
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
