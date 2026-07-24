import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { AddChainModal } from "../../../../components/add-chain-modal";
import { AppShell } from "../../../../components/app-shell";
import { ArchiveChainButton } from "../../../../components/archive-chain-button";
import { ArchiveLocationButton } from "../../../../components/archive-location-button";
import { CategoriesAccordion } from "../../../../components/categories-accordion";
import { CreateLocationModal } from "../../../../components/create-location-modal";
import { PhoneInput } from "../../../../components/phone-input";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import { FilterDisclosure } from "../../../../components/filter-disclosure";
import { FilterField } from "../../../../components/filter-field";
import {
  FilterFooter,
  filterCountTags,
} from "../../../../components/filter-footer";
import { FilterForm } from "../../../../components/filter-form";
import { FilterPills } from "../../../../components/filter-pills";
import { MapIcon, SearchIcon } from "../../../../components/icons";
import { InlineFieldEditor } from "../../../../components/inline-field-editor";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  archiveAdminLocation,
  createAdminChain,
  createAdminLocation,
  createAdminLocationAssignment,
  createAdminLocationContact,
  createLocationCategory,
  deactivateAdminLocationAssignment,
  deleteAdminLocationContact,
  deleteLocationCategory,
  getCurrentSession,
  listAdminChains,
  listAdminLocations,
  listAdminUsers,
  listLocationCategories,
  restoreAdminLocation,
  updateAdminChain,
  updateAdminLocation,
  updateAdminLocationContact,
  updateLocationCategory,
  type Chain,
  type ChainStatus,
  type Location,
  type LocationCategory,
  type LocationStatus,
  type TenantUser,
} from "../../../../lib/api-client";
import {
  formatEnumLabel,
  normalizeFilterValue,
  statusTone,
} from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";
import { buildEntityGroups } from "../../../../lib/grouping";
import { resolveTenantLocale } from "../../../../lib/tenant-locale";

// Locations / Chains — a single admin screen that merges the former Locations
// and Chains sections into two collapsible accordions. Their filters and post-
// action notices share the same route, so every query param is namespaced
// (`loc*` vs `chain*`) to keep the two sections from stepping on each other,
// and every filter link/form carries the other section's params along so using
// one section never resets the other. `open` pins which accordion is expanded.
type AdminLocationsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    open?: string;
    locCreated?: string;
    locUpdated?: string;
    locError?: string;
    locSearch?: string;
    locStatus?: string;
    locChain?: string;
    locView?: string;
    locCatCreated?: string;
    locCatError?: string;
    locCatErrorCount?: string;
    chainCreated?: string;
    chainUpdated?: string;
    chainError?: string;
    chainSearch?: string;
    chainStatus?: string;
  }>;
};

// The list filter can select archived rows; the edit form can only set a live
// status. Archiving is a dedicated action, not a status choice.
const locationStatuses: LocationStatus[] = ["active", "inactive", "archived"];
const editableLocationStatuses: LocationStatus[] = ["active", "inactive"];
const chainStatuses: ChainStatus[] = ["active", "archived"];

export default async function AdminLocationsPage({
  params,
  searchParams,
}: AdminLocationsPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [t, tChains, tAdmin, tCommon, locale, { phoneCountry }] =
    await Promise.all([
      getTranslations("admin.locations"),
      getTranslations("admin.chains"),
      getTranslations("admin"),
      getTranslations("common"),
      getLocale(),
      resolveTenantLocale(tenantSlug),
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
      redirect(`/${tenantSlug}/admin/locations?locError=1&open=locations`);
    }

    const result = await createAdminLocation({
      name,
      addressLine,
      city,
      externalCode: normalizeOptionalField(formData.get("externalCode")),
      categoryId: normalizeOptionalField(formData.get("categoryId")),
      chainId: normalizeOptionalField(formData.get("chainId")),
      notes: normalizeOptionalField(formData.get("notes")),
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/locations?locError=1&open=locations`);
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
        redirect(`/${tenantSlug}/admin/locations?locError=1&open=locations`);
      }
    }

    redirect(`/${tenantSlug}/admin/locations?locCreated=1&open=locations`);
  }

  async function saveLocationAction(formData: FormData) {
    "use server";

    const errorHref = `/${tenantSlug}/admin/locations?locError=1&open=locations`;
    const locationId = getFormString(formData, "locationId").trim();
    const name = getFormString(formData, "name").trim();
    const addressLine = getFormString(formData, "addressLine").trim();
    const city = getFormString(formData, "city").trim();
    const externalCode = normalizeOptionalField(formData.get("externalCode"));
    // The category <select> is only rendered when the category toggle is on
    // (see LocationRow), so `null` here means "control absent, leave the
    // location's category untouched" — distinct from "" ("present but
    // cleared to no category"). Only send categoryId when the control was
    // actually in the form, or a save with the toggle off would silently
    // wipe the location's category.
    const categoryIdRaw = formData.get("categoryId");
    const chainId = normalizeOptionalField(formData.get("chainId"));
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
      ...(categoryIdRaw !== null
        ? { categoryId: normalizeOptionalField(categoryIdRaw) }
        : {}),
      chainId,
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

    redirect(`/${tenantSlug}/admin/locations?locUpdated=1&open=locations`);
  }

  async function archiveLocationAction(formData: FormData) {
    "use server";

    const locationId = getFormString(formData, "locationId").trim();
    const errorHref = `/${tenantSlug}/admin/locations?locError=1&open=locations`;

    if (!locationId) {
      redirect(errorHref);
    }

    const result = await archiveAdminLocation(locationId);

    if (!result.ok) {
      redirect(errorHref);
    }

    redirect(`/${tenantSlug}/admin/locations?locUpdated=1&open=locations`);
  }

  async function restoreLocationAction(formData: FormData) {
    "use server";

    const locationId = getFormString(formData, "locationId").trim();
    const errorHref = `/${tenantSlug}/admin/locations?locError=1&open=locations`;

    if (!locationId) {
      redirect(errorHref);
    }

    const result = await restoreAdminLocation(locationId);

    if (!result.ok) {
      redirect(errorHref);
    }

    redirect(
      `/${tenantSlug}/admin/locations?locUpdated=1&open=locations&locStatus=archived`,
    );
  }

  async function createChainAction(formData: FormData) {
    "use server";

    const name = getFormString(formData, "name").trim();
    const externalCode = normalizeOptionalField(formData.get("externalCode"));
    const notes = normalizeOptionalField(formData.get("notes"));

    if (!name) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1&open=chains`);
    }

    const result = await createAdminChain({ name, externalCode, notes });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1&open=chains`);
    }

    redirect(`/${tenantSlug}/admin/locations?chainCreated=1&open=chains`);
  }

  async function updateChainAction(formData: FormData) {
    "use server";

    const chainId = getFormString(formData, "chainId").trim();

    if (!chainId) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1&open=chains`);
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
        redirect(`/${tenantSlug}/admin/locations?chainError=1&open=chains`);
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
        redirect(`/${tenantSlug}/admin/locations?chainError=1&open=chains`);
      }
      input.status = status;
    }

    const result = await updateAdminChain(chainId, input);

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1&open=chains`);
    }

    redirect(`/${tenantSlug}/admin/locations?chainUpdated=1&open=chains`);
  }

  async function archiveChainAction(formData: FormData) {
    "use server";

    const chainId = getFormString(formData, "chainId").trim();

    if (!chainId) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1&open=chains`);
    }

    const result = await updateAdminChain(chainId, { status: "archived" });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/locations?chainError=1&open=chains`);
    }

    redirect(`/${tenantSlug}/admin/locations?chainUpdated=1&open=chains`);
  }

  async function createLocationCategoryAction(formData: FormData) {
    "use server";

    const name = getFormString(formData, "name").trim();

    if (!name) {
      redirect(`/${tenantSlug}/admin/locations?locCatError=1`);
    }

    const result = await createLocationCategory({ name });

    if (!result.ok) {
      redirect(locationCategoryErrorHref(tenantSlug, result));
    }

    redirect(`/${tenantSlug}/admin/locations?locCatCreated=1`);
  }

  async function updateLocationCategoryAction(formData: FormData) {
    "use server";

    const categoryId = getFormString(formData, "categoryId").trim();
    const name = getFormString(formData, "name").trim();

    if (!categoryId || !name) {
      redirect(`/${tenantSlug}/admin/locations?locCatError=1`);
    }

    const result = await updateLocationCategory(categoryId, { name });

    if (!result.ok) {
      redirect(locationCategoryErrorHref(tenantSlug, result));
    }

    redirect(`/${tenantSlug}/admin/locations?locCatCreated=updated`);
  }

  async function deleteLocationCategoryAction(formData: FormData) {
    "use server";

    const categoryId = getFormString(formData, "categoryId").trim();

    if (!categoryId) {
      redirect(`/${tenantSlug}/admin/locations?locCatError=1`);
    }

    const result = await deleteLocationCategory(categoryId);

    if (!result.ok) {
      redirect(locationCategoryErrorHref(tenantSlug, result));
    }

    redirect(`/${tenantSlug}/admin/locations?locCatCreated=removed`);
  }

  const [
    locationsResult,
    chainsResult,
    pickerChainsResult,
    usersResult,
    categoriesResult,
    sessionResult,
  ] = await Promise.all([
    listAdminLocations(locQuery.toString()),
    listAdminChains(chainQuery.toString()),
    // The location editor's chain picker always offers active chains,
    // regardless of how the Chains section itself is currently filtered.
    // When that section is unfiltered its (all-status, same page cap) result
    // already contains them, so skip the second fetch and derive in memory.
    chainHasFilters ? listAdminChains("pageSize=100&status=active") : null,
    listAdminUsers(),
    listLocationCategories(),
    getCurrentSession(),
  ]);

  const categories: LocationCategory[] = categoriesResult.ok
    ? categoriesResult.data
    : [];
  // Absent/unreadable session fails open (category field shown) rather than
  // silently hiding a field the tenant actually has enabled.
  const locationCategoriesEnabled = sessionResult.ok
    ? sessionResult.data.locationCategoriesEnabled
    : true;

  const pickerChains = pickerChainsResult
    ? pickerChainsResult.ok
      ? pickerChainsResult.data.items
      : []
    : chainsResult.ok
      ? chainsResult.data.items.filter((chain) => chain.status === "active")
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
  // Which accordion is expanded: the `open` param pins the section the user is
  // working in (every filter link/form and action redirect sets it, and it
  // survives the success notices' auto-dismiss URL rewrite, which would
  // otherwise collapse the section under the user ~5s after an action). On
  // URLs without it (bookmarks, shared links) fall back to inferring the busy
  // section from its params; Locations wins ties and is the default.
  const openSection =
    pageState.open === "locations" || pageState.open === "chains"
      ? pageState.open
      : null;
  const locationsOpen = openSection
    ? openSection === "locations"
    : locActive || !chainActive;
  const chainsOpen = openSection ? openSection === "chains" : chainActive;

  // Each section's links/forms re-emit the other section's params so filtering
  // one never silently resets the other.
  const chainCarryParams: Record<string, string> = {};
  if (chainStatus) {
    chainCarryParams.chainStatus = chainStatus;
  }
  if (chainSearch) {
    chainCarryParams.chainSearch = chainSearch;
  }
  const locCarryParams: Record<string, string> = {};
  if (locStatus) {
    locCarryParams.locStatus = locStatus;
  }
  if (locChain) {
    locCarryParams.locChain = locChain;
  }
  if (locSearch) {
    locCarryParams.locSearch = locSearch;
  }
  if (locGroupByChain) {
    locCarryParams.locView = "chain";
  }

  // The three location-category server actions redirect with a specific
  // `locCatError` reason (see locationCategoryErrorHref); render the matching
  // copy here rather than the generic categoryError* fallback.
  const locCatErrorCount = Number(pageState.locCatErrorCount);
  const locCatNotice =
    pageState.locCatError === "exists"
      ? {
          ariaLabel: t("categoryExistsErrorAria"),
          eyebrow: t("categoryExistsErrorEyebrow"),
          title: t("categoryExistsErrorTitle"),
          body: t("categoryExistsErrorBody"),
        }
      : pageState.locCatError === "inUse"
        ? {
            ariaLabel: t("categoryInUseErrorAria"),
            eyebrow: t("categoryInUseErrorEyebrow"),
            title: t("categoryInUseErrorTitle"),
            body: t("categoryInUseErrorBody", {
              count: Number.isFinite(locCatErrorCount) ? locCatErrorCount : 0,
            }),
          }
        : pageState.locCatError
          ? {
              ariaLabel: t("categoryErrorAria"),
              eyebrow: t("categoryErrorEyebrow"),
              title: t("categoryErrorTitle"),
              body: t("categoryErrorBody"),
            }
          : null;

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
                // Archived rows keep their pre-archive status, so status alone
                // would count them (the archived filter loads only such rows).
                count: locationsResult.data.items.filter(
                  (location) =>
                    location.status === "active" && !location.archived,
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

      {pageState.locCatCreated ? (
        <DismissableNotice
          ariaLabel={t("categoryCreatedAria")}
          clearParams={["locCatCreated"]}
          eyebrow={t("categoryCreatedEyebrow")}
          title={
            pageState.locCatCreated === "updated"
              ? t("updatedCategoryTitle")
              : pageState.locCatCreated === "removed"
                ? t("removedCategoryTitle")
                : t("createdCategoryTitle")
          }
          tone="success"
        />
      ) : null}

      {locCatNotice ? (
        <DismissableNotice
          ariaLabel={locCatNotice.ariaLabel}
          body={locCatNotice.body}
          clearParams={["locCatError", "locCatErrorCount"]}
          eyebrow={locCatNotice.eyebrow}
          title={locCatNotice.title}
          tone="danger"
        />
      ) : null}

      {locationCategoriesEnabled ? (
        <CategoriesAccordion
          categories={categories}
          createAction={createLocationCategoryAction}
          defaultOpen={Boolean(
            pageState.locCatCreated || pageState.locCatError,
          )}
          deleteAction={deleteLocationCategoryAction}
          namespace="admin.locations"
          updateAction={updateLocationCategoryAction}
        />
      ) : null}

      <div className="section-stack">
        <details className="panel panel-collapsible" open={locationsOpen}>
          <summary className="panel-summary">
            <h2>{t("title")}</h2>
          </summary>

          <div className="section-body">
            <SectionNotices
              clearPrefix="loc"
              created={pageState.locCreated}
              error={pageState.locError}
              t={t}
              updated={pageState.locUpdated}
            />

            {locationsResult.ok ? (
              <LocationsSection
                allChains={chainsResult.ok ? chainsResult.data.items : []}
                archiveLocationAction={archiveLocationAction}
                carryParams={chainCarryParams}
                categories={categories}
                chains={pickerChains}
                createLocationAction={createLocationAction}
                groupByChain={locGroupByChain}
                hasFilters={locHasFilters}
                locale={locale}
                locationCategoriesEnabled={locationCategoriesEnabled}
                locations={locationsResult.data.items}
                phoneCountry={phoneCountry}
                representatives={representatives}
                restoreLocationAction={restoreLocationAction}
                saveLocationAction={saveLocationAction}
                search={locSearch}
                selectedChain={locChain}
                selectedStatus={locStatus}
                tenantSlug={tenantSlug}
                total={locationsResult.data.total}
              />
            ) : (
              <div className="empty-state-panel">
                <h2>{t("notConnectedTitle")}</h2>
                <p>{locationsResult.message}</p>
                <div className="toolbar">
                  <a className="primary-button" href={`/${tenantSlug}/login`}>
                    {tCommon("signIn")}
                  </a>
                </div>
              </div>
            )}
          </div>
        </details>

        <details className="panel panel-collapsible" open={chainsOpen}>
          <summary className="panel-summary">
            <h2>{tChains("title")}</h2>
          </summary>

          <div className="section-body">
            <SectionNotices
              clearPrefix="chain"
              created={pageState.chainCreated}
              error={pageState.chainError}
              t={tChains}
              updated={pageState.chainUpdated}
            />

            {chainsResult.ok ? (
              <ChainsSection
                archiveChainAction={archiveChainAction}
                carryParams={locCarryParams}
                chains={chainsResult.data.items}
                createChainAction={createChainAction}
                hasFilters={chainHasFilters}
                search={chainSearch}
                selectedStatus={chainStatus}
                tenantSlug={tenantSlug}
                total={chainsResult.data.total}
                updateChainAction={updateChainAction}
              />
            ) : (
              <div className="empty-state-panel">
                <h2>{tChains("notConnectedTitle")}</h2>
                <p>{chainsResult.message}</p>
                <div className="toolbar">
                  <a className="primary-button" href={`/${tenantSlug}/login`}>
                    {tCommon("signIn")}
                  </a>
                </div>
              </div>
            )}
          </div>
        </details>
      </div>
    </AppShell>
  );
}

function LocationsSection({
  allChains,
  archiveLocationAction,
  carryParams,
  categories,
  chains,
  createLocationAction,
  groupByChain,
  hasFilters,
  locale,
  locationCategoriesEnabled,
  locations,
  phoneCountry,
  representatives,
  restoreLocationAction,
  saveLocationAction,
  search,
  selectedChain,
  selectedStatus,
  tenantSlug,
  total,
}: {
  allChains: Chain[];
  archiveLocationAction: (formData: FormData) => Promise<void>;
  carryParams: Record<string, string>;
  categories: LocationCategory[];
  chains: Chain[];
  createLocationAction: (formData: FormData) => Promise<void>;
  groupByChain: boolean;
  hasFilters: boolean;
  locale: string;
  locationCategoriesEnabled: boolean;
  locations: Location[];
  phoneCountry: string | null;
  representatives: TenantUser[];
  restoreLocationAction: (formData: FormData) => Promise<void>;
  saveLocationAction: (formData: FormData) => Promise<void>;
  search: string | null;
  selectedChain: string | null;
  selectedStatus: LocationStatus | null;
  tenantSlug: string;
  total: number;
}) {
  const t = useTranslations("admin.locations");
  const tCommon = useTranslations("common");

  const viewParam = groupByChain ? "chain" : null;
  const baseParams = { ...carryParams, open: "locations" };

  // Keep the active chain filter selectable even when it points at a chain the
  // active-chain picker doesn't offer (e.g. an archived chain): recover its
  // name from the Chains section's list, or failing that from any fetched
  // location that belongs to it.
  const chainFilterOptions =
    selectedChain && !chains.some((chain) => chain.id === selectedChain)
      ? [
          {
            id: selectedChain,
            name:
              allChains.find((chain) => chain.id === selectedChain)?.name ??
              locations.find((location) => location.chainId === selectedChain)
                ?.chain?.name ??
              selectedChain,
          },
          ...chains,
        ]
      : chains;
  const locationGroups = groupByChain
    ? buildEntityGroups(
        locations,
        (location) => location.chainId,
        (location) => location.chain?.name,
        t("chainNone"),
        locale,
      )
    : [];

  return (
    <>
      <div className="toolbar">
        <CreateLocationModal
          action={createLocationAction}
          categories={categories}
          chains={chains}
          locationCategoriesEnabled={locationCategoriesEnabled}
          representatives={representatives}
        />
      </div>

      {/* No heading of its own: the accordion this sits in is already titled. */}
      <div className="panel drilldown-panel">
        <FilterForm action={`/${tenantSlug}/admin/locations`}>
          {/* Not filters: which accordion section is open, and the chains
              section's own filters, both carried so filtering the locations
              list leaves the rest of the page as it was. */}
          <input name="open" type="hidden" value="locations" />
          {Object.entries(carryParams).map(([name, value]) => (
            <input key={name} name={name} type="hidden" value={value} />
          ))}

          <div className="panel-toolbar">
            <div className="panel-toolbar-filters">
              <FilterPills
                ariaLabel={t("statusFiltersAria")}
                name="locStatus"
                options={[
                  { label: tCommon("all"), value: "" },
                  ...locationStatuses.map((status) => ({
                    label: formatEnumLabel(tCommon, status),
                    value: status,
                  })),
                ]}
                value={selectedStatus ?? ""}
              />
              <FilterPills
                ariaLabel={t("viewFiltersAria")}
                name="locView"
                options={[
                  { label: t("viewList"), value: "" },
                  { label: t("viewByChain"), value: "chain" },
                ]}
                value={viewParam ?? ""}
              />
            </div>
          </div>

          <FilterDisclosure
            hasFilters={hasFilters}
            label={tCommon("filtersLabel")}
          >
            <div className="filter-form location-filter-form">
              <FilterField icon={<MapIcon />} label={t("chain")}>
                <select defaultValue={selectedChain ?? ""} name="locChain">
                  <option value="">{tCommon("anyOption")}</option>
                  {chainFilterOptions.map((chain) => (
                    <option key={chain.id} value={chain.id}>
                      {chain.name}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField icon={<SearchIcon />} label={t("search")}>
                <input
                  defaultValue={search ?? ""}
                  name="locSearch"
                  placeholder={t("searchPlaceholder")}
                  type="text"
                />
              </FilterField>
              <FilterFooter
                resetHref={
                  hasFilters
                    ? buildFilterHref(tenantSlug, baseParams)
                    : undefined
                }
                resetLabel={tCommon("reset")}
                resultText={t.rich("filterResultCount", {
                  ...filterCountTags,
                  count: total,
                })}
              />
            </div>
          </FilterDisclosure>
        </FilterForm>

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
                        archiveLocationAction={archiveLocationAction}
                        categories={categories}
                        chains={chains}
                        location={location}
                        locationCategoriesEnabled={locationCategoriesEnabled}
                        phoneCountry={phoneCountry}
                        representatives={representatives}
                        restoreLocationAction={restoreLocationAction}
                        saveLocationAction={saveLocationAction}
                        tenantSlug={tenantSlug}
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
                  archiveLocationAction={archiveLocationAction}
                  categories={categories}
                  chains={chains}
                  location={location}
                  locationCategoriesEnabled={locationCategoriesEnabled}
                  phoneCountry={phoneCountry}
                  representatives={representatives}
                  restoreLocationAction={restoreLocationAction}
                  saveLocationAction={saveLocationAction}
                  tenantSlug={tenantSlug}
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
                  href={buildFilterHref(tenantSlug, baseParams)}
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
  carryParams,
  chains,
  createChainAction,
  hasFilters,
  search,
  selectedStatus,
  tenantSlug,
  total,
  updateChainAction,
}: {
  archiveChainAction: (formData: FormData) => Promise<void>;
  carryParams: Record<string, string>;
  chains: Chain[];
  createChainAction: (formData: FormData) => Promise<void>;
  hasFilters: boolean;
  search: string | null;
  selectedStatus: ChainStatus | null;
  tenantSlug: string;
  total: number;
  updateChainAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("admin.chains");
  const tCommon = useTranslations("common");

  const baseParams = { ...carryParams, open: "chains" };

  return (
    <>
      <div className="toolbar">
        <AddChainModal action={createChainAction} />
      </div>

      {/* No heading of its own: the accordion this sits in is already titled. */}
      <div className="panel drilldown-panel">
        <FilterForm action={`/${tenantSlug}/admin/locations`}>
          {/* Not filters: which accordion section is open, and the locations
              section's own filters, both carried so filtering the chains list
              leaves the rest of the page as it was. */}
          <input name="open" type="hidden" value="chains" />
          {Object.entries(carryParams).map(([name, value]) => (
            <input key={name} name={name} type="hidden" value={value} />
          ))}

          <div className="panel-toolbar">
            <FilterPills
              ariaLabel={t("statusFiltersAria")}
              name="chainStatus"
              options={[
                { label: tCommon("all"), value: "" },
                ...chainStatuses.map((status) => ({
                  label: formatEnumLabel(tCommon, status),
                  value: status,
                })),
              ]}
              value={selectedStatus ?? ""}
            />
          </div>

          <FilterDisclosure
            hasFilters={hasFilters}
            label={tCommon("filtersLabel")}
          >
            <div className="filter-form locations-chains-filter-form">
              <FilterField icon={<SearchIcon />} label={t("search")}>
                <input
                  defaultValue={search ?? ""}
                  name="chainSearch"
                  placeholder={t("searchPlaceholder")}
                  type="text"
                />
              </FilterField>
              <FilterFooter
                resetHref={
                  hasFilters
                    ? buildFilterHref(tenantSlug, baseParams)
                    : undefined
                }
                resetLabel={tCommon("reset")}
                resultText={t.rich("filterResultCount", {
                  ...filterCountTags,
                  count: total,
                })}
              />
            </div>
          </FilterDisclosure>
        </FilterForm>

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
                  href={buildFilterHref(tenantSlug, baseParams)}
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
  archiveLocationAction,
  categories,
  chains,
  location,
  locationCategoriesEnabled,
  phoneCountry,
  representatives,
  restoreLocationAction,
  saveLocationAction,
  tenantSlug,
}: {
  archiveLocationAction: (formData: FormData) => Promise<void>;
  categories: LocationCategory[];
  chains: Chain[];
  location: Location;
  locationCategoriesEnabled: boolean;
  phoneCountry: string | null;
  representatives: TenantUser[];
  restoreLocationAction: (formData: FormData) => Promise<void>;
  saveLocationAction: (formData: FormData) => Promise<void>;
  tenantSlug: string;
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

  const displayStatus = location.archived ? "archived" : location.status;

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
          <span className={`status-pill ${statusTone(displayStatus)}`}>
            {formatEnumLabel(tCommon, displayStatus)}
          </span>
          <span className="disclosure-chevron" aria-hidden="true" />
        </div>
      </summary>

      <div className="admin-user-body">
        <a
          className="secondary-button"
          href={`/${tenantSlug}/admin/locations/${location.id}`}
        >
          {t("viewDetails")}
        </a>

        {/* The backend refuses writes to an archived row (404), so the edit
            form is only offered for live rows — restore first, then edit. */}
        {!location.archived ? (
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
            {locationCategoriesEnabled ? (
              <label>
                {t("category")}
                <select
                  defaultValue={location.categoryId ?? ""}
                  name="categoryId"
                >
                  <option value="">{t("noCategoryOption")}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              {t("status")}
              <select defaultValue={location.status} name="status" required>
                {editableLocationStatuses.map((status) => (
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
              <PhoneInput
                countryRequiredMessage={tCommon("phoneInternationalRequired")}
                defaultValue={contact1?.phone ?? null}
                invalidMessage={tCommon("phoneInvalid")}
                name="contact1Phone"
                phoneCountry={phoneCountry}
              />
            </label>

            <input name="contact2Id" type="hidden" value={contact2?.id ?? ""} />
            <label>
              {t("contactPerson2")}
              <input defaultValue={contact2?.name ?? ""} name="contact2Name" />
            </label>
            <label>
              {t("phone2")}
              <PhoneInput
                countryRequiredMessage={tCommon("phoneInternationalRequired")}
                defaultValue={contact2?.phone ?? null}
                invalidMessage={tCommon("phoneInvalid")}
                name="contact2Phone"
                phoneCountry={phoneCountry}
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
        ) : null}

        {location.archived ? (
          <form action={restoreLocationAction} className="product-row-footer">
            <input name="locationId" type="hidden" value={location.id} />
            <PendingSubmitButton
              className="secondary-button"
              pendingLabel={tCommon("saving")}
            >
              {t("restoreLocation")}
            </PendingSubmitButton>
          </form>
        ) : (
          <div className="product-row-footer">
            <ArchiveLocationButton
              archiveAction={archiveLocationAction}
              locationId={location.id}
              locationName={location.name}
            />
          </div>
        )}
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

// One href builder for both sections: callers pass already-namespaced params
// (`loc*`, `chain*`, `open`); empty values are dropped.
function buildFilterHref(
  tenantSlug: string,
  params: Record<string, string | null | undefined>,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }

  const suffix = query.toString();

  return `/${tenantSlug}/admin/locations${suffix ? `?${suffix}` : ""}`;
}

// The created/updated/error notice triad both sections render above their
// content; `t` is the section's namespace translator (admin.locations /
// admin.chains — both define the same notice keys).
function SectionNotices({
  clearPrefix,
  created,
  error,
  t,
  updated,
}: {
  clearPrefix: "loc" | "chain";
  created?: string;
  error?: string;
  t: (
    key:
      | "createdAria"
      | "createdEyebrow"
      | "createdTitle"
      | "updatedAria"
      | "updatedEyebrow"
      | "updatedTitle"
      | "errorAria"
      | "errorBody"
      | "errorEyebrow"
      | "errorTitle",
  ) => string;
  updated?: string;
}) {
  return (
    <>
      {created ? (
        <DismissableNotice
          ariaLabel={t("createdAria")}
          clearParams={[`${clearPrefix}Created`]}
          eyebrow={t("createdEyebrow")}
          title={t("createdTitle")}
          tone="success"
        />
      ) : null}

      {updated ? (
        <DismissableNotice
          ariaLabel={t("updatedAria")}
          clearParams={[`${clearPrefix}Updated`]}
          eyebrow={t("updatedEyebrow")}
          title={t("updatedTitle")}
          tone="success"
        />
      ) : null}

      {error ? (
        <DismissableNotice
          ariaLabel={t("errorAria")}
          body={t("errorBody")}
          clearParams={[`${clearPrefix}Error`]}
          eyebrow={t("errorEyebrow")}
          title={t("errorTitle")}
          tone="danger"
        />
      ) : null}
    </>
  );
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

// Distinguishes the two actionable location-category conflicts the backend
// reports (see LocationCategoriesService.categoryExistsConflict /
// categoryInUseConflict) so the page can render a specific reason instead of
// a generic failure notice; anything else (network error, 500, a category
// deleted by someone else, ...) falls back to `locCatError=1`.
function locationCategoryErrorHref(
  tenantSlug: string,
  result: { code?: string; details?: unknown },
): string {
  if (result.code === "LOCATION_CATEGORY_EXISTS") {
    return `/${tenantSlug}/admin/locations?locCatError=exists`;
  }

  if (result.code === "LOCATION_CATEGORY_IN_USE") {
    const details = result.details as { locationCount?: unknown } | null;
    const locationCount =
      typeof details?.locationCount === "number" ? details.locationCount : null;

    if (locationCount !== null) {
      return `/${tenantSlug}/admin/locations?locCatError=inUse&locCatErrorCount=${locationCount}`;
    }
  }

  return `/${tenantSlug}/admin/locations?locCatError=1`;
}
