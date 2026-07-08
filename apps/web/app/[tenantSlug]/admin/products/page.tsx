import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  listAdminProducts,
  updateAdminProduct,
  type Product,
  type ProductStatus,
} from "../../../../lib/api-client";
import {
  formatEnumLabel,
  normalizeFilterValue,
  statusTone,
} from "../../../../lib/format";

type AdminProductsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    error?: string;
    search?: string;
    status?: string;
    updated?: string;
  }>;
};

const productStatuses: ProductStatus[] = ["active", "inactive", "archived"];

export default async function AdminProductsPage({
  params,
  searchParams,
}: AdminProductsPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [t, tAdmin, tCommon] = await Promise.all([
    getTranslations("admin.products"),
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

  async function updateProductAction(formData: FormData) {
    "use server";

    const productId = String(formData.get("productId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const sku = normalizeOptionalField(formData.get("sku"));
    const category = normalizeOptionalField(formData.get("category"));
    const notApplicable = formData.get("notApplicable") === "on";
    const status = normalizeStatus(String(formData.get("status") ?? ""));

    if (!productId || !name || !status) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    const result = await updateAdminProduct(productId, {
      name,
      sku,
      category,
      notApplicable,
      status,
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    redirect(`/${tenantSlug}/admin/products?updated=1`);
  }

  const productsResult = await listAdminProducts(query.toString());

  if (!productsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-products">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tAdmin("eyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("signedOutBody")}</p>
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
            <p>{productsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const products = productsResult.data.items;
  const activeCount = products.filter(
    (product) => product.status === "active",
  ).length;
  const notApplicableCount = products.filter(
    (product) => product.notApplicable,
  ).length;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-products">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </div>
      </header>

      {pageState.updated ? (
        <section
          className="notice-panel success"
          aria-label={t("updatedAria")}
        >
          <div>
            <p className="eyebrow">{t("updatedEyebrow")}</p>
            <h2>{t("updatedTitle")}</h2>
            <p>{t("updatedBody")}</p>
          </div>
        </section>
      ) : null}

      {pageState.error ? (
        <section
          className="notice-panel danger"
          aria-label={t("errorAria")}
        >
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
            <p className="metric-label">{t("tenantProducts")}</p>
            <span className="status-pill active">
              {tCommon("labels.live")}
            </span>
          </header>
          <p className="metric-value">{productsResult.data.total}</p>
          <p className="small-label">
            {t("activeCount", { count: activeCount })}
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("notApplicable")}</p>
            <span className="status-pill info">{t("flag")}</span>
          </header>
          <p className="metric-value">{notApplicableCount}</p>
          <p className="small-label">{t("notApplicableDetail")}</p>
        </article>
      </section>

      <section className="panel drilldown-panel">
        <div className="panel-toolbar">
          <div className="panel-title-stack">
            <h2>{t("productList")}</h2>
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
              href={buildProductFilterHref(tenantSlug, null, search)}
            >
              {tCommon("all")}
            </a>
            {productStatuses.map((status) => (
              <a
                aria-current={selectedStatus === status ? "page" : undefined}
                href={buildProductFilterHref(tenantSlug, status, search)}
                key={status}
              >
                {formatEnumLabel(tCommon, status)}
              </a>
            ))}
          </div>
        </div>

        <form action={`/${tenantSlug}/admin/products`} className="filter-form">
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
                href={`/${tenantSlug}/admin/products`}
              >
                {tCommon("reset")}
              </a>
            ) : null}
          </div>
        </form>

        {products.length > 0 ? (
          <div className="admin-user-list">
            {products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                updateProductAction={updateProductAction}
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
                  href={`/${tenantSlug}/admin/products`}
                >
                  {t("showAllProducts")}
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

function ProductRow({
  product,
  updateProductAction,
}: {
  product: Product;
  updateProductAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("admin.products");
  const tCommon = useTranslations("common");

  return (
    <article className="admin-user-row">
      <header>
        <div>
          <h3>{product.name}</h3>
          <p>{product.sku ? t("skuLabel", { sku: product.sku }) : t("noSku")}</p>
        </div>
        <span className={`status-pill ${statusTone(product.status)}`}>
          {formatEnumLabel(tCommon, product.status)}
        </span>
      </header>

      <form action={updateProductAction} className="visit-form compact">
        <input name="productId" type="hidden" value={product.id} />
        <label>
          {t("name")}
          <input defaultValue={product.name} name="name" required />
        </label>
        <label>
          {t("sku")}
          <input defaultValue={product.sku ?? ""} name="sku" />
        </label>
        <label>
          {t("category")}
          <input defaultValue={product.category ?? ""} name="category" />
        </label>
        <label className="checkbox-inline">
          <input
            defaultChecked={product.notApplicable}
            name="notApplicable"
            type="checkbox"
          />
          <span>{t("notApplicableCheckbox")}</span>
        </label>
        <label>
          {t("status")}
          <select defaultValue={product.status} name="status" required>
            {productStatuses.map((status) => (
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
          {t("saveProduct")}
        </PendingSubmitButton>
      </form>
    </article>
  );
}

function buildProductFilterHref(
  tenantSlug: string,
  status: ProductStatus | null,
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

  return `/${tenantSlug}/admin/products${suffix ? `?${suffix}` : ""}`;
}

function normalizeStatus(value: string | undefined): ProductStatus | null {
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
