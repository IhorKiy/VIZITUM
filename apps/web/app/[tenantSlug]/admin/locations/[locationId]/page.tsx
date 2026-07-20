import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import { LocationAssortmentPanel } from "../../../../../components/location-assortment-panel";
import { LocationPotentialPanel } from "../../../../../components/location-potential-panel";
import {
  getCurrentSession,
  getLocation,
  listAllProducts,
  listLocationAssortment,
  listLocationPotential,
  listProductCategories,
} from "../../../../../lib/api-client";
import {
  deleteLocationAssortmentAction,
  deleteLocationPotentialAction,
  upsertLocationAssortmentAction,
  upsertLocationPotentialAction,
} from "../../../../../lib/location-insights-actions";

type AdminLocationDetailPageProps = {
  params: Promise<{ tenantSlug: string; locationId: string }>;
  searchParams: Promise<{
    error?: string;
    locationInsights?: string;
  }>;
};

export default async function AdminLocationDetailPage({
  params,
  searchParams,
}: AdminLocationDetailPageProps) {
  const { tenantSlug, locationId } = await params;
  const { error, locationInsights } = await searchParams;
  const [t, tLocationInsights, sessionResult, locationResult] =
    await Promise.all([
      getTranslations("admin.locations"),
      getTranslations("common.locationInsights"),
      getCurrentSession(),
      getLocation(locationId),
    ]);

  // The four potential/assortment actions are shared with the field detail
  // screen via lib/location-insights-actions.ts — bound here with this
  // zone's basePath and no extra redirect params (the field screen also
  // threads routePlanId/routeItemId through).
  const basePath = `/${tenantSlug}/admin/locations/${locationId}`;
  const upsertPotentialAction = upsertLocationPotentialAction.bind(
    null,
    basePath,
    locationId,
    [],
  );
  const deletePotentialAction = deleteLocationPotentialAction.bind(
    null,
    basePath,
    locationId,
    [],
  );
  const upsertAssortmentAction = upsertLocationAssortmentAction.bind(
    null,
    basePath,
    locationId,
    [],
  );
  const deleteAssortmentAction = deleteLocationAssortmentAction.bind(
    null,
    basePath,
    locationId,
    [],
  );

  if (!locationResult.ok) {
    return (
      <AppShell activeArea="admin-locations" tenantSlug={tenantSlug}>
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("detailEyebrow")}</p>
            <h1>{t("detailNotFoundTitle")}</h1>
          </div>
          <div className="toolbar">
            <a
              className="secondary-button"
              href={`/${tenantSlug}/admin/locations`}
            >
              {t("detailBackToList")}
            </a>
          </div>
        </header>
      </AppShell>
    );
  }

  const location = locationResult.data;
  const productsEnabled = sessionResult.ok
    ? sessionResult.data.productsEnabled
    : false;

  // The insights endpoints 404 for an archived location (they resolve
  // through the same tenant-scoped lookup as GET /locations/:id, which
  // excludes soft-deleted rows) — skip the calls entirely rather than firing
  // requests that can only fail, and show a neutral notice below instead of
  // the two panels.
  const [potentialResult, assortmentResult, categoriesResult, productsResult] =
    productsEnabled && !location.archived
      ? await Promise.all([
          listLocationPotential(locationId),
          listLocationAssortment(locationId),
          listProductCategories(),
          listAllProducts(),
        ])
      : [
          { ok: false as const, status: 0, message: "Not available" },
          { ok: false as const, status: 0, message: "Not available" },
          { ok: false as const, status: 0, message: "Not available" },
          { ok: false as const, status: 0, message: "Not available" },
        ];

  const potentialRows = potentialResult.ok ? potentialResult.data.items : [];
  const canManagePotential = potentialResult.ok
    ? potentialResult.data.canManage
    : false;
  const availableCategories = (
    categoriesResult.ok ? categoriesResult.data : []
  ).filter(
    (category) =>
      !potentialRows.some((row) => row.productCategoryId === category.id),
  );

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
    <AppShell activeArea="admin-locations" tenantSlug={tenantSlug}>
      {error === "locationInsights" ? (
        <DismissableNotice
          ariaLabel={tLocationInsights("errorAria")}
          body={tLocationInsights("errorBody")}
          clearParams={["error"]}
          eyebrow={t("detailEyebrow")}
          title={tLocationInsights("errorTitle")}
          tone="danger"
        />
      ) : null}

      {locationInsights === "updated" || locationInsights === "deleted" ? (
        <DismissableNotice
          ariaLabel={tLocationInsights("savedAria")}
          body={tLocationInsights("savedBody")}
          clearParams={["locationInsights"]}
          eyebrow={t("detailEyebrow")}
          title={tLocationInsights("savedTitle")}
          tone="success"
        />
      ) : null}

      <div className="location-header panel">
        <div className="location-header-top">
          <a
            aria-label={t("detailBackAria")}
            className="location-header-back"
            href={`/${tenantSlug}/admin/locations`}
          >
            ‹
          </a>
          <h1 className="location-header-title">{location.name}</h1>
        </div>
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
            <LocationPotentialPanel
              availableCategories={availableCategories}
              canManage={canManagePotential}
              deleteAction={deletePotentialAction}
              rows={potentialRows}
              upsertAction={upsertPotentialAction}
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
              availableProducts={availableProducts}
              canManage={canManageAssortment}
              coveragePct={assortmentCoverage.pct}
              deleteAction={deleteAssortmentAction}
              inStockCount={assortmentCoverage.inStock}
              requiredCount={assortmentCoverage.required}
              rows={assortmentRows}
              upsertAction={upsertAssortmentAction}
            />
          </details>
        </>
      ) : null}
    </AppShell>
  );
}
