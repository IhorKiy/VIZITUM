import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import { LocationAssortmentPanel } from "../../../../../components/location-assortment-panel";
import { LocationPotentialPanel } from "../../../../../components/location-potential-panel";
import { PendingSubmitButton } from "../../../../../components/pending-submit-button";
import {
  createVisit,
  deleteLocationAssortment,
  deleteLocationPotential,
  getCurrentSession,
  getLocation,
  listAllProducts,
  listLocationAssortment,
  listLocationPotential,
  listProductCategories,
  listTasks,
  listVisits,
  updateRouteItem,
  upsertLocationAssortment,
  upsertLocationPotential,
  type AssortmentStatus,
  type Task,
  type Visit,
} from "../../../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../../../lib/demo-mode";
import {
  formatDateTime,
  formatEnumLabel,
  statusPillTone,
} from "../../../../../lib/format";
import {
  getFormBoolean,
  getFormOptionalNumber,
  getFormOptionalString,
  getFormString,
} from "../../../../../lib/form";

type LocationDetailPageProps = {
  params: Promise<{ tenantSlug: string; locationId: string }>;
  searchParams: Promise<{
    routePlanId?: string;
    routeItemId?: string;
    visited?: string;
    route?: string;
    error?: string;
    locationInsights?: string;
    demoName?: string;
    demoAddress?: string;
  }>;
};

export default async function LocationDetailPage({
  params,
  searchParams,
}: LocationDetailPageProps) {
  const { tenantSlug, locationId } = await params;
  const {
    routePlanId,
    routeItemId,
    visited,
    route,
    error,
    locationInsights,
    demoName,
    demoAddress,
  } = await searchParams;
  const stopAlreadyVisited = visited === "1";
  const [t, tCommon, tLocationInsights, format] = await Promise.all([
    getTranslations("field"),
    getTranslations("common"),
    getTranslations("common.locationInsights"),
    getFormatter(),
  ]);

  async function startVisitAction(formData: FormData) {
    "use server";

    const actionSessionResult = await getCurrentSession();
    const formRouteItemId = getFormString(formData, "routeItemId").trim();

    if (!actionSessionResult.ok) {
      redirect(
        `/${tenantSlug}/field/locations/${locationId}?error=visit${
          routePlanId ? `&routePlanId=${routePlanId}` : ""
        }${routeItemId ? `&routeItemId=${routeItemId}` : ""}`,
      );
    }

    const result = await createVisit(
      locationId,
      actionSessionResult.data.user.id,
      "field_visit",
      formRouteItemId || undefined,
    );

    if (!result.ok) {
      redirect(
        `/${tenantSlug}/field/locations/${locationId}?error=visit${
          routePlanId ? `&routePlanId=${routePlanId}` : ""
        }${routeItemId ? `&routeItemId=${routeItemId}` : ""}`,
      );
    }

    redirect(`/${tenantSlug}/field/visits/${result.data.id}`);
  }

  async function markVisitedAction(formData: FormData) {
    "use server";

    const formRoutePlanId = getFormString(formData, "routePlanId").trim();
    const formRouteItemId = getFormString(formData, "routeItemId").trim();

    if (!formRoutePlanId || !formRouteItemId) {
      redirect(`/${tenantSlug}/field/locations/${locationId}?error=route`);
    }

    const result = await updateRouteItem(formRoutePlanId, formRouteItemId, {
      status: "visited",
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/field/locations/${locationId}?error=route`);
    }

    redirect(
      `/${tenantSlug}/field/locations/${locationId}?route=visited&routePlanId=${formRoutePlanId}&routeItemId=${formRouteItemId}&visited=1`,
    );
  }

  // Server Actions can only close over serializable data and other Server
  // Actions — not a plain helper function — so the redirect-path
  // construction is inlined into each action below rather than shared.

  async function upsertPotentialAction(formData: FormData) {
    "use server";

    const params = new URLSearchParams();
    if (routePlanId) {
      params.set("routePlanId", routePlanId);
    }
    if (routeItemId) {
      params.set("routeItemId", routeItemId);
    }

    const productCategoryId = getFormString(
      formData,
      "productCategoryId",
    ).trim();

    if (!productCategoryId) {
      params.set("error", "locationInsights");
      redirect(
        `/${tenantSlug}/field/locations/${locationId}?${params.toString()}`,
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

    if (result.ok) {
      params.set("locationInsights", "updated");
    } else {
      params.set("error", "locationInsights");
    }
    redirect(
      `/${tenantSlug}/field/locations/${locationId}?${params.toString()}`,
    );
  }

  async function deletePotentialAction(formData: FormData) {
    "use server";

    const params = new URLSearchParams();
    if (routePlanId) {
      params.set("routePlanId", routePlanId);
    }
    if (routeItemId) {
      params.set("routeItemId", routeItemId);
    }

    const productCategoryId = getFormString(
      formData,
      "productCategoryId",
    ).trim();
    const result = productCategoryId
      ? await deleteLocationPotential(locationId, productCategoryId)
      : { ok: false as const, status: 0, message: "Missing category" };

    if (result.ok) {
      params.set("locationInsights", "deleted");
    } else {
      params.set("error", "locationInsights");
    }
    redirect(
      `/${tenantSlug}/field/locations/${locationId}?${params.toString()}`,
    );
  }

  async function upsertAssortmentAction(formData: FormData) {
    "use server";

    const params = new URLSearchParams();
    if (routePlanId) {
      params.set("routePlanId", routePlanId);
    }
    if (routeItemId) {
      params.set("routeItemId", routeItemId);
    }

    const productId = getFormString(formData, "productId").trim();

    if (!productId) {
      params.set("error", "locationInsights");
      redirect(
        `/${tenantSlug}/field/locations/${locationId}?${params.toString()}`,
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

    if (result.ok) {
      params.set("locationInsights", "updated");
    } else {
      params.set("error", "locationInsights");
    }
    redirect(
      `/${tenantSlug}/field/locations/${locationId}?${params.toString()}`,
    );
  }

  async function deleteAssortmentAction(formData: FormData) {
    "use server";

    const params = new URLSearchParams();
    if (routePlanId) {
      params.set("routePlanId", routePlanId);
    }
    if (routeItemId) {
      params.set("routeItemId", routeItemId);
    }

    const productId = getFormString(formData, "productId").trim();
    const result = productId
      ? await deleteLocationAssortment(locationId, productId)
      : { ok: false as const, status: 0, message: "Missing product" };

    if (result.ok) {
      params.set("locationInsights", "deleted");
    } else {
      params.set("error", "locationInsights");
    }
    redirect(
      `/${tenantSlug}/field/locations/${locationId}?${params.toString()}`,
    );
  }

  const [sessionResult, locationResult] = await Promise.all([
    getCurrentSession(),
    getLocation(locationId),
  ]);

  const demoFallbackEnabled = isDemoFallbackEnabled();
  const isDemoLocation =
    !sessionResult.ok && demoFallbackEnabled && Boolean(demoName);

  if (!sessionResult.ok && !isDemoLocation) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("flowEyebrow")}</p>
            <h1>{t("location.signedOutTitle")}</h1>
            <p>{t("location.signedOutBody")}</p>
          </div>
          <div
            className="toolbar"
            aria-label={tCommon("notice.sessionActions")}
          >
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>
      </AppShell>
    );
  }

  if (!isDemoLocation && !locationResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("flowEyebrow")}</p>
            <h1>{t("location.notFoundTitle")}</h1>
          </div>
          <div className="toolbar" aria-label={t("location.locationActions")}>
            <a className="secondary-button" href={`/${tenantSlug}/field`}>
              {t("backToRoute")}
            </a>
          </div>
        </header>
        <section
          className="notice-panel danger"
          aria-label={t("location.locationErrorAria")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{t("location.loadErrorTitle")}</h2>
            <p>{locationResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const locationName = locationResult.ok
    ? locationResult.data.name
    : (demoName ?? t("location.demoLocationName"));
  const locationAddress = locationResult.ok
    ? [locationResult.data.addressLine, locationResult.data.city]
        .filter(Boolean)
        .join(", ")
    : (demoAddress ?? "");
  const representativeName = sessionResult.ok
    ? sessionResult.data.user.name
    : t("location.demoRepresentative");

  const representativeUserId = sessionResult.ok
    ? sessionResult.data.user.id
    : null;

  const [visitsResult, tasksResult] = isDemoLocation
    ? [
        { ok: false as const, status: 0, message: "Demo mode" },
        { ok: false as const, status: 0, message: "Demo mode" },
      ]
    : await Promise.all([
        listVisits(
          `locationId=${locationId}&representativeUserId=${representativeUserId}&pageSize=50`,
        ),
        listTasks(`locationId=${locationId}&pageSize=50`),
      ]);

  const repVisits = visitsResult.ok ? visitsResult.data.items : [];
  const activeVisit = repVisits.find(
    (item) => item.status === "draft" || item.status === "in_progress",
  );
  const visitHistory = repVisits
    .filter(
      (item) => item.status === "completed" || item.status === "cancelled",
    )
    .sort((a, b) =>
      (b.completedAt ?? b.createdAt).localeCompare(
        a.completedAt ?? a.createdAt,
      ),
    );

  const openTasks = (tasksResult.ok ? tasksResult.data.items : []).filter(
    (item) => item.status === "open" || item.status === "in_progress",
  );

  const productsEnabled = sessionResult.ok
    ? sessionResult.data.productsEnabled
    : false;
  const skipLocationInsights = isDemoLocation || !productsEnabled;

  const [potentialResult, assortmentResult, categoriesResult, productsResult] =
    skipLocationInsights
      ? [
          { ok: false as const, status: 0, message: "Not available" },
          { ok: false as const, status: 0, message: "Not available" },
          { ok: false as const, status: 0, message: "Not available" },
          { ok: false as const, status: 0, message: "Not available" },
        ]
      : await Promise.all([
          listLocationPotential(locationId),
          listLocationAssortment(locationId),
          listProductCategories(),
          listAllProducts(),
        ]);

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
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      {error === "visit" ? (
        <DismissableNotice
          ariaLabel={t("location.visitErrorAria")}
          body={t("location.visitErrorBody")}
          clearParams={["error"]}
          eyebrow={t("location.visitErrorEyebrow")}
          title={t("location.visitErrorTitle")}
          tone="danger"
        />
      ) : null}

      {error === "route" ? (
        <DismissableNotice
          ariaLabel={t("location.routeErrorAria")}
          body={t("location.routeErrorBody")}
          clearParams={["error"]}
          eyebrow={t("location.routeErrorEyebrow")}
          title={t("location.routeErrorTitle")}
          tone="danger"
        />
      ) : null}

      {route === "visited" ? (
        <DismissableNotice
          ariaLabel={t("location.routeVisitedAria")}
          body={t("location.routeVisitedBody")}
          clearParams={["route"]}
          eyebrow={t("location.routeVisitedEyebrow")}
          title={t("location.routeVisitedTitle")}
          tone="success"
        />
      ) : null}

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
          body={tLocationInsights("savedBody")}
          clearParams={["locationInsights"]}
          eyebrow={t("flowEyebrow")}
          title={tLocationInsights("savedTitle")}
          tone="success"
        />
      ) : null}

      {isDemoLocation ? (
        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.demoMode")}</p>
            <h2>{tCommon("notice.backendNotConnected")}</h2>
            <p>{t("location.demoBody", { reason: sessionResult.message })}</p>
          </div>
        </section>
      ) : null}

      <div className="location-header panel">
        <div className="location-header-top">
          <a
            aria-label={t("location.backAria")}
            className="location-header-back"
            href={`/${tenantSlug}/field`}
          >
            ‹
          </a>
          <h1 className="location-header-title">{locationName}</h1>
        </div>
        <p className="location-header-address">{locationAddress}</p>
        <span className="location-header-rep">{representativeName}</span>
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

      {isDemoLocation ? (
        <a
          className="primary-button location-start-visit"
          href={`/${tenantSlug}/field/visits/demo-visit-${locationId}?demoLocationId=${encodeURIComponent(locationId)}&demoName=${encodeURIComponent(locationName)}&demoAddress=${encodeURIComponent(locationAddress)}`}
        >
          <span aria-hidden="true">▶</span> {t("location.startVisitDemo")}
        </a>
      ) : activeVisit ? (
        <a
          className="primary-button location-start-visit"
          href={`/${tenantSlug}/field/visits/${activeVisit.id}`}
        >
          <span aria-hidden="true">▶</span> {t("location.continueVisit")}
        </a>
      ) : stopAlreadyVisited ? (
        <p className="empty-state">{t("location.alreadyVisited")}</p>
      ) : (
        <form action={startVisitAction}>
          <input name="routeItemId" type="hidden" value={routeItemId ?? ""} />
          <PendingSubmitButton
            className="primary-button location-start-visit"
            pendingLabel={t("location.starting")}
          >
            <span aria-hidden="true">▶</span> {t("location.startVisit")}
          </PendingSubmitButton>
        </form>
      )}

      {!isDemoLocation &&
      routePlanId &&
      routeItemId &&
      !stopAlreadyVisited &&
      !activeVisit ? (
        <form action={markVisitedAction}>
          <input name="routePlanId" type="hidden" value={routePlanId} />
          <input name="routeItemId" type="hidden" value={routeItemId} />
          <PendingSubmitButton
            className="secondary-button"
            pendingLabel={tCommon("saving")}
          >
            {t("location.markVisited")}
          </PendingSubmitButton>
        </form>
      ) : null}

      <details className="panel location-feature">
        <summary className="location-feature-summary">
          <span className="location-feature-heading">
            <span className="location-feature-icon" aria-hidden="true">
              🗒️
            </span>
            <span className="location-feature-titles">
              <span className="location-feature-name">
                {t("location.openTasks")}
                <span className="location-feature-help" aria-hidden="true">
                  ?
                </span>
              </span>
              <span className="location-feature-meta">
                {t("location.taskCount", { count: openTasks.length })}
              </span>
            </span>
          </span>
          <span className="location-feature-actions">
            <span className="location-feature-chevron" aria-hidden="true">
              ›
            </span>
          </span>
        </summary>
        {openTasks.length > 0 ? (
          <div className="field-card-list">
            {openTasks.map((item: Task) => (
              <article className="location-mini-card" key={item.id}>
                <header>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.description ?? t("location.noTaskDetails")}</p>
                  </div>
                  <span
                    className={`status-pill ${statusPillTone(item.status)}`}
                  >
                    {formatEnumLabel(tCommon, item.status)}
                  </span>
                </header>
                <p className="form-hint">
                  {t("location.priorityDue", {
                    priority: formatEnumLabel(tCommon, item.priority),
                    due: formatDateTime(
                      format,
                      item.dueDate,
                      tCommon("notSet"),
                    ),
                  })}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">{t("location.noOpenTasks")}</p>
        )}
      </details>

      <details className="panel location-feature">
        <summary className="location-feature-summary">
          <span className="location-feature-heading">
            <span className="location-feature-icon" aria-hidden="true">
              📈
            </span>
            <span className="location-feature-titles">
              <span className="location-feature-name">
                {t("location.visitHistory")}
                <span className="location-feature-help" aria-hidden="true">
                  ?
                </span>
              </span>
              <span className="location-feature-meta">
                {t("location.visitCount", { count: visitHistory.length })}
              </span>
            </span>
          </span>
          <span className="location-feature-actions">
            <span className="location-feature-chevron" aria-hidden="true">
              ›
            </span>
          </span>
        </summary>
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
      </details>
    </AppShell>
  );
}
