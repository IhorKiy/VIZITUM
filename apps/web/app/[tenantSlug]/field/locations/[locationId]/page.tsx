import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import {
  ActivityIcon,
  ArrowLeftIcon,
  BanknoteIcon,
  ListTodoIcon,
  MapPinIcon,
  PackageIcon,
} from "../../../../../components/icons";
import { LocationContactsModal } from "../../../../../components/location-contacts-modal";
import { LocationNotesModal } from "../../../../../components/location-notes-modal";
import { PendingSubmitButton } from "../../../../../components/pending-submit-button";
import {
  createVisit,
  getCurrentSession,
  getLocation,
  listLocationAssortment,
  listLocationPotential,
  listTasks,
  listVisits,
  updateRouteItem,
  type Task,
} from "../../../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../../../lib/demo-mode";
import {
  formatDateTime,
  formatEnumLabel,
  statusPillTone,
} from "../../../../../lib/format";
import { getFormString } from "../../../../../lib/form";
import {
  deleteLocationContactAction,
  upsertLocationContactAction,
  upsertLocationNotesAction,
} from "../../../../../lib/location-header-actions";
import { isTaskUnfinished } from "../../../../../lib/task-status";

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

  // Potential/assortment now live on their own routes; the note and contacts
  // actions still redirect back to this card. routePlanId/routeItemId ride
  // along so a route-stop context survives the redirect (and the links to the
  // sub-pages), matching how the admin detail screen omits them.
  const basePath = `/${tenantSlug}/field/locations/${locationId}`;
  const extraParams: [string, string][] = [];
  if (routePlanId) {
    extraParams.push(["routePlanId", routePlanId]);
  }
  if (routeItemId) {
    extraParams.push(["routeItemId", routeItemId]);
  }
  const insightsQuery = new URLSearchParams(extraParams).toString();
  const insightsSuffix = insightsQuery ? `?${insightsQuery}` : "";
  const upsertNotesAction = upsertLocationNotesAction.bind(
    null,
    basePath,
    locationId,
    extraParams,
  );
  const upsertContactAction = upsertLocationContactAction.bind(
    null,
    basePath,
    locationId,
    extraParams,
  );
  const deleteContactAction = deleteLocationContactAction.bind(
    null,
    basePath,
    locationId,
    extraParams,
  );

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
  // GET /locations/:id stays reachable for an archived location (unlike the
  // insights endpoints below), so a field rep with a stale assignment to a
  // since-archived location lands here instead of on "not found" — treat it
  // the same way the admin detail screen does: skip the insights calls and
  // the "start visit" CTA rather than offering actions that can only fail.
  const isArchivedLocation = locationResult.ok && locationResult.data.archived;
  const chainName = locationResult.ok
    ? locationResult.data.chain?.name
    : undefined;
  const contacts = locationResult.ok ? locationResult.data.contacts : [];
  const locationNotes = locationResult.ok ? locationResult.data.notes : null;
  const canManageNotes = locationResult.ok
    ? (locationResult.data.canManageNotes ?? false)
    : false;
  const canManageContacts = locationResult.ok
    ? (locationResult.data.canManageContacts ?? false)
    : false;

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
    (item) => isTaskUnfinished(item.status),
  );

  const productsEnabled = sessionResult.ok
    ? sessionResult.data.productsEnabled
    : false;
  const skipLocationInsights =
    isDemoLocation || !productsEnabled || isArchivedLocation;

  // Only the counts are needed here — the full potential/assortment data (and
  // its add/edit modals) lives on the dedicated /potential and /assortment
  // sub-pages the header icons link to.
  const [potentialResult, assortmentResult] = skipLocationInsights
    ? [
        { ok: false as const, status: 0, message: "Not available" },
        { ok: false as const, status: 0, message: "Not available" },
      ]
    : await Promise.all([
        listLocationPotential(locationId),
        listLocationAssortment(locationId),
      ]);

  const potentialCount = potentialResult.ok
    ? potentialResult.data.items.length
    : 0;
  const assortmentCount = assortmentResult.ok
    ? assortmentResult.data.items.length
    : 0;

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
          clearParams={["locationInsights"]}
          compact
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

      <div className="location-detail-sections">
        <a
          aria-label={t("location.backAria")}
          className="location-back"
          href={`/${tenantSlug}/field`}
        >
          <ArrowLeftIcon size={20} />
        </a>
        <div className="panel location-header">
          <div className="location-header-summary">
            <div className="location-header-identity">
              <span className="location-header-icon-lead" aria-hidden="true">
                <MapPinIcon size={44} />
              </span>
              <h1 className="location-header-title">{locationName}</h1>
              <p className="location-header-address">{locationAddress}</p>
              <span className="location-header-chain">
                {chainName ?? t("location.chainNone")}
              </span>
            </div>
          </div>
          <div className="location-header-actions">
            <div className="location-header-actions-group">
              <LocationNotesModal
                action={upsertNotesAction}
                canManage={canManageNotes}
                locationName={locationName}
                notes={locationNotes}
              />
              <LocationContactsModal
                canManage={canManageContacts}
                deleteAction={deleteContactAction}
                locationName={locationName}
                rows={contacts}
                upsertAction={upsertContactAction}
              />
            </div>
            {!isDemoLocation ? (
              <div className="location-header-actions-group">
                {productsEnabled && !isArchivedLocation ? (
                  <>
                    <a
                      aria-label={tLocationInsights("potentialTitle")}
                      className="icon-button location-header-icon"
                      href={`${basePath}/potential${insightsSuffix}`}
                    >
                      <BanknoteIcon size={20} />
                      {potentialCount > 0 ? (
                        <span className="location-header-icon-badge">
                          {potentialCount}
                        </span>
                      ) : null}
                    </a>
                    <a
                      aria-label={tLocationInsights("assortmentTitle")}
                      className="icon-button location-header-icon"
                      href={`${basePath}/assortment${insightsSuffix}`}
                    >
                      <PackageIcon size={20} />
                      {assortmentCount > 0 ? (
                        <span className="location-header-icon-badge">
                          {assortmentCount}
                        </span>
                      ) : null}
                    </a>
                  </>
                ) : null}
                <a
                  aria-label={t("location.visitHistory")}
                  className="icon-button location-header-icon"
                  href={`${basePath}/history${insightsSuffix}`}
                >
                  <ActivityIcon size={20} />
                  {visitHistory.length > 0 ? (
                    <span className="location-header-icon-badge">
                      {visitHistory.length}
                    </span>
                  ) : null}
                </a>
              </div>
            ) : null}
          </div>
        </div>

        {productsEnabled && isArchivedLocation ? (
          <section
            aria-label={tLocationInsights("archivedAria")}
            className="notice-panel"
          >
            <div>
              <p className="eyebrow">{t("flowEyebrow")}</p>
              <h2>{tLocationInsights("archivedTitle")}</h2>
              <p>{tLocationInsights("archivedBody")}</p>
            </div>
          </section>
        ) : null}

        <div className="location-actions">
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
          ) : isArchivedLocation ? (
            <p className="empty-state">{t("location.archivedNoVisit")}</p>
          ) : (
            <form action={startVisitAction}>
              <input
                name="routeItemId"
                type="hidden"
                value={routeItemId ?? ""}
              />
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
        </div>

        <details className="panel location-feature">
          <summary className="location-feature-summary">
            <span className="location-feature-heading">
              <span className="location-feature-icon" aria-hidden="true">
                <ListTodoIcon size={20} />
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
                    {item.isPriority ? (
                      <>
                        <span className="priority-tag">
                          {t("tasks.priority")}
                        </span>
                        {" · "}
                      </>
                    ) : null}
                    {t("tasks.due")}{" "}
                    {formatDateTime(format, item.dueDate, tCommon("notSet"))}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">{t("location.noOpenTasks")}</p>
          )}
        </details>
      </div>
    </AppShell>
  );
}
