import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../../components/app-shell";
import { BackLink } from "../../../../../../components/back-link";
import { LocationAssortmentPanel } from "../../../../../../components/location-assortment-panel";
import { LocationPotentialPanel } from "../../../../../../components/location-potential-panel";
import {
  getCurrentSession,
  getLocation,
  listLocationAssortment,
  listLocationPotential,
} from "../../../../../../lib/api-client";
import { resolveBackTarget } from "../../../../../../lib/back-navigation";

type AdminLocationDetailPageProps = {
  params: Promise<{ tenantSlug: string; locationId: string }>;
  searchParams: Promise<{ from?: string }>;
};

export default async function AdminLocationDetailPage({
  params,
  searchParams,
}: AdminLocationDetailPageProps) {
  const { tenantSlug, locationId } = await params;
  const { from } = await searchParams;
  const [t, tBack, tLocationInsights, sessionResult, locationResult] =
    await Promise.all([
      getTranslations("admin.locations"),
      getTranslations("common.back"),
      getTranslations("common.locationInsights"),
      getCurrentSession(),
      getLocation(locationId),
    ]);

  // Only the locations list opens this screen, so the destination was already
  // right — the origin is what keeps its open section and filters.
  const backTarget = resolveBackTarget(tenantSlug, from, {
    href: `/${tenantSlug}/admin/locations`,
    labelKey: "locations",
  });

  if (!locationResult.ok) {
    return (
      <AppShell activeArea="admin-locations" tenantSlug={tenantSlug}>
        <BackLink href={backTarget.href} label={tBack(backTarget.labelKey)} />
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("detailEyebrow")}</p>
            <h1>{t("detailNotFoundTitle")}</h1>
          </div>
        </header>
      </AppShell>
    );
  }

  const location = locationResult.data;
  const productsEnabled = sessionResult.ok
    ? sessionResult.data.productsEnabled
    : false;

  // The insights endpoints 404 for an archived location — they resolve
  // through findTenantLocationOrThrow (location-insights-access.ts), which
  // still excludes soft-deleted rows, unlike GET /locations/:id itself
  // (see findTenantLocationIncludingArchived in locations.service.ts). Skip
  // the calls entirely rather than firing requests that can only fail, and
  // show a neutral notice below instead of the two panels.
  const [potentialResult, assortmentResult] =
    productsEnabled && !location.archived
      ? await Promise.all([
          listLocationPotential(locationId),
          listLocationAssortment(locationId),
        ])
      : [
          { ok: false as const, status: 0, message: "Not available" },
          { ok: false as const, status: 0, message: "Not available" },
        ];

  const potentialRows = potentialResult.ok ? potentialResult.data.items : [];
  const assortmentRows = assortmentResult.ok ? assortmentResult.data.items : [];
  const assortmentCoverage = assortmentResult.ok
    ? {
        pct: assortmentResult.data.coveragePct,
        required: assortmentResult.data.requiredCount,
        inStock: assortmentResult.data.inStockCount,
        checked: assortmentResult.data.checkedCount,
      }
    : { pct: 0, required: 0, inStock: 0, checked: 0 };

  return (
    <AppShell activeArea="admin-locations" tenantSlug={tenantSlug}>
      {/* Same shape as the field location detail screen: the back link sits
          above the header card, not inside it. */}
      <div className="location-detail-sections">
        <BackLink
          href={backTarget.href}
          inline
          label={tBack(backTarget.labelKey)}
        />
        <div className="location-header panel">
          <h1 className="location-header-title">{location.name}</h1>
          <p className="location-header-address">
            {location.addressLine}, {location.city}
          </p>
        </div>

        {productsEnabled && location.archived ? (
          <section
            aria-label={tLocationInsights("archivedAria")}
            className="notice-panel"
          >
            <div>
              <p className="eyebrow">{t("detailEyebrow")}</p>
              <h2>{tLocationInsights("archivedTitle")}</h2>
              <p>{tLocationInsights("archivedBody")}</p>
            </div>
          </section>
        ) : null}

        {productsEnabled && !location.archived ? (
          <>
            <details className="panel location-feature">
              <summary className="location-feature-summary">
                <span className="location-feature-heading">
                  <span className="location-feature-icon" aria-hidden="true">
                    💰
                  </span>
                  <span className="location-feature-titles">
                    <span className="location-feature-name">
                      {tLocationInsights("potentialTitle")}
                    </span>
                    <span className="location-feature-meta">
                      {tLocationInsights("potentialCount", {
                        count: potentialRows.length,
                      })}
                    </span>
                  </span>
                </span>
                <span className="location-feature-actions">
                  <span className="location-feature-chevron" aria-hidden="true">
                    ›
                  </span>
                </span>
              </summary>
              {/* Read-only, and no admin role holds a write permission for
                either table any more: the manager authors the assortment on
                /manager/locations/:id, the assigned rep authors the potential
                in the field zone, and the admin surface only reviews both. */}
              <LocationPotentialPanel
                availableCategories={[]}
                canManage={false}
                rows={potentialRows}
              />
            </details>

            <details className="panel location-feature">
              <summary className="location-feature-summary">
                <span className="location-feature-heading">
                  <span className="location-feature-icon" aria-hidden="true">
                    📦
                  </span>
                  <span className="location-feature-titles">
                    <span className="location-feature-name">
                      {tLocationInsights("assortmentTitle")}
                    </span>
                    <span className="location-feature-meta">
                      {tLocationInsights("assortmentCount", {
                        count: assortmentRows.length,
                      })}
                    </span>
                  </span>
                </span>
                <span className="location-feature-actions">
                  <span className="location-feature-chevron" aria-hidden="true">
                    ›
                  </span>
                </span>
              </summary>
              <LocationAssortmentPanel
                canManage={false}
                checkedCount={assortmentCoverage.checked}
                coveragePct={assortmentCoverage.pct}
                inStockCount={assortmentCoverage.inStock}
                requiredCount={assortmentCoverage.required}
                rows={assortmentRows}
              />
            </details>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
