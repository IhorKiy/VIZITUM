import { AppShell } from "../../../components/app-shell";
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

  const sessionResult = await getCurrentSession();
  const todayRoutesResult = sessionResult.ok
    ? await listTodayRoutes()
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
            <p className="eyebrow">Field flow</p>
            <h1>Today&apos;s visits</h1>
            <p>
              Live visit data is required in production before field work can
              continue.
            </p>
          </div>
          <div className="toolbar" aria-label="Session actions">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              Sign in
            </a>
          </div>
        </header>

        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Connection required</p>
            <h2>Backend session is not connected</h2>
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
    ? (sessionResult.data.user.name.split(" ")[0] ?? sessionResult.data.user.name)
    : "Гість";

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      <header className="page-header greeting-header">
        <div>
          <h1>Привіт, {firstName}!</h1>
          <p className="greeting-date">{formatGreetingDate(new Date())}</p>
        </div>
      </header>

      {report === "confirmed" ? (
        <section className="notice-panel success" aria-label="Report status">
          <div>
            <p className="eyebrow">Report confirmed</p>
            <h2>Manual report saved</h2>
            <p>The visit was marked completed and the report was confirmed.</p>
          </div>
        </section>
      ) : null}

      {isDemoMode ? (
        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Demo mode</p>
            <h2>Backend session is not connected</h2>
            <p>
              Showing sample visits until the Nest API returns an authenticated
              session. Reason: {todayRoutesResult.message}
            </p>
          </div>
        </section>
      ) : null}

      <section className="route-section" aria-label="Today's route">
        {routeStops.length > 0 ? (
          <>
            <article className="route-progress-card">
              <div className="route-progress-head">
                <span>Progress today</span>
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
                <span>{visitedStops} visited</span>
                {routeStops.length - visitedStops > 0 ? (
                  <span>{routeStops.length - visitedStops} remaining</span>
                ) : (
                  <span>All visited</span>
                )}
              </div>
            </article>

            <div className="route-plan-card">
              <div className="route-plan-head">
                <span className="route-plan-icon" aria-hidden="true">
                  ⇄
                </span>
                <div className="route-plan-heading">
                  <p className="route-plan-name">Today&apos;s route</p>
                  <a
                    className="route-plan-link"
                    href={`/${tenantSlug}/field/planning`}
                  >
                    Edit plan →
                  </a>
                </div>
              </div>

              <ol className="route-stop-list">
                {routeStops.map((stop, index) => (
                  <li key={stop.id}>
                    <a
                      className={`route-stop${stop.visited ? " visited" : ""}`}
                      href={`/${tenantSlug}/field/locations/${stop.locationId}?routePlanId=${stop.routePlanId}&routeItemId=${stop.id}`}
                    >
                      <span className="route-stop-summary">
                        <span className="route-stop-index" aria-hidden="true">
                          {stop.visited ? "✓" : index + 1}
                        </span>
                        <span className="route-stop-body">
                          <h3>{stop.name}</h3>
                          <p className="route-stop-address">{stop.address}</p>
                        </span>
                        <span
                          className="route-stop-chevron"
                          aria-hidden="true"
                        >
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
            <p className="route-empty-title">No route planned for today</p>
            <p className="route-empty-text">
              Build a route in planning to line up today&apos;s stops in order.
            </p>
            <a
              className="route-plan-link"
              href={`/${tenantSlug}/field/planning`}
            >
              Go to planning →
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

function formatGreetingDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).formatToParts(date);

  const weekday = capitalize(
    parts.find((part) => part.type === "weekday")?.value ?? "",
  );
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = capitalize(
    parts.find((part) => part.type === "month")?.value ?? "",
  );
  const year = parts.find((part) => part.type === "year")?.value ?? "";

  return `${weekday}, ${day} ${month} ${year}`;
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
