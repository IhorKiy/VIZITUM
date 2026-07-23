import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../components/app-shell";
import { DismissableNotice } from "../../../components/dismissable-notice";
import { PendingSubmitButton } from "../../../components/pending-submit-button";
import {
  addRouteItem,
  getCurrentSession,
  listLocations,
  listTodayRoutes,
  reorderRouteItems,
  type RoutePlan,
} from "../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../lib/demo-mode";
import { getFormString } from "../../../lib/form";
import { TodayRouteDragList } from "./today-route-drag-list";

type FieldPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    report?: string;
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
  const { report } = await searchParams;
  // The add-stop affordance below reuses field.planning's strings rather than
  // duplicating them: it is the same "add a location to a route" action the
  // planning screen offers, and the two must not drift apart in wording.
  const [t, tPlanning, tCommon, format] = await Promise.all([
    getTranslations("field"),
    getTranslations("field.planning"),
    getTranslations("common"),
    getFormatter(),
  ]);

  const [sessionResult, routesResult, locationsResult] = await Promise.all([
    getCurrentSession(),
    listTodayRoutes(),
    listLocations(),
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
  const plannedLocationIds = new Set(routeStops.map((stop) => stop.locationId));
  const availableLocations = locations.filter(
    (location) => !plannedLocationIds.has(location.id),
  );

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
  async function addTodayStopAction(formData: FormData) {
    "use server";

    const routePlanId = getFormString(formData, "routePlanId").trim();
    const locationId = getFormString(formData, "locationId").trim();

    if (routePlanId && locationId) {
      const plansResult = await listTodayRoutes();
      const plan = plansResult.ok
        ? plansResult.data.find((item) => item.id === routePlanId)
        : undefined;

      if (plan) {
        const nextSequence = plan.items.length
          ? Math.max(...plan.items.map((item) => item.sequence)) + 1
          : 1;

        await addRouteItem(routePlanId, { locationId, sequence: nextSequence });
      }
    }

    redirect(`/${tenantSlug}/field`);
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
          body={t("home.reportConfirmedBody")}
          clearParams={["report"]}
          eyebrow={t("home.reportConfirmedEyebrow")}
          title={t("home.reportConfirmedTitle")}
          tone="success"
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
                reorderAction={reorderTodayRouteAction}
                stops={routeStops}
                tenantSlug={tenantSlug}
              />

              {/* Demo stops carry fabricated plan ids, so the write path is
                  only offered against a real route. */}
              {canAddStop && !isDemoMode && lastStop ? (
                <details className="route-add-stop today-add-stop">
                  <summary className="route-add-stop-trigger">
                    <span aria-hidden="true">+</span> {tPlanning("addStop")}
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
                        {tPlanning("locationLabel")}
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
                        pendingLabel={tPlanning("adding")}
                      >
                        {tPlanning("addToRoute")}
                      </PendingSubmitButton>
                    </form>
                  ) : (
                    <p className="empty-state">
                      {locations.length === 0
                        ? tPlanning("noLocations")
                        : tPlanning("allLocationsUsed")}
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
