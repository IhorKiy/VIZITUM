import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../components/app-shell";
import { DismissableNotice } from "../../../components/dismissable-notice";
import {
  getCurrentSession,
  listTodayRoutes,
  type RoutePlan,
} from "../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../lib/demo-mode";

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
    sequence: 1,
    visited: true,
  },
  {
    id: "demo-stop-2",
    routePlanId: "demo-plan-1",
    locationId: "demo-location-2",
    name: "Pharmacy 24",
    address: "Lvivska St, Kyiv",
    sequence: 2,
    visited: false,
  },
  {
    id: "demo-stop-3",
    routePlanId: "demo-plan-1",
    locationId: "demo-location-3",
    name: "Partner Hub",
    address: "Volodymyrska St, Kyiv",
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
  const [t, tCommon, format] = await Promise.all([
    getTranslations("field"),
    getTranslations("common"),
    getFormatter(),
  ]);

  const [sessionResult, routesResult] = await Promise.all([
    getCurrentSession(),
    listTodayRoutes(),
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

              <ol className="route-stop-list">
                {routeStops.map((stop, index) => (
                  <li key={stop.id}>
                    <a
                      className={`route-stop${stop.visited ? " visited" : ""}`}
                      href={`/${tenantSlug}/field/locations/${stop.locationId}?routePlanId=${stop.routePlanId}&routeItemId=${stop.id}${stop.visited ? "&visited=1" : ""}${
                        isDemoMode
                          ? `&demoName=${encodeURIComponent(stop.name)}&demoAddress=${encodeURIComponent(stop.address)}`
                          : ""
                      }`}
                    >
                      <span className="route-stop-summary">
                        <span className="route-stop-index" aria-hidden="true">
                          {stop.visited ? "✓" : index + 1}
                        </span>
                        <span className="route-stop-body">
                          <h3>{stop.name}</h3>
                          <p className="route-stop-address">{stop.address}</p>
                        </span>
                        <span className="route-stop-chevron" aria-hidden="true">
                          ›
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
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
