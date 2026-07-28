import { getTranslations } from "next-intl/server";

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
import { SearchIcon, TagIcon } from "../../../../components/icons";
import {
  getCurrentSession,
  // Same GET /products endpoint as listProducts(), just with caller-supplied
  // query params — not admin-permission-gated despite the name.
  listAdminProducts,
  listProductCategories,
  type ProductCategory,
  type ProductStatus,
} from "../../../../lib/api-client";
import { backOrigin, resolveBackTarget } from "../../../../lib/back-navigation";
import {
  formatEnumLabel,
  normalizeFilterValue,
  statusTone,
} from "../../../../lib/format";
import { INPUT_LIMITS } from "../../../../lib/input-limits";

type FieldProductsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    category?: string;
    from?: string;
    search?: string;
    status?: string;
  }>;
};

const productStatuses: ProductStatus[] = ["active", "inactive", "archived"];

export default async function FieldProductsPage({
  params,
  searchParams,
}: FieldProductsPageProps) {
  const { tenantSlug } = await params;
  const [t, tBack, tField, tCommon] = await Promise.all([
    getTranslations("field.products"),
    getTranslations("common.back"),
    getTranslations("field"),
    getTranslations("common"),
  ]);
  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("products.read")
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
    labelKey: "route",
  });

  // The menu hides this entry when the tenant runs without a catalogue, but an
  // old link or a bookmark still reaches the URL — same notice the manager's
  // potential screen shows for the same flag.
  if (!sessionResult.data.productsEnabled) {
    return (
      <AppShell activeArea="field-menu" tenantSlug={tenantSlug}>
        <BackLink href={backTarget.href} label={tBack(backTarget.labelKey)} />
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("title")}</h1>
          </div>
        </header>

        <section aria-label={t("disabledAria")} className="notice-panel">
          <div>
            <h2>{t("disabledTitle")}</h2>
            <p>{t("disabledBody")}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const selectedStatus = normalizeStatus(pageState.status);
  const selectedCategory = normalizeFilterValue(pageState.category);
  const search = normalizeFilterValue(pageState.search);
  const hasFilters = Boolean(selectedStatus || selectedCategory || search);
  const query = new URLSearchParams({ pageSize: "100" });

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (selectedCategory) {
    query.set("category", selectedCategory);
  }

  if (search) {
    query.set("search", search);
  }

  const [productsResult, categoriesResult] = await Promise.all([
    listAdminProducts(query.toString()),
    listProductCategories(),
  ]);

  if (!productsResult.ok) {
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
            <p>{productsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const products = productsResult.data.items;
  const categories: ProductCategory[] = categoriesResult.ok
    ? categoriesResult.data
    : [];
  // Keep a legacy/free-text category selectable even if it is no longer a
  // managed category (matches admin/products' filter dropdown).
  const categoryFilterOptions =
    selectedCategory &&
    !categories.some((category) => category.name === selectedCategory)
      ? [{ id: selectedCategory, name: selectedCategory }, ...categories]
      : categories;

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
        <FilterForm action={`/${tenantSlug}/field/products`}>
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
                ...productStatuses.map((status) => ({
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
            <div className="filter-form products-filter-form">
              <FilterField icon={<TagIcon />} label={t("category")}>
                <select defaultValue={selectedCategory ?? ""} name="category">
                  <option value="">{tCommon("anyOption")}</option>
                  {categoryFilterOptions.map((category) => (
                    <option key={category.id} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField icon={<SearchIcon />} label={t("search")}>
                <input
                  defaultValue={search ?? ""}
                  maxLength={INPUT_LIMITS.search}
                  name="search"
                  placeholder={t("searchPlaceholder")}
                  type="search"
                />
              </FilterField>
              <FilterFooter
                resetHref={
                  hasFilters
                    ? backOrigin(`/${tenantSlug}/field/products`, {
                        from: pageState.from,
                      })
                    : undefined
                }
                resetLabel={tCommon("reset")}
                resultText={t.rich("filterResultCount", {
                  ...filterCountTags,
                  count: productsResult.data.total,
                })}
              />
            </div>
          </FilterDisclosure>
        </FilterForm>

        {products.length > 0 ? (
          <div className="field-card-list">
            {products.map((product) => (
              <article className="location-mini-card" key={product.id}>
                <header>
                  <div>
                    <h3>{product.name}</h3>
                    <p>
                      {[product.category, product.sku]
                        .filter(Boolean)
                        .map((value) => String(value))
                        .join(" · ") || t("noCatalogueDetails")}
                    </p>
                  </div>
                  <span className={`status-pill ${statusTone(product.status)}`}>
                    {formatEnumLabel(tCommon, product.status)}
                  </span>
                </header>
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
                  href={`/${tenantSlug}/field/products`}
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

function normalizeStatus(value: string | undefined): ProductStatus | null {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }

  return null;
}
