import { redirect } from "next/navigation";
import { getFormatter, getTimeZone, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../../../components/app-shell";
import { BackLink } from "../../../../../../../components/back-link";
import {
  ActivityIcon,
  CalendarIcon,
} from "../../../../../../../components/icons";
import { VisitHistoryCard } from "../../../../../../../components/visit-history-card";
import {
  getCurrentSession,
  getLocation,
  listVisits,
  type Visit,
} from "../../../../../../../lib/api-client";
import {
  backOrigin,
  resolveBackTarget,
  withBackOrigin,
} from "../../../../../../../lib/back-navigation";
import {
  formatDateTime,
  formatEnumLabel,
} from "../../../../../../../lib/format";
import { dayInTimeZone } from "../../../../../../../lib/period";

type LocationHistoryPageProps = {
  params: Promise<{ tenantSlug: string; locationId: string }>;
  searchParams: Promise<{
    from?: string;
  }>;
};

export default async function LocationHistoryPage({
  params,
  searchParams,
}: LocationHistoryPageProps) {
  const { tenantSlug, locationId } = await params;
  const { from } = await searchParams;
  const [t, tBack, tCommon, format, timeZone] = await Promise.all([
    getTranslations("field"),
    getTranslations("common.back"),
    getTranslations("common"),
    getFormatter(),
    getTimeZone(),
  ]);

  const backTarget = resolveBackTarget(tenantSlug, from, {
    href: `/${tenantSlug}/field/locations/${locationId}`,
    labelKey: "location",
  });
  // A visit report opened from here returns *here*, not to the location card
  // one level up — and this page in turn still knows its own opener.
  const selfOrigin = backOrigin(
    `/field/locations/${locationId}/history`,
    from ? { from } : {},
  );

  const [sessionResult, locationResult] = await Promise.all([
    getCurrentSession(),
    getLocation(locationId),
  ]);

  if (!sessionResult.ok) {
    redirect(`/${tenantSlug}/login`);
  }
  if (!locationResult.ok) {
    redirect(`/${tenantSlug}/field`);
  }

  const locationName = locationResult.data.name;
  const representativeUserId = sessionResult.data.user.id;

  // pageSize=50 is the API's max page size — this history list deliberately
  // shows only the 50 most recent visits for this rep at this location.
  const visitsQuery = new URLSearchParams({
    locationId,
    representativeUserId,
    pageSize: "50",
  }).toString();
  const visitsResult = await listVisits(visitsQuery);
  // This list sends no period of its own, so the API's 12-month floor is the
  // window — and an unnamed window is a count with no denominator. The
  // response says where it actually started reading; the caption repeats it
  // rather than implying "every visit ever made here".
  //
  // `period` is optional for version skew (a new frontend against the previous
  // API for a minute or two during a deploy); without it the caption falls
  // back to the plain count rather than inventing a start date.
  const readFrom = visitsResult.ok
    ? (visitsResult.data.period?.startedFrom ?? null)
    : null;
  const readFromDay = readFrom
    ? dayInTimeZone(timeZone, new Date(readFrom))
    : null;
  const visitHistory = (visitsResult.ok ? visitsResult.data.items : [])
    .filter(
      (item) => item.status === "completed" || item.status === "cancelled",
    )
    .sort((a, b) =>
      (b.completedAt ?? b.createdAt).localeCompare(
        a.completedAt ?? a.createdAt,
      ),
    );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      <div className="location-detail-sections">
        <BackLink
          href={backTarget.href}
          inline
          label={tBack(backTarget.labelKey)}
        />
        <div className="panel location-header">
          <div className="location-header-summary">
            <div className="location-header-identity">
              <span className="location-header-icon-lead" aria-hidden="true">
                <ActivityIcon size={44} />
              </span>
              <h1 className="location-header-title">
                {t("location.visitHistory")}
              </h1>
              <p className="location-header-address">{locationName}</p>
              <p className="location-header-meta">
                {readFromDay
                  ? t("location.visitCountSince", {
                      count: visitHistory.length,
                      since: format.dateTime(
                        new Date(`${readFromDay}T12:00:00.000Z`),
                        { day: "numeric", month: "short", year: "numeric" },
                      ),
                    })
                  : t("location.visitCount", { count: visitHistory.length })}
              </p>
            </div>
          </div>
        </div>

        <section className="panel location-feature">
          <div className="location-feature-page-head">
            <span className="location-feature-icon" aria-hidden="true">
              <ActivityIcon size={20} />
            </span>
          </div>
          {visitHistory.length > 0 ? (
            /* The same rows the field visit history is read in, so the two
               lists are one thing seen at two scopes. What they say differs
               with what is constant on each: there the location leads and the
               day heading above it carries the date, here every visit is at
               the same location, so the row is titled by what the visit *was*
               and the date block on the left is the only date it needs. */
            <div className="field-card-list">
              {visitHistory.map((item: Visit) => (
                <VisitHistoryCard
                  date={new Date(item.completedAt ?? item.createdAt)}
                  href={withBackOrigin(
                    `/${tenantSlug}/field/visits/${item.id}`,
                    selfOrigin,
                  )}
                  key={item.id}
                  status={item.status}
                  statusLabel={formatEnumLabel(tCommon, item.status)}
                  /* The full moment, not just the time: the date block says
                     the day and the month, and a list that reaches back past
                     New Year needs the year said somewhere. */
                  subtitle={formatDateTime(
                    format,
                    item.completedAt ?? item.createdAt,
                  )}
                  subtitleIcon={<CalendarIcon />}
                  title={formatEnumLabel(tCommon, item.visitType)}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">{t("location.noPastVisits")}</p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
