import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  listAdminChains,
  listAdminLocations,
  updateAdminLocation,
  type Chain,
  type Location,
  type LocationStatus,
} from "../../../../lib/api-client";
import {
  formatEnumLabel,
  normalizeFilterValue,
  statusTone,
} from "../../../../lib/format";

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
  const [t, tAdmin, tCommon] = await Promise.all([
    getTranslations("admin.locations"),
    getTranslations("admin"),
    getTranslations("common"),
  ]);
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
    const chainId = normalizeOptionalField(formData.get("chainId"));
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
      chainId,
      region,
      territory,
      status,
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/locations?error=1`);
    }

    redirect(`/${tenantSlug}/admin/locations?updated=1`);
  }

  const [locationsResult, chainsResult] = await Promise.all([
    listAdminLocations(query.toString()),
    listAdminChains("pageSize=100&status=active"),
  ]);
  const chains = chainsResult.ok ? chainsResult.data.items : [];

  if (!locationsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-locations">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tAdmin("eyebrow")}</p>
            <h1>{t("title")}</h1>
          </div>
          <div className="toolbar">
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
            <h2>{t("notConnectedTitle")}</h2>
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
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
      </header>

      {pageState.updated ? (
        <section className="notice-panel success" aria-label={t("updatedAria")}>
          <div>
            <p className="eyebrow">{t("updatedEyebrow")}</p>
            <h2>{t("updatedTitle")}</h2>
            <p>{t("updatedBody")}</p>
          </div>
        </section>
      ) : null}

      {pageState.error ? (
        <section className="notice-panel danger" aria-label={t("errorAria")}>
          <div>
            <p className="eyebrow">{t("errorEyebrow")}</p>
            <h2>{t("errorTitle")}</h2>
            <p>{t("errorBody")}</p>
          </div>
        </section>
      ) : null}

      <section className="manager-grid" aria-label={t("metricsAria")}>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("tenantLocations")}</p>
            <span className="status-pill active">{tCommon("labels.live")}</span>
          </header>
          <p className="metric-value">{locationsResult.data.total}</p>
          <p className="small-label">
            {t("activeCount", { count: activeCount })}
          </p>
        </article>
      </section>

      <section className="panel drilldown-panel">
        <div className="panel-toolbar">
          <div className="panel-title-stack">
            <h2>{t("locationList")}</h2>
            <p>
              {selectedStatus
                ? t("showingStatus", {
                    status: formatEnumLabel(tCommon, selectedStatus),
                    search: search ? t("searchSuffix", { search }) : "",
                  })
                : t("showingAll", {
                    search: search ? t("searchSuffix", { search }) : "",
                  })}
            </p>
          </div>
          <div className="filter-pills" aria-label={t("statusFiltersAria")}>
            <a
              aria-current={!selectedStatus ? "page" : undefined}
              href={buildLocationFilterHref(tenantSlug, null, search)}
            >
              {tCommon("all")}
            </a>
            {locationStatuses.map((status) => (
              <a
                aria-current={selectedStatus === status ? "page" : undefined}
                href={buildLocationFilterHref(tenantSlug, status, search)}
                key={status}
              >
                {formatEnumLabel(tCommon, status)}
              </a>
            ))}
          </div>
        </div>

        <form action={`/${tenantSlug}/admin/locations`} className="filter-form">
          {selectedStatus ? (
            <input name="status" type="hidden" value={selectedStatus} />
          ) : null}
          <label>
            {t("search")}
            <input
              defaultValue={search ?? ""}
              name="search"
              placeholder={t("searchPlaceholder")}
              type="text"
            />
          </label>
          <div className="filter-actions">
            <button className="secondary-button" type="submit">
              {tCommon("applyFilters")}
            </button>
            {hasFilters ? (
              <a
                className="secondary-button"
                href={`/${tenantSlug}/admin/locations`}
              >
                {tCommon("reset")}
              </a>
            ) : null}
          </div>
        </form>

        {locations.length > 0 ? (
          <div className="admin-user-list">
            {locations.map((location) => (
              <LocationRow
                key={location.id}
                chains={chains}
                location={location}
                updateLocationAction={updateLocationAction}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/admin/locations`}
                >
                  {t("showAllLocations")}
                </a>
              ) : null}
              <a
                className="primary-button"
                href={`/${tenantSlug}/admin/imports`}
              >
                {t("openImports")}
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function LocationRow({
  chains,
  location,
  updateLocationAction,
}: {
  chains: Chain[];
  location: Location;
  updateLocationAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("admin.locations");
  const tCommon = useTranslations("common");
  // A location may point at a chain that is no longer active (so absent from
  // the picker options); keep it selectable so saving doesn't silently drop it.
  const chainOptions =
    location.chain && !chains.some((chain) => chain.id === location.chainId)
      ? [{ id: location.chain.id, name: location.chain.name }, ...chains]
      : chains;

  return (
    <article className="admin-user-row">
      <header>
        <div>
          <h3>{location.name}</h3>
          <p>
            {location.addressLine}, {location.city}
          </p>
        </div>
        <span className={`status-pill ${statusTone(location.status)}`}>
          {formatEnumLabel(tCommon, location.status)}
        </span>
      </header>

      <form action={updateLocationAction} className="visit-form compact">
        <input name="locationId" type="hidden" value={location.id} />
        <label>
          {t("name")}
          <input defaultValue={location.name} name="name" required />
        </label>
        <label>
          {t("city")}
          <input defaultValue={location.city} name="city" required />
        </label>
        <label>
          {t("type")}
          <input defaultValue={location.type ?? ""} name="type" />
        </label>
        <label>
          {t("chain")}
          <select defaultValue={location.chainId ?? ""} name="chainId">
            <option value="">{t("chainNone")}</option>
            {chainOptions.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("region")}
          <input defaultValue={location.region ?? ""} name="region" />
        </label>
        <label>
          {t("territory")}
          <input defaultValue={location.territory ?? ""} name="territory" />
        </label>
        <label>
          {t("status")}
          <select defaultValue={location.status} name="status" required>
            {locationStatuses.map((status) => (
              <option key={status} value={status}>
                {formatEnumLabel(tCommon, status)}
              </option>
            ))}
          </select>
        </label>
        <PendingSubmitButton
          className="secondary-button"
          pendingLabel={tCommon("saving")}
        >
          {t("saveLocation")}
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

function normalizeOptionalField(
  value: FormDataEntryValue | null,
): string | null {
  const normalizedValue = String(value ?? "").trim();

  return normalizedValue || null;
}
