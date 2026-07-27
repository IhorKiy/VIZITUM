import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../../components/app-shell";
import { BackLink } from "../../../../../../components/back-link";
import { ActivityIcon } from "../../../../../../components/icons";
import {
  getCurrentSession,
  getLocation,
  listVisits,
  type Visit,
} from "../../../../../../lib/api-client";
import {
  backOrigin,
  resolveBackTarget,
  withBackOrigin,
} from "../../../../../../lib/back-navigation";
import {
  formatDateTime,
  formatEnumLabel,
  statusPillTone,
} from "../../../../../../lib/format";

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
  const [t, tBack, tCommon, format] = await Promise.all([
    getTranslations("field"),
    getTranslations("common.back"),
    getTranslations("common"),
    getFormatter(),
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
                {t("location.visitCount", { count: visitHistory.length })}
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
            <div className="field-card-list">
              {visitHistory.map((item: Visit) => (
                <a
                  className="location-mini-card location-history-row"
                  href={withBackOrigin(
                    `/${tenantSlug}/field/visits/${item.id}`,
                    selfOrigin,
                  )}
                  key={item.id}
                >
                  <header>
                    <div>
                      <h3>
                        {formatDateTime(
                          format,
                          item.completedAt ?? item.createdAt,
                        )}
                      </h3>
                      <p>{formatEnumLabel(tCommon, item.visitType)}</p>
                    </div>
                    {/* This list is visit history, so "completed" is implied and
                        the badge is redundant. Only surface the non-obvious
                        "cancelled" status. */}
                    {item.status !== "completed" ? (
                      <span
                        className={`status-pill ${statusPillTone(item.status)}`}
                      >
                        {formatEnumLabel(tCommon, item.status)}
                      </span>
                    ) : null}
                  </header>
                </a>
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
