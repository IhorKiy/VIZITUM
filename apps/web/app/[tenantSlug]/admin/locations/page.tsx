import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  listAdminLocations,
  updateAdminLocation,
  type Location,
  type LocationStatus,
} from "../../../../lib/api-client";

type AdminLocationsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    error?: string;
    search?: string;
    status?: string;
    updated?: string;
  }>;
};

const locationStatuses: LocationStatus[] = ["active", "inactive", "archived"];

export default async function AdminLocationsPage({
  params,
  searchParams,
}: AdminLocationsPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const selectedStatus = normalizeStatus(pageState.status);
  const search = normalizeFilterValue(pageState.search);
  const hasFilters = Boolean(selectedStatus || search);

  const query = new URLSearchParams({ pageSize: "100" });

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (search) {
    query.set("search", search);
  }

  async function updateLocationAction(formData: FormData) {
    "use server";

    const locationId = String(formData.get("locationId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const city = String(formData.get("city") ?? "").trim();
    const type = normalizeOptionalField(formData.get("type"));
    const region = normalizeOptionalField(formData.get("region"));
    const territory = normalizeOptionalField(formData.get("territory"));
    const status = normalizeStatus(String(formData.get("status") ?? ""));

    if (!locationId || !name || !city || !status) {
      redirect(`/${tenantSlug}/admin/locations?error=1`);
    }

    const result = await updateAdminLocation(locationId, {
      name,
      city,
      type,
      region,
      territory,
      status,
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/locations?error=1`);
    }

    redirect(`/${tenantSlug}/admin/locations?updated=1`);
  }

  const locationsResult = await listAdminLocations(query.toString());

  if (!locationsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-locations">
        <header className="page-header">
          <div>
            <p className="eyebrow">Company admin</p>
            <h1>Locations</h1>
            <p>
              Live tenant locations are required in production before this
              screen can load.
            </p>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              Sign in
            </a>
          </div>
        </header>

        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Connection required</p>
            <h2>Tenant locations are not connected</h2>
            <p>{locationsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const locations = locationsResult.data.items;
  const activeCount = locations.filter(
    (location) => location.status === "active",
  ).length;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-locations">
      <header className="page-header">
        <div>
          <p className="eyebrow">Company admin</p>
          <h1>Locations</h1>
          <p>
            Review imported locations and keep status, region and territory
            current for field coverage.
          </p>
        </div>
      </header>

      {pageState.updated ? (
        <section className="notice-panel success" aria-label="Location status">
          <div>
            <p className="eyebrow">Location updated</p>
            <h2>Location details were saved</h2>
            <p>The change applies to this tenant immediately.</p>
          </div>
        </section>
      ) : null}

      {pageState.error ? (
        <section className="notice-panel danger" aria-label="Location error">
          <div>
            <p className="eyebrow">Update failed</p>
            <h2>Check the location details and try again</h2>
            <p>Name, city and status are required.</p>
          </div>
        </section>
      ) : null}

      <section className="manager-grid" aria-label="Location metrics">
        <article className="metric-card">
          <header>
            <p className="metric-label">Tenant locations</p>
            <span className="status-pill active">Live</span>
          </header>
          <p className="metric-value">{locationsResult.data.total}</p>
          <p className="small-label">{activeCount} active locations</p>
        </article>
      </section>

      <section className="panel drilldown-panel">
        <div className="panel-toolbar">
          <div className="panel-title-stack">
            <h2>Location list</h2>
            <p>
              Showing {selectedStatus ? formatLabel(selectedStatus) : "all"}{" "}
              locations{search ? ` matching "${search}"` : ""}.
            </p>
          </div>
          <div className="filter-pills" aria-label="Location status filters">
            <a
              aria-current={!selectedStatus ? "page" : undefined}
              href={buildLocationFilterHref(tenantSlug, null, search)}
            >
              All
            </a>
            {locationStatuses.map((status) => (
              <a
                aria-current={selectedStatus === status ? "page" : undefined}
                href={buildLocationFilterHref(tenantSlug, status, search)}
                key={status}
              >
                {formatLabel(status)}
              </a>
            ))}
          </div>
        </div>

        <form action={`/${tenantSlug}/admin/locations`} className="filter-form">
          {selectedStatus ? (
            <input name="status" type="hidden" value={selectedStatus} />
          ) : null}
          <label>
            Search
            <input
              defaultValue={search ?? ""}
              name="search"
              placeholder="Name or city"
              type="text"
            />
          </label>
          <div className="filter-actions">
            <button className="secondary-button" type="submit">
              Apply filters
            </button>
            {hasFilters ? (
              <a
                className="secondary-button"
                href={`/${tenantSlug}/admin/locations`}
              >
                Reset
              </a>
            ) : null}
          </div>
        </form>

        {locations.length > 0 ? (
          <div className="admin-user-list">
            {locations.map((location) => (
              <LocationRow
                key={location.id}
                location={location}
                updateLocationAction={updateLocationAction}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state-panel">
            <h2>No locations match this filter</h2>
            <p>
              Use another status filter or import locations before managing
              coverage here.
            </p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/admin/locations`}
                >
                  Show all locations
                </a>
              ) : null}
              <a
                className="primary-button"
                href={`/${tenantSlug}/admin/imports`}
              >
                Open imports
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function LocationRow({
  location,
  updateLocationAction,
}: {
  location: Location;
  updateLocationAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <article className="admin-user-row">
      <header>
        <div>
          <h3>{location.name}</h3>
          <p>
            {location.addressLine}, {location.city}
          </p>
        </div>
        <span className={`status-pill ${locationStatusTone(location.status)}`}>
          {formatLabel(location.status)}
        </span>
      </header>

      <form action={updateLocationAction} className="visit-form compact">
        <input name="locationId" type="hidden" value={location.id} />
        <label>
          Name
          <input defaultValue={location.name} name="name" required />
        </label>
        <label>
          City
          <input defaultValue={location.city} name="city" required />
        </label>
        <label>
          Type
          <input defaultValue={location.type ?? ""} name="type" />
        </label>
        <label>
          Region
          <input defaultValue={location.region ?? ""} name="region" />
        </label>
        <label>
          Territory
          <input defaultValue={location.territory ?? ""} name="territory" />
        </label>
        <label>
          Status
          <select defaultValue={location.status} name="status" required>
            {locationStatuses.map((status) => (
              <option key={status} value={status}>
                {formatLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <PendingSubmitButton
          className="secondary-button"
          pendingLabel="Saving..."
        >
          Save location
        </PendingSubmitButton>
      </form>
    </article>
  );
}

function buildLocationFilterHref(
  tenantSlug: string,
  status: LocationStatus | null,
  search: string | null,
): string {
  const query = new URLSearchParams();

  if (status) {
    query.set("status", status);
  }

  if (search) {
    query.set("search", search);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/admin/locations${suffix ? `?${suffix}` : ""}`;
}

function normalizeStatus(value: string | undefined): LocationStatus | null {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }

  return null;
}

function normalizeFilterValue(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  return normalizedValue || null;
}

function normalizeOptionalField(
  value: FormDataEntryValue | null,
): string | null {
  const normalizedValue = String(value ?? "").trim();

  return normalizedValue || null;
}

function locationStatusTone(
  status: LocationStatus,
): "active" | "info" | "warning" {
  if (status === "active") {
    return "active";
  }

  return status === "inactive" ? "info" : "warning";
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
