import { redirect } from "next/navigation";

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
  formatLabel,
  statusPillTone,
} from "../../../../../lib/format";

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

  async function startVisitAction(formData: FormData) {
    "use server";

    const actionSessionResult = await getCurrentSession();
    const formRouteItemId = String(formData.get("routeItemId") ?? "").trim();

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

    const formRoutePlanId = String(formData.get("routePlanId") ?? "").trim();
    const formRouteItemId = String(formData.get("routeItemId") ?? "").trim();

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
            <p className="eyebrow">Field flow</p>
            <h1>Location</h1>
            <p>Sign in to view this location.</p>
          </div>
          <div className="toolbar" aria-label="Session actions">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              Sign in
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
            <p className="eyebrow">Field flow</p>
            <h1>Location not found</h1>
          </div>
          <div className="toolbar" aria-label="Location actions">
            <a className="secondary-button" href={`/${tenantSlug}/field`}>
              Back to route
            </a>
          </div>
        </header>
        <section className="notice-panel danger" aria-label="Location error">
          <div>
            <p className="eyebrow">Connection required</p>
            <h2>Could not load this location</h2>
            <p>{locationResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const locationName = locationResult.ok
    ? locationResult.data.name
    : (demoName ?? "Demo location");
  const locationAddress = locationResult.ok
    ? [locationResult.data.addressLine, locationResult.data.city]
        .filter(Boolean)
        .join(", ")
    : (demoAddress ?? "");
  const representativeName = sessionResult.ok
    ? sessionResult.data.user.name
    : "Demo representative";

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
        <section className="notice-panel danger" aria-label="Visit error">
          <div>
            <p className="eyebrow">Visit not created</p>
            <h2>New visit failed</h2>
            <p>Try starting the visit again.</p>
          </div>
        </section>
      ) : null}

      {error === "route" ? (
        <section className="notice-panel danger" aria-label="Route error">
          <div>
            <p className="eyebrow">Route not updated</p>
            <h2>Could not update the stop</h2>
            <p>Refresh and try again.</p>
          </div>
        </section>
      ) : null}

      {route === "visited" ? (
        <section className="notice-panel success" aria-label="Route status">
          <div>
            <p className="eyebrow">Route updated</p>
            <h2>Stop marked as visited</h2>
            <p>Your route progress for today was updated.</p>
          </div>
        </section>
      ) : null}

      {isDemoLocation ? (
        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Demo mode</p>
            <h2>Backend session is not connected</h2>
            <p>
              Showing sample location details until the Nest API returns an
              authenticated session. Reason: {sessionResult.message}
            </p>
          </div>
        </section>
      ) : null}

      <div className="location-header panel">
        <div className="location-header-top">
          <a
            aria-label="Back to route"
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

      <details className="panel location-feature">
        <summary className="location-feature-summary">
          <span className="location-feature-heading">
            <span className="location-feature-icon" aria-hidden="true">
              💰
            </span>
            <span className="location-feature-titles">
              <span className="location-feature-name">
                Потенціал
                <span className="location-feature-help" aria-hidden="true">
                  ?
                </span>
              </span>
              <span className="location-feature-meta">0 товарних груп</span>
            </span>
          </span>
          <span className="location-feature-actions">
            <span className="location-feature-chevron" aria-hidden="true">
              ›
            </span>
            <button
              aria-label="Add product group (coming soon)"
              className="location-feature-add"
              disabled
              type="button"
            >
              +
            </button>
          </span>
        </summary>
        <p className="empty-state">
          Product group potential is not tracked yet.
        </p>
      </details>

      <details className="panel location-feature">
        <summary className="location-feature-summary">
          <span className="location-feature-heading">
            <span className="location-feature-icon" aria-hidden="true">
              📦
            </span>
            <span className="location-feature-titles">
              <span className="location-feature-name">
                Асортимент
                <span className="location-feature-help" aria-hidden="true">
                  ?
                </span>
              </span>
              <span className="location-feature-meta">0 позицій</span>
            </span>
          </span>
          <span className="location-feature-actions">
            <span className="location-feature-chevron" aria-hidden="true">
              ›
            </span>
            <button
              aria-label="Add assortment item (coming soon)"
              className="location-feature-add"
              disabled
              type="button"
            >
              +
            </button>
          </span>
        </summary>
        <p className="empty-state">Assortment tracking is not available yet.</p>
      </details>

      {isDemoLocation ? (
        <a
          className="primary-button location-start-visit"
          href={`/${tenantSlug}/field/visits/demo-visit-${locationId}?demoName=${encodeURIComponent(locationName)}&demoAddress=${encodeURIComponent(locationAddress)}`}
        >
          <span aria-hidden="true">▶</span> Почати візит (demo)
        </a>
      ) : activeVisit ? (
        <a
          className="primary-button location-start-visit"
          href={`/${tenantSlug}/field/visits/${activeVisit.id}`}
        >
          <span aria-hidden="true">▶</span> Продовжити візит
        </a>
      ) : stopAlreadyVisited ? (
        <p className="empty-state">
          This stop is already marked visited today.
        </p>
      ) : (
        <form action={startVisitAction}>
          <input name="routeItemId" type="hidden" value={routeItemId ?? ""} />
          <PendingSubmitButton
            className="primary-button location-start-visit"
            pendingLabel="Starting..."
          >
            <span aria-hidden="true">▶</span> Почати візит
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
            pendingLabel="Saving..."
          >
            Позначити відвіданим
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
                Відкриті задачі
                <span className="location-feature-help" aria-hidden="true">
                  ?
                </span>
              </span>
              <span className="location-feature-meta">
                {openTasks.length} задач
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
                    <p>{item.description ?? "No additional details"}</p>
                  </div>
                  <span
                    className={`status-pill ${statusPillTone(item.status)}`}
                  >
                    {formatLabel(item.status)}
                  </span>
                </header>
                <p className="form-hint">
                  {formatLabel(item.priority)} priority · Due{" "}
                  {formatDateTime(item.dueDate, "not set")}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">No open tasks for this location.</p>
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
                Історія візитів
                <span className="location-feature-help" aria-hidden="true">
                  ?
                </span>
              </span>
              <span className="location-feature-meta">
                {visitHistory.length} візитів
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
                      {formatDateTime(item.completedAt ?? item.createdAt)}
                    </h3>
                    <p>{formatLabel(item.visitType)}</p>
                  </div>
                  <span
                    className={`status-pill ${statusPillTone(item.status)}`}
                  >
                    {formatLabel(item.status)}
                  </span>
                </header>
              </a>
            ))}
          </div>
        ) : (
          <p className="empty-state">No past visits recorded yet.</p>
        )}
      </details>
    </AppShell>
  );
}
