import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../../components/app-shell";
import { BackLink } from "../../../../../../components/back-link";
import { DismissableNotice } from "../../../../../../components/dismissable-notice";
import { PackageIcon } from "../../../../../../components/icons";
import { LocationAssortmentModal } from "../../../../../../components/location-assortment-modal";
import { LocationAssortmentPanel } from "../../../../../../components/location-assortment-panel";
import { resolveBackTarget } from "../../../../../../lib/back-navigation";
import {
  getCurrentSession,
  getLocation,
  listAllProducts,
  listLocationAssortment,
} from "../../../../../../lib/api-client";
import {
  deleteLocationAssortmentAction,
  upsertLocationAssortmentAction,
} from "../../../../../../lib/location-insights-actions";

type LocationAssortmentPageProps = {
  params: Promise<{ tenantSlug: string; locationId: string }>;
  searchParams: Promise<{
    from?: string;
    error?: string;
    locationInsights?: string;
  }>;
};

export default async function LocationAssortmentPage({
  params,
  searchParams,
}: LocationAssortmentPageProps) {
  const { tenantSlug, locationId } = await params;
  const { from, error, locationInsights } = await searchParams;
  const [t, tBack, tLocationInsights] = await Promise.all([
    getTranslations("field"),
    getTranslations("common.back"),
    getTranslations("common.locationInsights"),
  ]);

  // Stay on this page after add/edit/delete (basePath = the assortment page),
  // carrying the opener so the back link still returns to the location card in
  // the state it was left — same route stop, same screen behind it. Shared
  // with the location detail screen via lib/location-insights-actions.ts.
  const basePath = `/${tenantSlug}/field/locations/${locationId}/assortment`;
  const extraParams: [string, string][] = from ? [["from", from]] : [];
  const backTarget = resolveBackTarget(tenantSlug, from, {
    href: `/${tenantSlug}/field/locations/${locationId}`,
    labelKey: "location",
  });

  const upsertAssortmentAction = upsertLocationAssortmentAction.bind(
    null,
    basePath,
    locationId,
    extraParams,
  );
  const deleteAssortmentAction = deleteLocationAssortmentAction.bind(
    null,
    basePath,
    locationId,
    extraParams,
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
  // Insights aren't available for a products-disabled tenant or an archived
  // location — send the rep back to the location card rather than showing an
  // empty, unusable page.
  if (!sessionResult.data.productsEnabled || locationResult.data.archived) {
    redirect(backTarget.href);
  }

  const locationName = locationResult.data.name;

  const [assortmentResult, productsResult] = await Promise.all([
    listLocationAssortment(locationId),
    listAllProducts(),
  ]);

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
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      {error === "locationInsights" ? (
        <DismissableNotice
          ariaLabel={tLocationInsights("errorAria")}
          body={tLocationInsights("errorBody")}
          clearParams={["error"]}
          eyebrow={t("flowEyebrow")}
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
        <BackLink
          href={backTarget.href}
          inline
          label={tBack(backTarget.labelKey)}
        />
        <div className="panel location-header">
          <div className="location-header-summary">
            <div className="location-header-identity">
              <span className="location-header-icon-lead" aria-hidden="true">
                <PackageIcon size={44} />
              </span>
              <h1 className="location-header-title">
                {tLocationInsights("assortmentTitle")}
              </h1>
              <p className="location-header-address">{locationName}</p>
              <p className="location-header-meta">
                {tLocationInsights("assortmentCount", {
                  count: assortmentRows.length,
                })}
              </p>
            </div>
          </div>
        </div>

        <section className="panel location-feature">
          <div className="location-feature-page-head">
            <span className="location-feature-icon" aria-hidden="true">
              <PackageIcon size={20} />
            </span>
            <LocationAssortmentModal
              action={upsertAssortmentAction}
              availableProducts={availableProducts}
              canManage={canManageAssortment}
              locationName={locationName}
              mode="add"
            />
          </div>
          <LocationAssortmentPanel
            availableProducts={availableProducts}
            canManage={canManageAssortment}
            coveragePct={assortmentCoverage.pct}
            deleteAction={deleteAssortmentAction}
            inStockCount={assortmentCoverage.inStock}
            locationName={locationName}
            requiredCount={assortmentCoverage.required}
            rows={assortmentRows}
            upsertAction={upsertAssortmentAction}
            variant="cards"
          />
        </section>
      </div>
    </AppShell>
  );
}
