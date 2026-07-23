import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../../components/app-shell";
import {
  ActivityIcon,
  ArrowLeftIcon,
} from "../../../../../../components/icons";
import {
  getCurrentSession,
  getLocation,
  listVisits,
  type Visit,
} from "../../../../../../lib/api-client";
import {
  formatDateTime,
  formatEnumLabel,
  statusPillTone,
} from "../../../../../../lib/format";

type LocationHistoryPageProps = {
  params: Promise<{ tenantSlug: string; locationId: string }>;
  searchParams: Promise<{
    routePlanId?: string;
    routeItemId?: string;
  }>;
};

export default async function LocationHistoryPage({
  params,
  searchParams,
}: LocationHistoryPageProps) {
  const { tenantSlug, locationId } = await params;
  const { routePlanId, routeItemId } = await searchParams;
  const [t, tCommon, format] = await Promise.all([
    getTranslations("field"),
    getTranslations("common"),
    getFormatter(),
  ]);

  const backParams: [string, string][] = [];
  if (routePlanId) {
    backParams.push(["routePlanId", routePlanId]);
  }
  if (routeItemId) {
    backParams.push(["routeItemId", routeItemId]);
  }
  const backQuery = new URLSearchParams(backParams).toString();
  const backHref = `/${tenantSlug}/field/locations/${locationId}${
    backQuery ? `?${backQuery}` : ""
  }`;

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
        <a
          aria-label={t("location.backToLocationAria")}
          className="location-back"
          href={backHref}
        >
          <ArrowLeftIcon size={20} />
        </a>
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
            </div>
          </div>
        </div>

        <section className="panel location-feature">
          <div className="location-feature-page-head">
            <span className="location-feature-heading">
              <span className="location-feature-icon" aria-hidden="true">
                <ActivityIcon size={20} />
              </span>
              <span className="location-feature-titles">
                <span className="location-feature-name">
                  {t("location.visitHistory")}
                </span>
                <span className="location-feature-meta">
                  {t("location.visitCount", { count: visitHistory.length })}
                </span>
              </span>
            </span>
          </div>
          {visitHistory.length > 0 ? (
            <div className="field-card-list">
              {visitHistory.map((item: Visit) => (
                <a
                  className="location-mini-card location-history-row"
                  href={`/${tenantSlug}/field/visits/${item.id}`}
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
                    <span
                      className={`status-pill ${statusPillTone(item.status)}`}
                    >
                      {formatEnumLabel(tCommon, item.status)}
                    </span>
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
