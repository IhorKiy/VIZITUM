import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { BackLink } from "../../../../../components/back-link";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import { PackageIcon } from "../../../../../components/icons";
import { LocationAssortmentModal } from "../../../../../components/location-assortment-modal";
import { LocationAssortmentPanel } from "../../../../../components/location-assortment-panel";
import { LocationPotentialPanel } from "../../../../../components/location-potential-panel";
import {
  getCurrentSession,
  getLocation,
  listAllProducts,
  listLocationAssortment,
  listLocationPotential,
} from "../../../../../lib/api-client";
import {
  deleteLocationAssortmentAction,
  upsertLocationAssortmentAction,
} from "../../../../../lib/location-insights-actions";

type ManagerLocationDetailPageProps = {
  params: Promise<{ tenantSlug: string; locationId: string }>;
  searchParams: Promise<{
    error?: string;
    locationInsights?: string;
  }>;
};

export default async function ManagerLocationDetailPage({
  params,
  searchParams,
}: ManagerLocationDetailPageProps) {
  const { tenantSlug, locationId } = await params;
  const { error, locationInsights } = await searchParams;
  const [t, tManager, tLocationInsights, sessionResult, locationResult] =
    await Promise.all([
      getTranslations("manager.locations"),
      getTranslations("manager"),
      getTranslations("common.locationInsights"),
      getCurrentSession(),
      getLocation(locationId),
    ]);

  const listHref = `/${tenantSlug}/manager/locations`;

  if (!locationResult.ok) {
    return (
      <AppShell activeArea="manager-locations" tenantSlug={tenantSlug}>
        <BackLink href={listHref} label={t("detailBackAria")} />
        <header className="page-header">
          <div>
            <p className="eyebrow">{tManager("eyebrow")}</p>
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

  // This screen exists to edit the assortment, so the redirects the four
  // insights actions perform come back here. No route-stop context to carry:
  // that pair is a field-zone concern, so the extra params stay empty.
  const basePath = `/${tenantSlug}/manager/locations/${locationId}`;
  const extraParams: [string, string][] = [];
  const upsertAssortment = upsertLocationAssortmentAction.bind(
    null,
    basePath,
    locationId,
    extraParams,
  );
  const deleteAssortment = deleteLocationAssortmentAction.bind(
    null,
    basePath,
    locationId,
    extraParams,
  );

  // Same reasoning as the admin detail screen: the insights endpoints 404 for
  // an archived location, so skip calls that can only fail and show a neutral
  // notice instead of two empty panels.
  const [potentialResult, assortmentResult, productsResult] =
    productsEnabled && !location.archived
      ? await Promise.all([
          listLocationPotential(locationId),
          listLocationAssortment(locationId),
          listAllProducts(),
        ])
      : [
          { ok: false as const, status: 0, message: "Not available" },
          { ok: false as const, status: 0, message: "Not available" },
          { ok: false as const, status: 0, message: "Not available" },
        ];

  const potentialRows = potentialResult.ok ? potentialResult.data.items : [];
  const assortmentRows = assortmentResult.ok ? assortmentResult.data.items : [];
  const canManageAssortment = assortmentResult.ok
    ? assortmentResult.data.canManage
    : false;
  const assortmentCoverage = assortmentResult.ok
    ? {
        pct: assortmentResult.data.coveragePct,
        required: assortmentResult.data.requiredCount,
        inStock: assortmentResult.data.inStockCount,
      }
    : { pct: 0, required: 0, inStock: 0 };
  const availableProducts = (productsResult.ok ? productsResult.data : [])
    .filter(
      (product) => !assortmentRows.some((row) => row.productId === product.id),
    )
    .map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
    }));

  return (
    <AppShell activeArea="manager-locations" tenantSlug={tenantSlug}>
      {error === "locationInsights" ? (
        <DismissableNotice
          ariaLabel={tLocationInsights("errorAria")}
          body={tLocationInsights("errorBody")}
          clearParams={["error"]}
          eyebrow={tManager("eyebrow")}
          title={tLocationInsights("errorTitle")}
          tone="danger"
        />
      ) : null}

      {locationInsights === "updated" || locationInsights === "deleted" ? (
        <DismissableNotice
          ariaLabel={tLocationInsights("savedAria")}
          clearParams={["locationInsights"]}
          compact
          title={tLocationInsights("savedTitle")}
          tone="success"
        />
      ) : null}

      <div className="location-detail-sections">
        <BackLink href={listHref} inline label={t("detailBackAria")} />
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
              <p className="eyebrow">{tManager("eyebrow")}</p>
              <h2>{tLocationInsights("archivedTitle")}</h2>
              <p>{tLocationInsights("archivedBody")}</p>
            </div>
          </section>
        ) : null}

        {productsEnabled && !location.archived ? (
          <>
            {/* The assortment is this screen's reason to exist — the standard
                the manager sets for the outlet — so it is open and editable,
                above the potential rather than after it. */}
            <section className="panel location-feature">
              <div className="location-feature-page-head">
                <span className="location-feature-icon" aria-hidden="true">
                  <PackageIcon size={20} />
                </span>
                <LocationAssortmentModal
                  action={upsertAssortment}
                  availableProducts={availableProducts}
                  canManage={canManageAssortment}
                  locationName={location.name}
                  mode="add"
                />
              </div>
              <LocationAssortmentPanel
                availableProducts={availableProducts}
                canManage={canManageAssortment}
                coveragePct={assortmentCoverage.pct}
                deleteAction={deleteAssortment}
                inStockCount={assortmentCoverage.inStock}
                locationName={location.name}
                requiredCount={assortmentCoverage.required}
                rows={assortmentRows}
                upsertAction={upsertAssortment}
                variant="cards"
              />
            </section>

            {/* Read-only by design: the potential belongs to the assigned
                representative, who edits it from the field zone. */}
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
              <LocationPotentialPanel
                availableCategories={[]}
                canManage={false}
                rows={potentialRows}
              />
            </details>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
