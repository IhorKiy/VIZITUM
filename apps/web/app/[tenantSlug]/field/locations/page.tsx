import { getLocale, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { BackLink } from "../../../../components/back-link";
import { FilterDisclosure } from "../../../../components/filter-disclosure";
import { FilterField } from "../../../../components/filter-field";
import {
  FilterFooter,
  filterCountTags,
} from "../../../../components/filter-footer";
import { FilterForm } from "../../../../components/filter-form";
import { FilterPills } from "../../../../components/filter-pills";
import { MapPinIcon, SearchIcon } from "../../../../components/icons";
import {
  getCurrentSession,
  // Same GET /locations endpoint as listLocations(), just with caller-supplied
  // query params — not admin-permission-gated despite the name.
  listAdminLocations,
  listAllLocations,
  type LocationStatus,
} from "../../../../lib/api-client";
import {
  backOrigin,
  resolveBackTarget,
  withBackOrigin,
} from "../../../../lib/back-navigation";
import { buildLocationFieldOptions } from "../../../../lib/filter-options";
import {
  formatEnumLabel,
  normalizeFilterValue,
  normalizeLocationStatus,
  statusTone,
} from "../../../../lib/format";
import { INPUT_LIMITS } from "../../../../lib/input-limits";

type FieldLocationsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    city?: string;
    from?: string;
    search?: string;
    status?: string;
  }>;
};

const locationStatuses: LocationStatus[] = ["active", "inactive", "archived"];

export default async function FieldLocationsPage({
  params,
  searchParams,
}: FieldLocationsPageProps) {
  const { tenantSlug } = await params;
  const [locale, t, tBack, tField, tCommon] = await Promise.all([
    getLocale(),
    getTranslations("field.locations"),
    getTranslations("common.back"),
    getTranslations("field"),
    getTranslations("common"),
  ]);
  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("locations.read")
  ) {
    return (
      <AppShell activeArea="field-menu" tenantSlug={tenantSlug}>
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("permissionBody")}</p>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>

        <section
          aria-label={t("permissionStatusAria")}
          className="notice-panel"
        >
          <div>
            <p className="eyebrow">{t("permissionRequiredEyebrow")}</p>
            <h2>{t("permissionRequiredTitle")}</h2>
            <p>{t("permissionRequiredBody")}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const pageState = await searchParams;
  // Opened from the field menu, which hangs off every field screen, so where
  // "back" lands is whatever screen the menu was opened on.
  const backTarget = resolveBackTarget(tenantSlug, pageState.from, {
    href: `/${tenantSlug}/field`,
    labelKey: "home",
  });
  const selectedStatus = normalizeLocationStatus(pageState.status);
  const selectedCity = normalizeFilterValue(pageState.city);
  const search = normalizeFilterValue(pageState.search);
  const query = new URLSearchParams({ pageSize: "100" });
  const hasFilters = Boolean(selectedStatus || selectedCity || search);

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (selectedCity) {
    query.set("city", selectedCity);
  }

  if (search) {
    query.set("search", search);
  }

  const [locationsResult, allLocationsResult] = await Promise.all([
    listAdminLocations(query.toString()),
    listAllLocations(),
  ]);
  const allLocations = allLocationsResult.ok ? allLocationsResult.data : [];

  if (!locationsResult.ok) {
    return (
      <AppShell activeArea="field-menu" tenantSlug={tenantSlug}>
        <BackLink href={backTarget.href} label={tBack(backTarget.labelKey)} />
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("title")}</h1>
          </div>
        </header>

        <section
          aria-label={tCommon("notice.apiStatus")}
          className="notice-panel"
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
  const locationCategoriesEnabled =
    sessionResult.data.locationCategoriesEnabled;
  const cityOptions = buildLocationFieldOptions(allLocations, "city", locale);
  // The location card is also reachable from today's route and the route
  // editor, so it can't guess where to return — this list hands it the filter
  // state the rep leaves behind.
  // withBackOrigin, not backOrigin: this is an outgoing link that has to keep
  // the opener, not a tenant-relative origin being built.
  const listHref = `/${tenantSlug}/field/locations`;
  const resetFiltersHref = pageState.from
    ? withBackOrigin(listHref, pageState.from)
    : listHref;
  const origin = backOrigin("/field/locations", {
    city: selectedCity,
    from: pageState.from,
    search,
    status: selectedStatus,
  });

  return (
    <AppShell activeArea="field-menu" tenantSlug={tenantSlug}>
      <BackLink href={backTarget.href} label={tBack(backTarget.labelKey)} />
      <header className="page-header">
        <div>
          <p className="eyebrow">{tField("flowEyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </div>
      </header>

      <section aria-label={t("listAria")} className="panel drilldown-panel">
        <FilterForm action={`/${tenantSlug}/field/locations`}>
          {/* FilterForm rebuilds the URL from this form's own fields, so the
              opener has to travel as one or filtering would strip it. */}
          {pageState.from ? (
            <input name="from" type="hidden" value={pageState.from} />
          ) : null}
          <div className="panel-toolbar">
            <FilterPills
              ariaLabel={t("statusFiltersAria")}
              name="status"
              options={[
                { label: tCommon("all"), value: "" },
                ...locationStatuses.map((status) => ({
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
            <div className="filter-form locations-filter-form">
              <FilterField icon={<SearchIcon />} label={t("search")}>
                <input
                  defaultValue={search ?? ""}
                  maxLength={INPUT_LIMITS.search}
                  name="search"
                  placeholder={t("searchPlaceholder")}
                  type="search"
                />
              </FilterField>
              <FilterField icon={<MapPinIcon />} label={t("city")}>
                <select defaultValue={selectedCity ?? ""} name="city">
                  <option value="">{tCommon("anyOption")}</option>
                  {cityOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterFooter
                resetHref={hasFilters ? resetFiltersHref : undefined}
                resetLabel={tCommon("reset")}
                resultText={t.rich("filterResultCount", {
                  ...filterCountTags,
                  count: locationsResult.data.total,
                })}
              />
            </div>
          </FilterDisclosure>
        </FilterForm>

        {locations.length > 0 ? (
          <div className="field-card-list">
            {locations.map((location) => (
              <article className="location-mini-card" key={location.id}>
                <header>
                  <div>
                    <h3>{location.name}</h3>
                    <p>
                      {[location.addressLine, location.city]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                  <span
                    className={`status-pill ${statusTone(location.status)}`}
                  >
                    {formatEnumLabel(tCommon, location.status)}
                  </span>
                </header>
                <p className="visit-meta">
                  {locationCategoriesEnabled && location.category
                    ? formatEnumLabel(tCommon, location.category.name)
                    : t("noSegmentDetails")}
                </p>
                <a
                  className="list-card-open"
                  href={withBackOrigin(
                    `/${tenantSlug}/field/locations/${location.id}`,
                    origin,
                  )}
                >
                  {t("viewLocation")}
                </a>
              </article>
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
                  href={`/${tenantSlug}/field/locations`}
                >
                  {t("showAll")}
                </a>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </AppShell>
  );
}
