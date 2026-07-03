import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  listAdminProducts,
  updateAdminProduct,
  type Product,
  type ProductStatus,
} from "../../../../lib/api-client";
import {
  formatLabel,
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
            <p className="eyebrow">Company admin</p>
            <h1>Products / SKUs</h1>
            <p>
              Live tenant products are required in production before this screen
              can load.
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
            <h2>Tenant products are not connected</h2>
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
          <p className="eyebrow">Company admin</p>
          <h1>Products / SKUs</h1>
          <p>
            Review imported products, keep status current and mark items not
            applicable when this tenant does not track them.
          </p>
        </div>
      </header>

      {pageState.updated ? (
        <section className="notice-panel success" aria-label="Product status">
          <div>
            <p className="eyebrow">Product updated</p>
            <h2>Product details were saved</h2>
            <p>The change applies to this tenant immediately.</p>
          </div>
        </section>
      ) : null}

      {pageState.error ? (
        <section className="notice-panel danger" aria-label="Product error">
          <div>
            <p className="eyebrow">Update failed</p>
            <h2>Check the product details and try again</h2>
            <p>Name and status are required.</p>
          </div>
        </section>
      ) : null}

      <section className="manager-grid" aria-label="Product metrics">
        <article className="metric-card">
          <header>
            <p className="metric-label">Tenant products</p>
            <span className="status-pill active">Live</span>
          </header>
          <p className="metric-value">{productsResult.data.total}</p>
          <p className="small-label">{activeCount} active products</p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">Not applicable</p>
            <span className="status-pill info">Flag</span>
          </header>
          <p className="metric-value">{notApplicableCount}</p>
          <p className="small-label">Excluded from product/SKU tracking</p>
        </article>
      </section>

      <section className="panel drilldown-panel">
        <div className="panel-toolbar">
          <div className="panel-title-stack">
            <h2>Product list</h2>
            <p>
              Showing {selectedStatus ? formatLabel(selectedStatus) : "all"}{" "}
              products{search ? ` matching "${search}"` : ""}.
            </p>
          </div>
          <div className="filter-pills" aria-label="Product status filters">
            <a
              aria-current={!selectedStatus ? "page" : undefined}
              href={buildProductFilterHref(tenantSlug, null, search)}
            >
              All
            </a>
            {productStatuses.map((status) => (
              <a
                aria-current={selectedStatus === status ? "page" : undefined}
                href={buildProductFilterHref(tenantSlug, status, search)}
                key={status}
              >
                {formatLabel(status)}
              </a>
            ))}
          </div>
        </div>

        <form action={`/${tenantSlug}/admin/products`} className="filter-form">
          {selectedStatus ? (
            <input name="status" type="hidden" value={selectedStatus} />
          ) : null}
          <label>
            Search
            <input
              defaultValue={search ?? ""}
              name="search"
              placeholder="Name, SKU or category"
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
                href={`/${tenantSlug}/admin/products`}
              >
                Reset
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
            <h2>No products match this filter</h2>
            <p>
              Use another status filter or import products before managing SKUs
              here.
            </p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/admin/products`}
                >
                  Show all products
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

function ProductRow({
  product,
  updateProductAction,
}: {
  product: Product;
  updateProductAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <article className="admin-user-row">
      <header>
        <div>
          <h3>{product.name}</h3>
          <p>{product.sku ? `SKU ${product.sku}` : "No SKU"}</p>
        </div>
        <span className={`status-pill ${statusTone(product.status)}`}>
          {formatLabel(product.status)}
        </span>
      </header>

      <form action={updateProductAction} className="visit-form compact">
        <input name="productId" type="hidden" value={product.id} />
        <label>
          Name
          <input defaultValue={product.name} name="name" required />
        </label>
        <label>
          SKU
          <input defaultValue={product.sku ?? ""} name="sku" />
        </label>
        <label>
          Category
          <input defaultValue={product.category ?? ""} name="category" />
        </label>
        <label className="checkbox-inline">
          <input
            defaultChecked={product.notApplicable}
            name="notApplicable"
            type="checkbox"
          />
          <span>Not applicable for this tenant</span>
        </label>
        <label>
          Status
          <select defaultValue={product.status} name="status" required>
            {productStatuses.map((status) => (
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
          Save product
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
