import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import { LocationAssortmentPanel } from "../../../../../components/location-assortment-panel";
import { LocationPotentialPanel } from "../../../../../components/location-potential-panel";
import {
  deleteLocationAssortment,
  deleteLocationPotential,
  getCurrentSession,
  getLocation,
  listLocationAssortment,
  listLocationPotential,
  listProductCategories,
  listProducts,
  upsertLocationAssortment,
  upsertLocationPotential,
  type AssortmentStatus,
} from "../../../../../lib/api-client";
import {
  getFormBoolean,
  getFormOptionalNumber,
  getFormOptionalString,
  getFormString,
} from "../../../../../lib/form";

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

  // Server Actions can only close over serializable data and other Server
  // Actions — not a plain helper function — so the redirect-path
  // construction is inlined into each action below rather than shared.

  async function upsertPotentialAction(formData: FormData) {
    "use server";

    const productCategoryId = getFormString(
      formData,
      "productCategoryId",
    ).trim();

    if (!productCategoryId) {
      redirect(
        `/${tenantSlug}/admin/locations/${locationId}?error=locationInsights`,
      );
    }

    const result = await upsertLocationPotential(
      locationId,
      productCategoryId,
      {
        potentialDate: getFormOptionalString(formData, "potentialDate"),
        potentialAmount: getFormOptionalNumber(formData, "potentialAmount"),
        planMonth1: getFormOptionalNumber(formData, "planMonth1"),
        planMonth2: getFormOptionalNumber(formData, "planMonth2"),
        planMonth3: getFormOptionalNumber(formData, "planMonth3"),
        comment: getFormOptionalString(formData, "comment"),
      },
    );

    redirect(
      result.ok
        ? `/${tenantSlug}/admin/locations/${locationId}?locationInsights=updated`
        : `/${tenantSlug}/admin/locations/${locationId}?error=locationInsights`,
    );
  }

  async function deletePotentialAction(formData: FormData) {
    "use server";

    const productCategoryId = getFormString(
      formData,
      "productCategoryId",
    ).trim();
    const result = productCategoryId
      ? await deleteLocationPotential(locationId, productCategoryId)
      : { ok: false as const, status: 0, message: "Missing category" };

    redirect(
      result.ok
        ? `/${tenantSlug}/admin/locations/${locationId}?locationInsights=deleted`
        : `/${tenantSlug}/admin/locations/${locationId}?error=locationInsights`,
    );
  }

  async function upsertAssortmentAction(formData: FormData) {
    "use server";

    const productId = getFormString(formData, "productId").trim();

    if (!productId) {
      redirect(
        `/${tenantSlug}/admin/locations/${locationId}?error=locationInsights`,
      );
    }

    const result = await upsertLocationAssortment(locationId, productId, {
      shouldBeListed: getFormBoolean(formData, "shouldBeListed"),
      status: getFormString(formData, "status") as AssortmentStatus,
      lastStock: getFormOptionalNumber(formData, "lastStock"),
      lastOrder: getFormOptionalNumber(formData, "lastOrder"),
      lastSale: getFormOptionalNumber(formData, "lastSale"),
      lastCheckedAt: getFormOptionalString(formData, "lastCheckedAt"),
      comment: getFormOptionalString(formData, "comment"),
    });

    redirect(
      result.ok
        ? `/${tenantSlug}/admin/locations/${locationId}?locationInsights=updated`
        : `/${tenantSlug}/admin/locations/${locationId}?error=locationInsights`,
    );
  }

  async function deleteAssortmentAction(formData: FormData) {
    "use server";

    const productId = getFormString(formData, "productId").trim();
    const result = productId
      ? await deleteLocationAssortment(locationId, productId)
      : { ok: false as const, status: 0, message: "Missing product" };

    redirect(
      result.ok
        ? `/${tenantSlug}/admin/locations/${locationId}?locationInsights=deleted`
        : `/${tenantSlug}/admin/locations/${locationId}?error=locationInsights`,
    );
  }

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

  const [potentialResult, assortmentResult, categoriesResult, productsResult] =
    productsEnabled
      ? await Promise.all([
          listLocationPotential(locationId),
          listLocationAssortment(locationId),
          listProductCategories(),
          listProducts(),
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
  const availableProducts = (productsResult.ok ? productsResult.data.items : [])
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

      {productsEnabled ? (
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
