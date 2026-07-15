import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { AddChainModal } from "../../../../components/add-chain-modal";
import { AppShell } from "../../../../components/app-shell";
import { ArchiveChainButton } from "../../../../components/archive-chain-button";
import { CreateLocationModal } from "../../../../components/create-location-modal";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import { InlineFieldEditor } from "../../../../components/inline-field-editor";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  createAdminChain,
  createAdminLocation,
  createAdminLocationAssignment,
  createAdminLocationContact,
  deactivateAdminLocationAssignment,
  deleteAdminLocationContact,
  listAdminChains,
  listAdminLocations,
  listAdminUsers,
  updateAdminChain,
  updateAdminLocation,
  updateAdminLocationContact,
  type Chain,
  type ChainStatus,
  type Location,
  type LocationStatus,
  type TenantUser,
} from "../../../../lib/api-client";
import {
  formatEnumLabel,
  normalizeFilterValue,
  statusTone,
} from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";

// Locations / Chains — a single admin screen that merges the former Locations
// and Chains sections into two collapsible accordions. Their filters and post-
// action notices share the same route, so every query param is namespaced
// (`loc*` vs `chain*`) to keep the two sections from stepping on each other.
type AdminLocationsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    locCreated?: string;
    locUpdated?: string;
    locError?: string;
    locSearch?: string;
    locStatus?: string;
    locChain?: string;
    locView?: string;
    chainCreated?: string;
    chainUpdated?: string;
    chainError?: string;
    chainSearch?: string;
    chainStatus?: string;
  }>;
};

const locationStatuses: LocationStatus[] = ["active", "inactive", "archived"];
const chainStatuses: ChainStatus[] = ["active", "archived"];

export default async function AdminLocationsPage({
  params,
  searchParams,
}: AdminLocationsPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [t, tChains, tAdmin, tCommon, locale] = await Promise.all([
    getTranslations("admin.locations"),
    getTranslations("admin.chains"),
    getTranslations("admin"),
    getTranslations("common"),
    getLocale(),
  ]);

  const locStatus = normalizeLocationStatus(pageState.locStatus);
  const locSearch = normalizeFilterValue(pageState.locSearch);
  const locChain = normalizeFilterValue(pageState.locChain);
  const locGroupByChain = pageState.locView === "chain";
  const locHasFilters = Boolean(locStatus || locSearch || locChain);

  const chainStatus = normalizeChainStatus(pageState.chainStatus);
  const chainSearch = normalizeFilterValue(pageState.chainSearch);
  const chainHasFilters = Boolean(chainStatus || chainSearch);

  const locQuery = new URLSearchParams({ pageSize: "100" });
  if (locStatus) {
    locQuery.set("status", locStatus);
  }
  if (locSearch) {
    locQuery.set("search", locSearch);
  }
  if (locChain) {
    locQuery.set("chainId", locChain);
  }

  const chainQuery = new URLSearchParams({ pageSize: "100" });
  if (chainStatus) {
    chainQuery.set("status", chainStatus);
  }
  if (chainSearch) {
    chainQuery.set("search", chainSearch);
  }

  async function createLocationAction(formData: FormData) {
    "use server";

    const name = getFormString(formData, "name").trim();
    const addressLine = getFormString(formData, "addressLine").trim();
    const city = getFormString(formData, "city").trim();

    if (!name || !addressLine || !city) {
      redirect(`/${tenantSlug}/admin/locations?locError=1`);
    }

    const result = await createAdminLocation({
      name,
      addressLine,
      city,
      externalCode: normalizeOptionalField(formData.get("externalCode")),
      // "Category" reuses the existing free-text `type` column.
      type: normalizeOptionalField(formData.get("type")),
      chainId: normalizeOptionalField(formData.get("chainId")),
      region: normalizeOptionalField(formData.get("region")),
      notes: normalizeOptionalField(formData.get("notes")),
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/locations?locError=1`);
    }

    // Assignment lives in its own table, so attach the chosen representative to
    // the freshly created location as a follow-up step.
    const representativeUserId = normalizeOptionalField(
      formData.get("representativeUserId"),
    );

    if (representativeUserId) {
      const assignResult = await createAdminLocationAssignment(
        result.data.id,
        representativeUserId,
      );

      if (!assignResult.ok) {
        redirect(`/${tenantSlug}/admin/locations?locError=1`);
      }
    }

    redirect(`/${tenantSlug}/admin/locations?locCreated=1`);
  }

  async function saveLocationAction(formData: FormData) {
    "use server";

    const errorHref = `/${tenantSlug}/admin/locations?locError=1`;
    const locationId = getFormString(formData, "locationId").trim();
    const name = getFormString(formData, "name").trim();
    const addressLine = getFormString(formData, "addressLine").trim();
    const city = getFormString(formData, "city").trim();
    const externalCode = normalizeOptionalField(formData.get("externalCode"));
    // "Category" reuses the existing free-text `type` column.
    const type = normalizeOptionalField(formData.get("type"));
    const chainId = normalizeOptionalField(formData.get("chainId"));
    const region = normalizeOptionalField(formData.get("region"));
    const notes = normalizeOptionalField(formData.get("notes"));
    const status = normalizeLocationStatus(getFormString(formData, "status"));

    if (!locationId || !name || !addressLine || !city || !status) {
      redirect(errorHref);
    }

    const result = await updateAdminLocation(locationId, {
      name,
      externalCode,
      addressLine,
      city,
      type,
      chainId,
      region,
      notes,
      status,
    });

    if (!result.ok) {
      redirect(errorHref);
    }

    // Two fixed contact slots (person + phone). A slot with a name is created
    // or updated; a slot cleared of its name deletes the contact it stood for.
    for (const slot of [1, 2] as const) {
      const contactId = normalizeOptionalField(
        formData.get(`contact${slot}Id`),
      );
      const contactName = getFormString(formData, `contact${slot}Name`).trim();
      const phone = normalizeOptionalField(formData.get(`contact${slot}Phone`));

      if (contactName) {
        const contactResult = contactId
          ? await updateAdminLocationContact(locationId, contactId, {
              name: contactName,
              phone,
            })
          : await createAdminLocationContact(locationId, {
              name: contactName,
              phone,
            });

        if (!contactResult.ok) {
          redirect(errorHref);
        }
      } else if (contactId) {
        const deleteResult = await deleteAdminLocationContact(
          locationId,
          contactId,
        );

        if (!deleteResult.ok) {
          redirect(errorHref);
        }
      }
    }

    // Single active representative assignment. Switching reps deactivates the
    // current assignment before (re)activating the chosen one; clearing it just
    // deactivates.
    const assignmentId = normalizeOptionalField(formData.get("assignmentId"));
    const currentRepId = normalizeOptionalField(formData.get("currentRepId"));
    const nextRepId = normalizeOptionalField(
      formData.get("representativeUserId"),
    );

    if (nextRepId !== currentRepId) {
      if (assignmentId) {
        const deactivateResult = await deactivateAdminLocationAssignment(
          locationId,
          assignmentId,
        );

        if (!deactivateResult.ok) {
          redirect(errorHref);
        }
      }

      if (nextRepId) {
        const assignResult = await createAdminLocationAssignment(
          locationId,
          nextRepId,
        );

        if (!assignResult.ok) {
          redirect(errorHref);
        }
      }
    }

    redirect(`/${tenantSlug}/admin/locations?locUpdated=1`);
  }

  async function createChainAction(formData: FormData) {
    "use server";

    const name = getFormString(formData, "name").trim();
    const externalCode = normalizeOptionalField(formData.get("externalCode"));
    const notes = normalizeOptionalField(formData.get("notes"));

    if (!name) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1`);
    }

    const result = await createAdminChain({ name, externalCode, notes });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1`);
    }

    redirect(`/${tenantSlug}/admin/locations?chainCreated=1`);
  }

  async function updateChainAction(formData: FormData) {
    "use server";

    const chainId = getFormString(formData, "chainId").trim();

    if (!chainId) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1`);
    }

    // Each field editor saves on its own, so only patch the fields present in
    // this submission rather than overwriting the whole chain.
    const input: {
      name?: string;
      externalCode?: string | null;
      notes?: string | null;
      status?: ChainStatus;
    } = {};

    if (formData.has("name")) {
      const name = getFormString(formData, "name").trim();
      if (!name) {
        redirect(`/${tenantSlug}/admin/locations?chainError=1`);
      }
      input.name = name;
    }

    if (formData.has("externalCode")) {
      input.externalCode = normalizeOptionalField(formData.get("externalCode"));
    }

    if (formData.has("notes")) {
      input.notes = normalizeOptionalField(formData.get("notes"));
    }

    if (formData.has("status")) {
      const status = normalizeChainStatus(getFormString(formData, "status"));
      if (!status) {
        redirect(`/${tenantSlug}/admin/locations?chainError=1`);
      }
      input.status = status;
    }

    const result = await updateAdminChain(chainId, input);

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1`);
    }

    redirect(`/${tenantSlug}/admin/locations?chainUpdated=1`);
  }

  async function archiveChainAction(formData: FormData) {
    "use server";

    const chainId = getFormString(formData, "chainId").trim();

    if (!chainId) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1`);
    }

    const result = await updateAdminChain(chainId, { status: "archived" });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1`);
    }

    redirect(`/${tenantSlug}/admin/locations?chainUpdated=1`);
  }

  const [locationsResult, chainsResult, pickerChainsResult, usersResult] =
    await Promise.all([
      listAdminLocations(locQuery.toString()),
      listAdminChains(chainQuery.toString()),
      listAdminChains("pageSize=100&status=active"),
      listAdminUsers(),
    ]);

  // The location editor's chain picker always offers active chains, regardless
  // of how the Chains section itself is currently filtered.
  const pickerChains = pickerChainsResult.ok
    ? pickerChainsResult.data.items
    : [];
  // Only active field representatives can be assigned to a location (the API
  // rejects anyone else), so the picker offers exactly those.
  const representatives = usersResult.ok
    ? usersResult.data.items.filter(
        (user) =>
          user.status === "active" &&
          user.roleCodes.includes("field_representative"),
      )
    : [];

  const locActive = Boolean(
    pageState.locCreated ||
    pageState.locUpdated ||
    pageState.locError ||
    locHasFilters ||
    locGroupByChain,
  );
  const chainActive = Boolean(
    pageState.chainCreated ||
    pageState.chainUpdated ||
    pageState.chainError ||
    chainHasFilters,
  );
  // Locations stay open by default; a chain action collapses them in favor of
  // the Chains section so the relevant feedback is the one on screen.
  const locationsOpen = locActive || !chainActive;
  const chainsOpen = chainActive;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-locations">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{tAdmin("locationsChains.title")}</h1>
        </div>
      </header>

      <section
        className="manager-grid"
        aria-label={tAdmin("locationsChains.metricsAria")}
      >
        {locationsResult.ok ? (
          <article className="metric-card">
            <header>
              <p className="metric-label">{t("tenantLocations")}</p>
              <span className="status-pill active">
                {tCommon("labels.live")}
              </span>
            </header>
            <p className="metric-value">{locationsResult.data.total}</p>
            <p className="small-label">
              {t("activeCount", {
                count: locationsResult.data.items.filter(
                  (location) => location.status === "active",
                ).length,
              })}
            </p>
          </article>
        ) : null}
        {chainsResult.ok ? (
          <article className="metric-card">
            <header>
              <p className="metric-label">{tChains("tenantChains")}</p>
              <span className="status-pill active">
                {tCommon("labels.live")}
              </span>
            </header>
            <p className="metric-value">{chainsResult.data.total}</p>
            <p className="small-label">
              {tChains("activeCount", {
                count: chainsResult.data.items.filter(
                  (chain) => chain.status === "active",
                ).length,
              })}
            </p>
          </article>
        ) : null}
      </section>

      <div className="section-stack">
        <details className="panel panel-collapsible" open={locationsOpen}>
          <summary className="panel-summary">
            <h2>{t("title")}</h2>
          </summary>

          <div className="section-body">
            {pageState.locCreated ? (
              <DismissableNotice
                ariaLabel={t("createdAria")}
                body={t("createdBody")}
                clearParams={["locCreated"]}
                eyebrow={t("createdEyebrow")}
                title={t("createdTitle")}
                tone="success"
              />
            ) : null}

            {pageState.locUpdated ? (
              <DismissableNotice
                ariaLabel={t("updatedAria")}
                body={t("updatedBody")}
                clearParams={["locUpdated"]}
                eyebrow={t("updatedEyebrow")}
                title={t("updatedTitle")}
                tone="success"
              />
            ) : null}

            {pageState.locError ? (
              <DismissableNotice
                ariaLabel={t("errorAria")}
                body={t("errorBody")}
                clearParams={["locError"]}
                eyebrow={t("errorEyebrow")}
                title={t("errorTitle")}
                tone="danger"
              />
            ) : null}

            {locationsResult.ok ? (
              <LocationsSection
                chains={pickerChains}
                createLocationAction={createLocationAction}
                groupByChain={locGroupByChain}
                hasFilters={locHasFilters}
                locale={locale}
                locations={locationsResult.data.items}
                representatives={representatives}
                saveLocationAction={saveLocationAction}
                search={locSearch}
                selectedChain={locChain}
                selectedStatus={locStatus}
                tenantSlug={tenantSlug}
              />
            ) : (
              <div className="empty-state-panel">
                <h2>{t("notConnectedTitle")}</h2>
                <p>{locationsResult.message}</p>
              </div>
            )}
          </div>
        </details>

        <details className="panel panel-collapsible" open={chainsOpen}>
          <summary className="panel-summary">
            <h2>{tChains("title")}</h2>
          </summary>

          <div className="section-body">
            {pageState.chainCreated ? (
              <DismissableNotice
                ariaLabel={tChains("createdAria")}
                body={tChains("createdBody")}
                clearParams={["chainCreated"]}
                eyebrow={tChains("createdEyebrow")}
                title={tChains("createdTitle")}
                tone="success"
              />
            ) : null}

            {pageState.chainUpdated ? (
              <DismissableNotice
                ariaLabel={tChains("updatedAria")}
                body={tChains("updatedBody")}
                clearParams={["chainUpdated"]}
                eyebrow={tChains("updatedEyebrow")}
                title={tChains("updatedTitle")}
                tone="success"
              />
            ) : null}

            {pageState.chainError ? (
              <DismissableNotice
                ariaLabel={tChains("errorAria")}
                body={tChains("errorBody")}
                clearParams={["chainError"]}
                eyebrow={tChains("errorEyebrow")}
                title={tChains("errorTitle")}
                tone="danger"
              />
            ) : null}

            {chainsResult.ok ? (
              <ChainsSection
                archiveChainAction={archiveChainAction}
                chains={chainsResult.data.items}
                createChainAction={createChainAction}
                hasFilters={chainHasFilters}
                search={chainSearch}
                selectedStatus={chainStatus}
                tenantSlug={tenantSlug}
                updateChainAction={updateChainAction}
              />
            ) : (
              <div className="empty-state-panel">
                <h2>{tChains("notConnectedTitle")}</h2>
                <p>{chainsResult.message}</p>
              </div>
            )}
          </div>
        </details>
      </div>
    </AppShell>
  );
}

function LocationsSection({
  chains,
  createLocationAction,
  groupByChain,
  hasFilters,
  locale,
  locations,
  representatives,
  saveLocationAction,
  search,
  selectedChain,
  selectedStatus,
  tenantSlug,
}: {
  chains: Chain[];
  createLocationAction: (formData: FormData) => Promise<void>;
  groupByChain: boolean;
  hasFilters: boolean;
  locale: string;
  locations: Location[];
  representatives: TenantUser[];
  saveLocationAction: (formData: FormData) => Promise<void>;
  search: string | null;
  selectedChain: string | null;
  selectedStatus: LocationStatus | null;
  tenantSlug: string;
}) {
  const t = useTranslations("admin.locations");
  const tCommon = useTranslations("common");

  const viewParam = groupByChain ? "chain" : null;

  // Keep the active chain filter selectable even when it points at a chain the
  // active-chain picker doesn't offer (e.g. an archived chain): recover its name
  // from any location that belongs to it.
  const chainFilterOptions =
    selectedChain && !chains.some((chain) => chain.id === selectedChain)
      ? [
          {
            id: selectedChain,
            name:
              locations.find((location) => location.chainId === selectedChain)
                ?.chain?.name ?? selectedChain,
          },
          ...chains,
        ]
      : chains;

  const locationGroups = groupByChain
    ? buildLocationGroups(locations, t("chainNone"), locale)
    : [];

  return (
    <>
      <div className="toolbar section-toolbar">
        <CreateLocationModal
          action={createLocationAction}
          chains={chains}
          representatives={representatives}
        />
      </div>

      <div className="panel drilldown-panel">
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
          <div className="panel-toolbar-filters">
            <div className="filter-pills" aria-label={t("statusFiltersAria")}>
              <a
                aria-current={!selectedStatus ? "page" : undefined}
                href={buildLocationFilterHref(tenantSlug, {
                  chain: selectedChain,
                  search,
                  view: viewParam,
                })}
              >
                {tCommon("all")}
              </a>
              {locationStatuses.map((status) => (
                <a
                  aria-current={selectedStatus === status ? "page" : undefined}
                  href={buildLocationFilterHref(tenantSlug, {
                    status,
                    chain: selectedChain,
                    search,
                    view: viewParam,
                  })}
                  key={status}
                >
                  {formatEnumLabel(tCommon, status)}
                </a>
              ))}
            </div>
            <div className="filter-pills" aria-label={t("viewFiltersAria")}>
              <a
                aria-current={!groupByChain ? "page" : undefined}
                href={buildLocationFilterHref(tenantSlug, {
                  status: selectedStatus,
                  chain: selectedChain,
                  search,
                })}
              >
                {t("viewList")}
              </a>
              <a
                aria-current={groupByChain ? "page" : undefined}
                href={buildLocationFilterHref(tenantSlug, {
                  status: selectedStatus,
                  chain: selectedChain,
                  search,
                  view: "chain",
                })}
              >
                {t("viewByChain")}
              </a>
            </div>
          </div>
        </div>

        <form
          action={`/${tenantSlug}/admin/locations`}
          className="filter-form location-filter-form"
        >
          {selectedStatus ? (
            <input name="locStatus" type="hidden" value={selectedStatus} />
          ) : null}
          {groupByChain ? (
            <input name="locView" type="hidden" value="chain" />
          ) : null}
          <label>
            {t("chain")}
            <select defaultValue={selectedChain ?? ""} name="locChain">
              <option value="">{t("allChains")}</option>
              {chainFilterOptions.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("search")}
            <input
              defaultValue={search ?? ""}
              name="locSearch"
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
          groupByChain ? (
            <div className="entity-group-list">
              {locationGroups.map((group) => (
                <section className="entity-group" key={group.key}>
                  <h3 className="entity-group-title">
                    <span>{group.label}</span>
                    <span className="entity-group-count">
                      {group.items.length}
                    </span>
                  </h3>
                  <div className="admin-user-list">
                    {group.items.map((location) => (
                      <LocationRow
                        key={location.id}
                        chains={chains}
                        location={location}
                        representatives={representatives}
                        saveLocationAction={saveLocationAction}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="admin-user-list">
              {locations.map((location) => (
                <LocationRow
                  key={location.id}
                  chains={chains}
                  location={location}
                  representatives={representatives}
                  saveLocationAction={saveLocationAction}
                />
              ))}
            </div>
          )
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
      </div>
    </>
  );
}

function ChainsSection({
  archiveChainAction,
  chains,
  createChainAction,
  hasFilters,
  search,
  selectedStatus,
  tenantSlug,
  updateChainAction,
}: {
  archiveChainAction: (formData: FormData) => Promise<void>;
  chains: Chain[];
  createChainAction: (formData: FormData) => Promise<void>;
  hasFilters: boolean;
  search: string | null;
  selectedStatus: ChainStatus | null;
  tenantSlug: string;
  updateChainAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("admin.chains");
  const tCommon = useTranslations("common");

  return (
    <>
      <div className="toolbar section-toolbar">
        <AddChainModal action={createChainAction} />
      </div>

      <div className="panel drilldown-panel">
        <div className="panel-toolbar">
          <div className="panel-title-stack">
            <h2>{t("chainList")}</h2>
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
              href={buildChainFilterHref(tenantSlug, null, search)}
            >
              {tCommon("all")}
            </a>
            {chainStatuses.map((status) => (
              <a
                aria-current={selectedStatus === status ? "page" : undefined}
                href={buildChainFilterHref(tenantSlug, status, search)}
                key={status}
              >
                {formatEnumLabel(tCommon, status)}
              </a>
            ))}
          </div>
        </div>

        <form
          action={`/${tenantSlug}/admin/locations`}
          className="filter-form locations-chains-filter-form"
        >
          {selectedStatus ? (
            <input name="chainStatus" type="hidden" value={selectedStatus} />
          ) : null}
          <label>
            {t("search")}
            <input
              defaultValue={search ?? ""}
              name="chainSearch"
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

        {chains.length > 0 ? (
          <div className="admin-user-list">
            {chains.map((chain) => (
              <ChainRow
                key={chain.id}
                chain={chain}
                updateChainAction={updateChainAction}
                archiveChainAction={archiveChainAction}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
            {hasFilters ? (
              <div className="toolbar">
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/admin/locations`}
                >
                  {t("showAllChains")}
                </a>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}

function LocationRow({
  chains,
  location,
  representatives,
  saveLocationAction,
}: {
  chains: Chain[];
  location: Location;
  representatives: TenantUser[];
  saveLocationAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("admin.locations");
  const tCommon = useTranslations("common");
  // A location may point at a chain that is no longer active (so absent from
  // the picker options); keep it selectable so saving doesn't silently drop it.
  const chainOptions =
    location.chain && !chains.some((chain) => chain.id === location.chainId)
      ? [{ id: location.chain.id, name: location.chain.name }, ...chains]
      : chains;

  // Backend returns contacts oldest-first, so the first two map to the fixed
  // primary/secondary slots the form edits.
  const [contact1, contact2] = location.contacts;
  const activeAssignment = location.assignments[0] ?? null;

  const repChoices = representatives.map((rep) => ({
    id: rep.id,
    name: rep.name,
  }));
  // Keep the current representative selectable even if they are no longer an
  // active field rep (and thus absent from the picker), so saving can't drop
  // the assignment behind the admin's back.
  const representativeOptions =
    activeAssignment &&
    !repChoices.some((rep) => rep.id === activeAssignment.representativeUserId)
      ? [
          {
            id: activeAssignment.representative.id,
            name: activeAssignment.representative.name,
          },
          ...repChoices,
        ]
      : repChoices;

  return (
    // Exclusive-accordion disclosure: the shared `name` keeps only one location
    // expanded at a time; collapsed rows show just the name/address summary and
    // the edit form stays hidden until a row is opened.
    <details
      className="admin-user-row admin-user-disclosure"
      name="admin-location"
    >
      <summary className="admin-user-summary">
        <div className="admin-user-summary-lead">
          <h3>{location.name}</h3>
          <p>
            {location.addressLine}, {location.city}
          </p>
        </div>
        <div className="admin-user-summary-meta">
          <span className={`status-pill ${statusTone(location.status)}`}>
            {formatEnumLabel(tCommon, location.status)}
          </span>
          <span className="disclosure-chevron" aria-hidden="true" />
        </div>
      </summary>

      <div className="admin-user-body">
        <form
          action={saveLocationAction}
          className="visit-form compact visit-form-2col"
        >
          <input name="locationId" type="hidden" value={location.id} />
          <label>
            {t("number")}
            <input
              defaultValue={location.externalCode ?? ""}
              name="externalCode"
            />
          </label>
          <label>
            {t("name")}
            <input defaultValue={location.name} name="name" required />
          </label>
          <label>
            {t("address")}
            <input
              defaultValue={location.addressLine}
              name="addressLine"
              required
            />
          </label>
          <label>
            {t("city")}
            <input defaultValue={location.city} name="city" required />
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
            {t("category")}
            <input defaultValue={location.type ?? ""} name="type" />
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

          <input name="contact1Id" type="hidden" value={contact1?.id ?? ""} />
          <label>
            {t("contactPerson")}
            <input defaultValue={contact1?.name ?? ""} name="contact1Name" />
          </label>
          <label>
            {t("phone")}
            <input
              defaultValue={contact1?.phone ?? ""}
              name="contact1Phone"
              type="tel"
            />
          </label>

          <input name="contact2Id" type="hidden" value={contact2?.id ?? ""} />
          <label>
            {t("contactPerson2")}
            <input defaultValue={contact2?.name ?? ""} name="contact2Name" />
          </label>
          <label>
            {t("phone2")}
            <input
              defaultValue={contact2?.phone ?? ""}
              name="contact2Phone"
              type="tel"
            />
          </label>

          <input
            name="assignmentId"
            type="hidden"
            value={activeAssignment?.id ?? ""}
          />
          <input
            name="currentRepId"
            type="hidden"
            value={activeAssignment?.representativeUserId ?? ""}
          />
          <label className="visit-form-full">
            {t("assignedUser")}
            <select
              defaultValue={activeAssignment?.representativeUserId ?? ""}
              name="representativeUserId"
            >
              <option value="">{t("notAssigned")}</option>
              {representativeOptions.map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.name}
                </option>
              ))}
            </select>
          </label>

          <label className="visit-form-full">
            {t("notes")}
            <textarea
              defaultValue={location.notes ?? ""}
              name="notes"
              rows={3}
            />
          </label>

          <PendingSubmitButton
            className="secondary-button visit-form-full"
            pendingLabel={tCommon("saving")}
          >
            {t("saveLocation")}
          </PendingSubmitButton>
        </form>
      </div>
    </details>
  );
}

function ChainRow({
  chain,
  updateChainAction,
  archiveChainAction,
}: {
  chain: Chain;
  updateChainAction: (formData: FormData) => Promise<void>;
  archiveChainAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("admin.chains");
  const tCommon = useTranslations("common");

  const statusSelectOptions = chainStatuses.map((status) => ({
    value: status,
    label: formatEnumLabel(tCommon, status),
  }));

  return (
    // Exclusive-accordion disclosure: the shared `name` keeps only one chain
    // expanded at a time; collapsed rows show just the name/code summary and the
    // edit form stays hidden until a row is opened.
    <details
      className="admin-user-row admin-user-disclosure"
      name="admin-chain"
    >
      <summary className="admin-user-summary">
        <div className="admin-user-summary-lead">
          <h3>{chain.name}</h3>
          {chain.externalCode ? <p>{chain.externalCode}</p> : null}
        </div>
        <div className="admin-user-summary-meta">
          <span className={`status-pill ${statusTone(chain.status)}`}>
            {formatEnumLabel(tCommon, chain.status)}
          </span>
          <span className="disclosure-chevron" aria-hidden="true" />
        </div>
      </summary>

      <div className="admin-user-body">
        <div className="visit-form compact visit-form-2col">
          <InlineFieldEditor
            entityId={chain.id}
            idFieldName="chainId"
            namespace="admin.chains"
            field="name"
            kind="text"
            label={t("name")}
            required
            updateAction={updateChainAction}
            value={chain.name}
            displayText={chain.name}
          />
          <InlineFieldEditor
            entityId={chain.id}
            idFieldName="chainId"
            namespace="admin.chains"
            field="externalCode"
            kind="text"
            label={t("externalCode")}
            updateAction={updateChainAction}
            value={chain.externalCode ?? ""}
            displayText={chain.externalCode ?? ""}
          />
          <InlineFieldEditor
            entityId={chain.id}
            idFieldName="chainId"
            namespace="admin.chains"
            field="notes"
            kind="text"
            label={t("notes")}
            updateAction={updateChainAction}
            value={chain.notes ?? ""}
            displayText={chain.notes ?? ""}
          />
          <InlineFieldEditor
            entityId={chain.id}
            idFieldName="chainId"
            namespace="admin.chains"
            field="status"
            kind="select"
            label={t("status")}
            options={statusSelectOptions}
            required
            updateAction={updateChainAction}
            value={chain.status}
            displayText={formatEnumLabel(tCommon, chain.status)}
          />
        </div>
        <div className="product-row-footer">
          <ArchiveChainButton
            archiveAction={archiveChainAction}
            chainId={chain.id}
            chainName={chain.name}
            chainStatus={chain.status}
          />
        </div>
      </div>
    </details>
  );
}

function buildLocationFilterHref(
  tenantSlug: string,
  filters: {
    status?: LocationStatus | null;
    chain?: string | null;
    search?: string | null;
    view?: string | null;
  },
): string {
  const query = new URLSearchParams();

  if (filters.status) {
    query.set("locStatus", filters.status);
  }

  if (filters.chain) {
    query.set("locChain", filters.chain);
  }

  if (filters.search) {
    query.set("locSearch", filters.search);
  }

  if (filters.view) {
    query.set("locView", filters.view);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/admin/locations${suffix ? `?${suffix}` : ""}`;
}

// Group locations by their chain for the "by chain" view: named chains first
// (alphabetical), the no-chain bucket last — mirrors buildProductGroups on the
// products screen.
function buildLocationGroups(
  locations: Location[],
  noChainLabel: string,
  locale: string,
): { key: string; label: string; items: Location[] }[] {
  const groups = new Map<
    string,
    { key: string; label: string; items: Location[] }
  >();

  for (const location of locations) {
    const key = location.chainId ?? "";
    const group = groups.get(key);

    if (group) {
      group.items.push(location);
    } else {
      groups.set(key, {
        key,
        label: location.chain?.name ?? noChainLabel,
        items: [location],
      });
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === "") {
      return 1;
    }

    if (b.key === "") {
      return -1;
    }

    return a.label.localeCompare(b.label, locale);
  });
}

function buildChainFilterHref(
  tenantSlug: string,
  status: ChainStatus | null,
  search: string | null,
): string {
  const query = new URLSearchParams();

  if (status) {
    query.set("chainStatus", status);
  }

  if (search) {
    query.set("chainSearch", search);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/admin/locations${suffix ? `?${suffix}` : ""}`;
}

function normalizeLocationStatus(
  value: string | undefined,
): LocationStatus | null {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }

  return null;
}

function normalizeChainStatus(value: string | undefined): ChainStatus | null {
  if (value === "active" || value === "archived") {
    return value;
  }

  return null;
}

function normalizeOptionalField(
  value: FormDataEntryValue | null,
): string | null {
  const normalizedValue = typeof value === "string" ? value.trim() : "";

  return normalizedValue || null;
}
