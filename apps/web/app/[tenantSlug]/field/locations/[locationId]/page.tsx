import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { PendingSubmitButton } from "../../../../../components/pending-submit-button";
import {
  createVisit,
  getCurrentSession,
  getLocation,
  listTasks,
  listVisits,
  updateRouteItem,
  type Task,
  type Visit,
} from "../../../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../../../lib/demo-mode";
import {
  formatDateTime,
  formatEnumLabel,
  statusPillTone,
} from "../../../../../lib/format";
import { getFormString } from "../../../../../lib/form";

type LocationDetailPageProps = {
  params: Promise<{ tenantSlug: string; locationId: string }>;
  searchParams: Promise<{
    routePlanId?: string;
    routeItemId?: string;
    visited?: string;
    route?: string;
    error?: string;
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
    demoName,
    demoAddress,
  } = await searchParams;
  const stopAlreadyVisited = visited === "1";
  const [t, tCommon, format] = await Promise.all([
    getTranslations("field"),
    getTranslations("common"),
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

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      {error === "visit" ? (
        <section
          className="notice-panel danger"
          aria-label={t("location.visitErrorAria")}
        >
          <div>
            <p className="eyebrow">{t("location.visitErrorEyebrow")}</p>
            <h2>{t("location.visitErrorTitle")}</h2>
            <p>{t("location.visitErrorBody")}</p>
          </div>
        </section>
      ) : null}

      {error === "route" ? (
        <section
          className="notice-panel danger"
          aria-label={t("location.routeErrorAria")}
        >
          <div>
            <p className="eyebrow">{t("location.routeErrorEyebrow")}</p>
            <h2>{t("location.routeErrorTitle")}</h2>
            <p>{t("location.routeErrorBody")}</p>
          </div>
        </section>
      ) : null}

      {route === "visited" ? (
        <section
          className="notice-panel success"
          aria-label={t("location.routeVisitedAria")}
        >
          <div>
            <p className="eyebrow">{t("location.routeVisitedEyebrow")}</p>
            <h2>{t("location.routeVisitedTitle")}</h2>
            <p>{t("location.routeVisitedBody")}</p>
          </div>
        </section>
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

      <div className="location-feature-wrap">
        <details className="panel location-feature">
          <summary className="location-feature-summary">
            <span className="location-feature-heading">
              <span className="location-feature-icon" aria-hidden="true">
                💰
              </span>
              <span className="location-feature-titles">
                <span className="location-feature-name">
                  {t("location.potential")}
                  <span className="location-feature-help" aria-hidden="true">
                    ?
                  </span>
                </span>
                <span className="location-feature-meta">
                  {t("location.productGroupCount", { count: 0 })}
                </span>
              </span>
            </span>
            <span className="location-feature-actions">
              <span className="location-feature-chevron" aria-hidden="true">
                ›
              </span>
            </span>
          </summary>
          <p className="empty-state">{t("location.potentialEmpty")}</p>
        </details>
        <button
          aria-label={t("location.addProductGroupAria")}
          className="location-feature-add"
          disabled
          type="button"
        >
          +
        </button>
      </div>

      <div className="location-feature-wrap">
        <details className="panel location-feature">
          <summary className="location-feature-summary">
            <span className="location-feature-heading">
              <span className="location-feature-icon" aria-hidden="true">
                📦
              </span>
              <span className="location-feature-titles">
                <span className="location-feature-name">
                  {t("location.assortment")}
                  <span className="location-feature-help" aria-hidden="true">
                    ?
                  </span>
                </span>
                <span className="location-feature-meta">
                  {t("location.assortmentItemCount", { count: 0 })}
                </span>
              </span>
            </span>
            <span className="location-feature-actions">
              <span className="location-feature-chevron" aria-hidden="true">
                ›
              </span>
            </span>
          </summary>
          <p className="empty-state">{t("location.assortmentEmpty")}</p>
        </details>
        <button
          aria-label={t("location.addAssortmentAria")}
          className="location-feature-add"
          disabled
          type="button"
        >
          +
        </button>
      </div>

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
