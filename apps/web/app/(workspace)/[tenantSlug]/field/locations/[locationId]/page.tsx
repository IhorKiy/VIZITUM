import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../../components/app-shell";
import { BackLink } from "../../../../../../components/back-link";
import { CancelVisitModal } from "../../../../../../components/cancel-visit-modal";
import { DismissableNotice } from "../../../../../../components/dismissable-notice";
import {
  ActivityIcon,
  BanknoteIcon,
  ListTodoIcon,
  MapPinIcon,
  PackageIcon,
} from "../../../../../../components/icons";
import { LocationAssignmentPill } from "../../../../../../components/location-assignment-pill";
import { LocationContactsModal } from "../../../../../../components/location-contacts-modal";
import { LocationNotesModal } from "../../../../../../components/location-notes-modal";
import { PendingSubmitButton } from "../../../../../../components/pending-submit-button";
import { StartVisitControl } from "../../../../../../components/start-visit-control";
import {
  getCurrentSession,
  getLocation,
  listLocationAssortment,
  listLocationPotential,
  listTasks,
  listVisits,
  updateRouteItem,
  type Task,
} from "../../../../../../lib/api-client";
import {
  backOrigin,
  resolveBackTarget,
  withBackOrigin,
} from "../../../../../../lib/back-navigation";
import { cancelVisitAction } from "../../../../../../lib/cancel-visit-actions";
import { isDemoFallbackEnabled } from "../../../../../../lib/demo-mode";
import { formatDateTime } from "../../../../../../lib/format";
import { getFormString } from "../../../../../../lib/form";
import {
  deleteLocationContactAction,
  upsertLocationContactAction,
  upsertLocationNotesAction,
} from "../../../../../../lib/location-header-actions";
import { resolveLocationKeeper } from "../../../../../../lib/location-keeper";
import { isTaskUnfinished } from "../../../../../../lib/task-status";
import { resolveTenantLocale } from "../../../../../../lib/tenant-locale";

type LocationDetailPageProps = {
  params: Promise<{ tenantSlug: string; locationId: string }>;
  searchParams: Promise<{
    routePlanId?: string;
    routeItemId?: string;
    visited?: string;
    route?: string;
    error?: string;
    locationInsights?: string;
    cancelled?: string;
    demoName?: string;
    demoAddress?: string;
    from?: string;
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
    cancelled,
    demoName,
    demoAddress,
    from,
  } = await searchParams;
  const stopAlreadyVisited = visited === "1";
  const [t, tBack, tCommon, tLocationInsights, format] = await Promise.all([
    getTranslations("field"),
    getTranslations("common.back"),
    getTranslations("common"),
    getTranslations("common.locationInsights"),
    getFormatter(),
  ]);

  // This card opens from today's route, the locations list and the route
  // editor, so where "back" goes is whatever the opener said — today's route
  // only as the deep-link fallback.
  const backTarget = resolveBackTarget(tenantSlug, from, {
    href: `/${tenantSlug}/field`,
    labelKey: "home",
  });
  // The card's own identity: the route-stop context it was opened on plus the
  // screen it was opened from. Every redirect back to this card replays it, so
  // adding a note or marking a stop visited doesn't quietly reset the back
  // control to today's route.
  const selfPath = `/field/locations/${locationId}`;
  const selfState = { routePlanId, routeItemId, visited, from };
  // What this card hands to the screens it opens (visit report, potential,
  // assortment, visit history) so their back control returns here, on the same
  // route stop and still carrying where *this* card was opened from.
  const selfOrigin = backOrigin(selfPath, selfState);

  async function markVisitedAction(formData: FormData) {
    "use server";

    const formRoutePlanId = getFormString(formData, "routePlanId").trim();
    const formRouteItemId = getFormString(formData, "routeItemId").trim();

    if (!formRoutePlanId || !formRouteItemId) {
      redirect(
        `/${tenantSlug}${backOrigin(selfPath, { ...selfState, error: "route" })}`,
      );
    }

    const result = await updateRouteItem(formRoutePlanId, formRouteItemId, {
      status: "visited",
    });

    if (!result.ok) {
      redirect(
        `/${tenantSlug}${backOrigin(selfPath, { ...selfState, error: "route" })}`,
      );
    }

    redirect(
      `/${tenantSlug}${backOrigin(selfPath, {
        from,
        route: "visited",
        routePlanId: formRoutePlanId,
        routeItemId: formRouteItemId,
        visited: "1",
      })}`,
    );
  }

  // Potential/assortment now live on their own routes; the note and contacts
  // actions still redirect back to this card. routePlanId/routeItemId ride
  // along so a route-stop context survives the redirect, matching how the
  // admin detail screen omits them; `from` rides along for the same reason,
  // so the back control still points at the opener afterwards.
  const basePath = `/${tenantSlug}/field/locations/${locationId}`;
  const extraParams: [string, string][] = [];
  if (routePlanId) {
    extraParams.push(["routePlanId", routePlanId]);
  }
  if (routeItemId) {
    extraParams.push(["routeItemId", routeItemId]);
  }
  if (visited) {
    extraParams.push(["visited", visited]);
  }
  if (from) {
    extraParams.push(["from", from]);
  }
  // The cancel redirect deliberately drops routePlanId/routeItemId: the
  // cancelled visit keeps the stop's unique visit slot and the stop itself is
  // now skipped, so the card must come back in its plain "start an unlinked
  // visit" state instead of offering to reuse the occupied slot.
  const cancelExtraParams: [string, string][] = [];
  if (visited) {
    cancelExtraParams.push(["visited", visited]);
  }
  if (from) {
    cancelExtraParams.push(["from", from]);
  }
  // Where StartVisitControl sends the rep on a genuine rejection — the exact
  // href the old server-action redirect used, so that already-rare path looks
  // unchanged.
  const startErrorHref = `/${tenantSlug}${backOrigin(selfPath, { ...selfState, error: "visit" })}`;
  // The sub-pages get this card as their origin rather than a copy of its
  // params: their back control resolves it the same way every other screen
  // does, so the whole chain unwinds one screen at a time.
  const insightsSuffix = `?from=${encodeURIComponent(selfOrigin)}`;
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

  const [sessionResult, locationResult, { phoneCountry }] = await Promise.all([
    getCurrentSession(),
    getLocation(locationId),
    resolveTenantLocale(tenantSlug),
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
        <BackLink href={backTarget.href} label={tBack(backTarget.labelKey)} />
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("flowEyebrow")}</p>
            <h1>{t("location.notFoundTitle")}</h1>
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
  // Demo mode has no location behind it, so there is nothing to resolve and
  // the pill renders nothing.
  const keeper = resolveLocationKeeper(
    locationResult.ok ? locationResult.data.assignments : [],
    representativeUserId,
  );

  // pageSize=50 is the API's max page size — the visit-history icon badge and
  // the dedicated history page deliberately reflect only the 50 most recent
  // visits, which is plenty for a single rep at a single location.
  const visitsQuery = new URLSearchParams({
    locationId,
    representativeUserId: representativeUserId ?? "",
    pageSize: "50",
  }).toString();
  const [visitsResult, tasksResult] = isDemoLocation
    ? [
        { ok: false as const, status: 0, message: "Demo mode" },
        { ok: false as const, status: 0, message: "Demo mode" },
      ]
    : await Promise.all([
        listVisits(visitsQuery),
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
          clearParams={["route"]}
          eyebrow={t("location.routeVisitedEyebrow")}
          title={t("location.routeVisitedTitle")}
          tone="success"
        />
      ) : null}

      {cancelled === "1" ? (
        <DismissableNotice
          ariaLabel={t("location.visitCancelledAria")}
          body={t("location.visitCancelledBody")}
          clearParams={["cancelled"]}
          eyebrow={t("location.visitCancelledEyebrow")}
          title={t("location.visitCancelledTitle")}
          tone="success"
        />
      ) : null}

      {error === "cancelVisit" ? (
        <DismissableNotice
          ariaLabel={t("location.cancelVisitErrorAria")}
          body={t("location.cancelVisitErrorBody")}
          clearParams={["error"]}
          eyebrow={t("location.cancelVisitErrorEyebrow")}
          title={t("location.cancelVisitErrorTitle")}
          tone="danger"
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
        <BackLink
          href={backTarget.href}
          inline
          label={tBack(backTarget.labelKey)}
        />
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
              <LocationAssignmentPill keeper={keeper} />
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
                keeper={keeper}
                locationName={locationName}
                phoneCountry={phoneCountry}
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
              href={withBackOrigin(
                `/${tenantSlug}/field/visits/demo-visit-${locationId}?demoLocationId=${encodeURIComponent(locationId)}&demoName=${encodeURIComponent(locationName)}&demoAddress=${encodeURIComponent(locationAddress)}`,
                selfOrigin,
              )}
            >
              <span aria-hidden="true">▶</span> {t("location.startVisitDemo")}
            </a>
          ) : !activeVisit && isArchivedLocation ? (
            <p className="empty-state">{t("location.archivedNoVisit")}</p>
          ) : (
            <>
              <StartVisitControl
                activeVisit={activeVisit ? { id: activeVisit.id } : null}
                errorHref={startErrorHref}
                locationId={locationId}
                repeat={stopAlreadyVisited}
                // No routeItemId for a repeat visit: a route item can carry
                // only one visit (visits.routeItemId is unique), so a repeat
                // visit on an already-visited stop is created without a
                // route-item link.
                routeItemId={stopAlreadyVisited ? null : routeItemId || null}
                selfOrigin={selfOrigin}
                tenantSlug={tenantSlug}
                userId={representativeUserId ?? ""}
              />
              {activeVisit &&
              sessionResult.ok &&
              sessionResult.data.permissions.includes("visits.cancel_own") ? (
                <CancelVisitModal
                  action={cancelVisitAction.bind(
                    null,
                    basePath,
                    activeVisit.id,
                    cancelExtraParams,
                  )}
                  locationName={locationName}
                  tenantSlug={tenantSlug}
                  userId={sessionResult.data.user.id}
                  visitId={activeVisit.id}
                />
              ) : null}
            </>
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

        <section className="panel location-feature">
          <div className="location-feature-page-head">
            <span className="location-feature-heading">
              <span className="location-feature-icon" aria-hidden="true">
                <ListTodoIcon size={20} />
              </span>
              <span className="location-feature-titles">
                <span className="location-feature-name">
                  {t("location.openTasks")}
                </span>
                <span className="location-feature-meta">
                  {t("location.taskCount", { count: openTasks.length })}
                </span>
              </span>
            </span>
          </div>
          {openTasks.length > 0 ? (
            <div className="field-card-list">
              {openTasks.map((item: Task) => (
                <a
                  className="location-mini-card location-mini-card-link"
                  // Carries this card's origin, so tapping back from the task
                  // list returns the rep to the outlet they were working
                  // rather than to the field home (audit F17). `selfOrigin` is
                  // the same value the card's other outgoing links use.
                  href={withBackOrigin(
                    `/${tenantSlug}/field/tasks#task-${item.id}`,
                    selfOrigin,
                  )}
                  key={item.id}
                >
                  <header>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.description ?? t("location.noTaskDetails")}</p>
                    </div>
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
                </a>
              ))}
            </div>
          ) : (
            <p className="empty-state">{t("location.noOpenTasks")}</p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
