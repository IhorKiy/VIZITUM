import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AnnouncementFeed } from "../../../components/announcement-feed";
import { AppShell } from "../../../components/app-shell";
import { DismissableNotice } from "../../../components/dismissable-notice";
import { PendingSubmitButton } from "../../../components/pending-submit-button";
import {
  addRouteItem,
  deleteRouteItem,
  getCurrentSession,
  listActiveAnnouncements,
  listLocations,
  listTodayRoutes,
  markAnnouncementRead,
  reorderRouteItems,
  updateRouteItem,
  type RoutePlan,
} from "../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../lib/demo-mode";
import { getFormString } from "../../../lib/form";
import { TodayRouteDragList } from "./today-route-drag-list";

type FieldPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    announcement?: string;
    report?: string;
    stop?: string;
  }>;
};

type FieldRouteStop = {
  id: string;
  routePlanId: string;
  locationId: string;
  name: string;
  address: string;
  chain: { id: string; name: string } | null;
  sequence: number;
  visited: boolean;
};

const demoRouteStops: FieldRouteStop[] = [
  {
    id: "demo-stop-1",
    routePlanId: "demo-plan-1",
    locationId: "demo-location-1",
    name: "Silpo Obolon",
    address: "Heroiv Dnipra Ave, Kyiv",
    chain: { id: "demo-chain-1", name: "Silpo" },
    sequence: 1,
    visited: true,
  },
  {
    id: "demo-stop-2",
    routePlanId: "demo-plan-1",
    locationId: "demo-location-2",
    name: "Pharmacy 24",
    address: "Lvivska St, Kyiv",
    chain: null,
    sequence: 2,
    visited: false,
  },
  {
    id: "demo-stop-3",
    routePlanId: "demo-plan-1",
    locationId: "demo-location-3",
    name: "Partner Hub",
    address: "Volodymyrska St, Kyiv",
    chain: null,
    sequence: 3,
    visited: false,
  },
];

export default async function FieldPage({
  params,
  searchParams,
}: FieldPageProps) {
  const { tenantSlug } = await params;
  const { announcement, report, stop } = await searchParams;
  // The add-stop affordance below reuses field.routes' strings rather than
  // duplicating them: it is the same "add a location to a route" action the
  // routes screen offers, and the two must not drift apart in wording.
  const [t, tRoutes, tCommon, format] = await Promise.all([
    getTranslations("field"),
    getTranslations("field.routes"),
    getTranslations("common"),
    getFormatter(),
  ]);

  const [sessionResult, routesResult, locationsResult, announcementsResult] =
    await Promise.all([
      getCurrentSession(),
      listTodayRoutes(),
      listLocations(),
      listActiveAnnouncements(),
    ]);
  const todayRoutesResult = sessionResult.ok
    ? routesResult
    : {
        ok: false as const,
        status: sessionResult.status,
        message: sessionResult.message,
      };
  const demoFallbackEnabled = isDemoFallbackEnabled();

  if (!todayRoutesResult.ok && !demoFallbackEnabled) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("flowEyebrow")}</p>
            <h1>{t("home.signedOutTitle")}</h1>
            <p>{t("home.signedOutBody")}</p>
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

        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{tCommon("notice.backendNotConnected")}</h2>
            <p>{todayRoutesResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const routeStops = todayRoutesResult.ok
    ? toRouteStops(todayRoutesResult.data)
    : demoRouteStops;
  const visitedStops = routeStops.filter((stop) => stop.visited).length;
  const isDemoMode = !todayRoutesResult.ok && demoFallbackEnabled;
  const firstName = sessionResult.ok
    ? (sessionResult.data.user.name.split(" ")[0] ??
      sessionResult.data.user.name)
    : t("home.guestName");

  // A rep manages their own plans (routes.manage_own); a team lead may manage
  // any. Without either, POST would only 403, so the affordance stays hidden.
  const canAddStop =
    sessionResult.ok &&
    (sessionResult.data.permissions.includes("routes.manage_own") ||
      sessionResult.data.permissions.includes("routes.manage_team"));
  // The new stop appends to the plan owning the last stop, so "add" continues
  // wherever today's list currently ends (today can hold more than one plan).
  const lastStop = routeStops[routeStops.length - 1];
  const locations = locationsResult.ok ? locationsResult.data.items : [];
  // Built from every item on today's plans, including the skipped ones that
  // toRouteStops drops from the visible list. A skipped stop still occupies
  // its location for today, and the backend does not dedupe by locationId, so
  // re-offering it would silently create a second item for the same location
  // in the same plan.
  const plannedLocationIds = new Set(
    todayRoutesResult.ok
      ? todayRoutesResult.data.flatMap((plan) =>
          plan.items.map((item) => item.locationId),
        )
      : routeStops.map((routeStop) => routeStop.locationId),
  );
  const availableLocations = locations.filter(
    (location) => !plannedLocationIds.has(location.id),
  );
  // A failed announcements fetch leaves the board empty rather than taking the
  // whole home screen down: the route is the thing the rep came here for, and
  // it is already loaded.
  //
  // Only the unread ones surface here. An acknowledged notice has already done
  // its job, and a folded "already read (N)" row on top of the day's route is
  // still a row: the full board — read included — lives one tap away on
  // /field/announcements, off the field menu.
  const unreadAnnouncements = (
    announcementsResult.ok ? announcementsResult.data.items : []
  ).filter((announcement) => !announcement.isRead);

  // Called directly from the client-side drag list (not a <form> submit)
  // once a drag or arrow-key move settles on a new order — see
  // today-route-drag-list.tsx. No success notice: the drag itself is
  // already the feedback, and there's nowhere useful to send the rep on
  // failure other than back to the same page.
  async function reorderTodayRouteAction(
    routePlanId: string,
    itemIds: string[],
  ) {
    "use server";

    if (routePlanId && itemIds.length > 0) {
      await reorderRouteItems(routePlanId, itemIds);
    }

    redirect(`/${tenantSlug}/field`);
  }

  // Appends a location to today's route. The plan's items are re-read here
  // instead of trusting the rendered page, so the sequence stays correct even
  // if the route changed since this page was rendered.
  //
  // Every exit reports an outcome. Unlike the reorder above — where the drag
  // itself is the feedback — a failed add leaves the list looking untouched,
  // so a silent bounce would read as "nothing happened". The backend raises a
  // deliberate 409 (ROUTE_ITEM_SEQUENCE_TAKEN) when a concurrent edit claims
  // the same slot, precisely so the client can say so.
  async function addTodayStopAction(formData: FormData) {
    "use server";

    const routePlanId = getFormString(formData, "routePlanId").trim();
    const locationId = getFormString(formData, "locationId").trim();

    if (!routePlanId || !locationId) {
      redirect(`/${tenantSlug}/field?stop=failed`);
    }

    const plansResult = await listTodayRoutes();
    const plan = plansResult.ok
      ? plansResult.data.find((item) => item.id === routePlanId)
      : undefined;

    if (!plan) {
      redirect(`/${tenantSlug}/field?stop=failed`);
    }

    const nextSequence = plan.items.length
      ? Math.max(...plan.items.map((item) => item.sequence)) + 1
      : 1;

    const result = await addRouteItem(routePlanId, {
      locationId,
      sequence: nextSequence,
    });

    redirect(`/${tenantSlug}/field?stop=${result.ok ? "added" : "failed"}`);
  }

  // Swipe actions on a route stop (field home, mobile). Both take the stop's
  // routePlanId + routeItemId from the swiped row's hidden inputs and report
  // an outcome via the ?stop notice, matching addTodayStopAction.
  async function markStopVisitedAction(formData: FormData) {
    "use server";

    const routePlanId = getFormString(formData, "routePlanId").trim();
    const routeItemId = getFormString(formData, "routeItemId").trim();

    if (!routePlanId || !routeItemId) {
      redirect(`/${tenantSlug}/field?stop=failed`);
    }

    const result = await updateRouteItem(routePlanId, routeItemId, {
      status: "visited",
    });

    redirect(`/${tenantSlug}/field?stop=${result.ok ? "visited" : "failed"}`);
  }

  async function removeStopAction(formData: FormData) {
    "use server";

    const routePlanId = getFormString(formData, "routePlanId").trim();
    const routeItemId = getFormString(formData, "routeItemId").trim();

    if (!routePlanId || !routeItemId) {
      redirect(`/${tenantSlug}/field?stop=failed`);
    }

    const result = await deleteRouteItem(routePlanId, routeItemId);

    redirect(`/${tenantSlug}/field?stop=${result.ok ? "removed" : "failed"}`);
  }

  // Acknowledging a notice. No success notice of its own: the card visibly
  // moves into the "already read" disclosure, which is the feedback. A failure
  // does say so, because the card looks untouched either way.
  async function markAnnouncementReadAction(formData: FormData) {
    "use server";

    const announcementId = getFormString(formData, "announcementId").trim();

    if (!announcementId) {
      redirect(`/${tenantSlug}/field?announcement=failed`);
    }

    const result = await markAnnouncementRead(announcementId);

    redirect(`/${tenantSlug}/field${result.ok ? "" : "?announcement=failed"}`);
  }

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      <header className="page-header greeting-header">
        <div>
          <h1>{t("home.greeting", { firstName })}</h1>
          <p className="greeting-date">{formatGreetingDate(format)}</p>
        </div>
      </header>

      {report === "confirmed" ? (
        <DismissableNotice
          ariaLabel={t("home.reportStatusAria")}
          clearParams={["report"]}
          eyebrow={t("home.reportConfirmedEyebrow")}
          title={t("home.reportConfirmedTitle")}
          tone="success"
        />
      ) : null}

      {stop === "added" ? (
        <DismissableNotice
          ariaLabel={t("home.stopStatusAria")}
          clearParams={["stop"]}
          compact
          title={t("home.stopAddedTitle")}
          tone="success"
        />
      ) : null}

      {stop === "visited" ? (
        <DismissableNotice
          ariaLabel={t("home.stopStatusAria")}
          clearParams={["stop"]}
          compact
          title={t("home.stopVisitedTitle")}
          tone="success"
        />
      ) : null}

      {stop === "removed" ? (
        <DismissableNotice
          ariaLabel={t("home.stopStatusAria")}
          clearParams={["stop"]}
          compact
          title={t("home.stopRemovedTitle")}
          tone="success"
        />
      ) : null}

      {stop === "failed" ? (
        <DismissableNotice
          ariaLabel={t("home.stopStatusAria")}
          body={t("home.stopFailedBody")}
          clearParams={["stop"]}
          eyebrow={t("flowEyebrow")}
          title={t("home.stopFailedTitle")}
          tone="danger"
        />
      ) : null}

      {isDemoMode ? (
        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.demoMode")}</p>
            <h2>{tCommon("notice.backendNotConnected")}</h2>
            <p>{t("home.demoBody", { reason: todayRoutesResult.message })}</p>
          </div>
        </section>
      ) : null}

      {announcement === "failed" ? (
        <DismissableNotice
          ariaLabel={t("announcements.sectionAria")}
          body={t("announcements.markFailedBody")}
          clearParams={["announcement"]}
          title={t("announcements.markFailedTitle")}
          tone="danger"
        />
      ) : null}

      {/* Above the route on purpose: what is in force this month frames the
          day's visits, so it has to be read before the first stop, not after
          scrolling past it. Renders nothing once everything is acknowledged —
          see unreadAnnouncements above. */}
      <AnnouncementFeed
        announcements={unreadAnnouncements}
        markReadAction={markAnnouncementReadAction}
      />

      <section className="route-section" aria-label={t("home.todayRouteAria")}>
        {routeStops.length > 0 ? (
          <>
            <article className="route-progress-card">
              <div className="route-progress-head">
                <span>{t("home.progressToday")}</span>
                <span className="route-progress-count">
                  {visitedStops}/{routeStops.length}
                </span>
              </div>
              <div
                className="route-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={routeStops.length}
                aria-valuenow={visitedStops}
              >
                <div
                  className="route-progress-fill"
                  style={{
                    width: `${Math.round(
                      (visitedStops / routeStops.length) * 100,
                    )}%`,
                  }}
                />
              </div>
              <div className="route-progress-legend">
                <span>{t("home.visitedCount", { count: visitedStops })}</span>
                {routeStops.length - visitedStops > 0 ? (
                  <span>
                    {t("home.remainingCount", {
                      count: routeStops.length - visitedStops,
                    })}
                  </span>
                ) : (
                  <span>{t("home.allVisited")}</span>
                )}
              </div>
            </article>

            <div className="route-plan-card">
              <div className="route-plan-head">
                <span className="route-plan-icon" aria-hidden="true">
                  ⇄
                </span>
                <div className="route-plan-heading">
                  <p className="route-plan-name">{t("home.todayRoute")}</p>
                  <a
                    className="route-plan-link"
                    href={`/${tenantSlug}/field/planning`}
                  >
                    {t("home.editPlan")}
                  </a>
                </div>
              </div>

              <TodayRouteDragList
                isDemoMode={isDemoMode}
                markVisitedAction={markStopVisitedAction}
                removeAction={removeStopAction}
                reorderAction={reorderTodayRouteAction}
                stops={routeStops}
                tenantSlug={tenantSlug}
              />

              {/* Demo stops carry fabricated plan ids, so the write path is
                  only offered against a real route. */}
              {canAddStop && !isDemoMode && lastStop ? (
                <details className="route-add-stop today-add-stop">
                  <summary className="route-add-stop-trigger">
                    <span aria-hidden="true">+</span> {tRoutes("addStop")}
                  </summary>
                  {availableLocations.length > 0 ? (
                    <form
                      action={addTodayStopAction}
                      className="visit-form compact"
                    >
                      <input
                        name="routePlanId"
                        type="hidden"
                        value={lastStop.routePlanId}
                      />
                      <label>
                        {tRoutes("locationLabel")}
                        <select name="locationId" required>
                          {availableLocations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name}
                              {location.city ? ` · ${location.city}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <PendingSubmitButton
                        className="primary-button"
                        pendingLabel={tRoutes("adding")}
                      >
                        {tRoutes("addToRoute")}
                      </PendingSubmitButton>
                    </form>
                  ) : (
                    <p className="empty-state">
                      {locations.length === 0
                        ? tRoutes("noLocations")
                        : tRoutes("allLocationsUsed")}
                    </p>
                  )}
                </details>
              ) : null}
            </div>
          </>
        ) : (
          <div className="route-empty">
            <p className="route-empty-title">{t("home.emptyTitle")}</p>
            <p className="route-empty-text">{t("home.emptyBody")}</p>
            <a
              className="route-plan-link"
              href={`/${tenantSlug}/field/planning`}
            >
              {t("home.goToPlanning")}
            </a>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function toRouteStops(plans: RoutePlan[]): FieldRouteStop[] {
  return plans
    .flatMap((plan) =>
      plan.items
        .filter((item) => item.status !== "skipped")
        .map((item) => ({
          id: item.id,
          routePlanId: plan.id,
          locationId: item.locationId,
          name: item.location.name,
          address: [item.location.addressLine, item.location.city]
            .filter(Boolean)
            .join(", "),
          chain: item.location.chain,
          sequence: item.sequence,
          visited: item.status === "visited",
        })),
    )
    .sort((a, b) => a.sequence - b.sequence);
}

function formatGreetingDate(
  format: Awaited<ReturnType<typeof getFormatter>>,
): string {
  const formatted = format.dateTime(new Date(), {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });

  return formatted
    ? `${formatted[0].toUpperCase()}${formatted.slice(1)}`
    : formatted;
}
