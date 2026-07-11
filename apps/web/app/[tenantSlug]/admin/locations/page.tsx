import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { CreateLocationModal } from "../../../../components/create-location-modal";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  createAdminLocation,
  createAdminLocationAssignment,
  createAdminLocationContact,
  deactivateAdminLocationAssignment,
  deleteAdminLocationContact,
  listAdminChains,
  listAdminLocations,
  listAdminUsers,
  updateAdminLocation,
  updateAdminLocationContact,
  type Chain,
  type Location,
  type LocationStatus,
  type TenantUser,
} from "../../../../lib/api-client";
import {
  formatEnumLabel,
  normalizeFilterValue,
  statusTone,
} from "../../../../lib/format";

type AdminLocationsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    created?: string;
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

  async function createLocationAction(formData: FormData) {
    "use server";

    const name = String(formData.get("name") ?? "").trim();
    const addressLine = String(formData.get("addressLine") ?? "").trim();
    const city = String(formData.get("city") ?? "").trim();

    if (!name || !addressLine || !city) {
      redirect(`/${tenantSlug}/admin/locations?error=1`);
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
      redirect(`/${tenantSlug}/admin/locations?error=1`);
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
        redirect(`/${tenantSlug}/admin/locations?error=1`);
      }
    }

    redirect(`/${tenantSlug}/admin/locations?created=1`);
  }

  async function saveLocationAction(formData: FormData) {
    "use server";

    const errorHref = `/${tenantSlug}/admin/locations?error=1`;
    const locationId = String(formData.get("locationId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const addressLine = String(formData.get("addressLine") ?? "").trim();
    const city = String(formData.get("city") ?? "").trim();
    const externalCode = normalizeOptionalField(formData.get("externalCode"));
    // "Category" reuses the existing free-text `type` column.
    const type = normalizeOptionalField(formData.get("type"));
    const chainId = normalizeOptionalField(formData.get("chainId"));
    const region = normalizeOptionalField(formData.get("region"));
    const notes = normalizeOptionalField(formData.get("notes"));
    const status = normalizeStatus(String(formData.get("status") ?? ""));

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
      const contactName = String(
        formData.get(`contact${slot}Name`) ?? "",
      ).trim();
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

    redirect(`/${tenantSlug}/admin/locations?updated=1`);
  }

  const [locationsResult, chainsResult, usersResult] = await Promise.all([
    listAdminLocations(query.toString()),
    listAdminChains("pageSize=100&status=active"),
    listAdminUsers(),
  ]);
  const chains = chainsResult.ok ? chainsResult.data.items : [];
  // Only active field representatives can be assigned to a location (the API
  // rejects anyone else), so the picker offers exactly those.
  const representatives = usersResult.ok
    ? usersResult.data.items.filter(
        (user) =>
          user.status === "active" &&
          user.roleCodes.includes("field_representative"),
      )
    : [];

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
        <div className="toolbar">
          <CreateLocationModal
            action={createLocationAction}
            chains={chains}
            representatives={representatives}
          />
        </div>
      </header>

      {pageState.created ? (
        <section className="notice-panel success" aria-label={t("createdAria")}>
          <div>
            <p className="eyebrow">{t("createdEyebrow")}</p>
            <h2>{t("createdTitle")}</h2>
            <p>{t("createdBody")}</p>
          </div>
        </section>
      ) : null}

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
                representatives={representatives}
                saveLocationAction={saveLocationAction}
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
        <form action={saveLocationAction} className="visit-form compact">
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

          <input
            name="contact1Id"
            type="hidden"
            value={contact1?.id ?? ""}
          />
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

          <input
            name="contact2Id"
            type="hidden"
            value={contact2?.id ?? ""}
          />
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
          <label>
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

          <label>
            {t("notes")}
            <textarea
              defaultValue={location.notes ?? ""}
              name="notes"
              rows={3}
            />
          </label>

          <PendingSubmitButton
            className="secondary-button"
            pendingLabel={tCommon("saving")}
          >
            {t("saveLocation")}
          </PendingSubmitButton>
        </form>
      </div>
    </details>
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
