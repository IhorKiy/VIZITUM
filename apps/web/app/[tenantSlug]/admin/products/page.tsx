import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { AddProductModal } from "../../../../components/add-product-modal";
import { AppShell } from "../../../../components/app-shell";
import { CategoriesAccordion } from "../../../../components/categories-accordion";
import { DeleteProductButton } from "../../../../components/delete-product-button";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import { FilterDisclosure } from "../../../../components/filter-disclosure";
import { FilterField } from "../../../../components/filter-field";
import {
  FilterFooter,
  filterCountTags,
} from "../../../../components/filter-footer";
import { FilterForm } from "../../../../components/filter-form";
import { SearchIcon, TagIcon } from "../../../../components/icons";
import { InlineFieldEditor } from "../../../../components/inline-field-editor";
import {
  createAdminProduct,
  createProductCategory,
  deleteAdminProduct,
  deleteProductCategory,
  listAdminProducts,
  listProductCategories,
  updateAdminProduct,
  updateProductCategory,
  type Product,
  type ProductCategory,
  type ProductStatus,
} from "../../../../lib/api-client";
import {
  formatEnumLabel,
  normalizeFilterValue,
  statusTone,
} from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";
import { buildEntityGroups } from "../../../../lib/grouping";

type AdminProductsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    category?: string;
    created?: string;
    deleted?: string;
    error?: string;
    search?: string;
    status?: string;
    updated?: string;
    view?: string;
  }>;
};

const productStatuses: ProductStatus[] = ["active", "inactive", "archived"];

export default async function AdminProductsPage({
  params,
  searchParams,
}: AdminProductsPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [t, tAdmin, tCommon, locale] = await Promise.all([
    getTranslations("admin.products"),
    getTranslations("admin"),
    getTranslations("common"),
    getLocale(),
  ]);
  const selectedStatus = normalizeStatus(pageState.status);
  const selectedCategory = normalizeFilterValue(pageState.category);
  const search = normalizeFilterValue(pageState.search);
  const groupByCategory = pageState.view === "category";
  const viewParam = groupByCategory ? "category" : null;
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

  async function updateProductAction(formData: FormData) {
    "use server";

    const productId = getFormString(formData, "productId").trim();

    if (!productId) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    // Each field editor saves on its own, so only patch the fields present in
    // this submission rather than overwriting the whole product.
    const input: {
      name?: string;
      sku?: string | null;
      category?: string | null;
      status?: ProductStatus;
    } = {};

    if (formData.has("name")) {
      const name = getFormString(formData, "name").trim();
      if (!name) {
        redirect(`/${tenantSlug}/admin/products?error=1`);
      }
      input.name = name;
    }

    if (formData.has("sku")) {
      input.sku = normalizeOptionalField(formData.get("sku"));
    }

    if (formData.has("category")) {
      input.category = normalizeOptionalField(formData.get("category"));
    }

    if (formData.has("status")) {
      const status = normalizeStatus(getFormString(formData, "status"));
      if (!status) {
        redirect(`/${tenantSlug}/admin/products?error=1`);
      }
      input.status = status;
    }

    const result = await updateAdminProduct(productId, input);

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    redirect(`/${tenantSlug}/admin/products?updated=1`);
  }

  async function deleteProductAction(formData: FormData) {
    "use server";

    const productId = getFormString(formData, "productId").trim();

    if (!productId) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    const result = await deleteAdminProduct(productId);

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    redirect(`/${tenantSlug}/admin/products?deleted=1`);
  }

  async function createProductAction(formData: FormData) {
    "use server";

    const name = getFormString(formData, "name").trim();
    const sku = normalizeOptionalField(formData.get("sku"));
    const category = normalizeOptionalField(formData.get("category"));

    if (!name) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    const result = await createAdminProduct({
      name,
      sku,
      category,
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    redirect(`/${tenantSlug}/admin/products?created=product`);
  }

  async function createCategoryAction(formData: FormData) {
    "use server";

    const name = getFormString(formData, "name").trim();

    if (!name) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    const result = await createProductCategory({ name });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    redirect(`/${tenantSlug}/admin/products?created=category`);
  }

  async function updateCategoryAction(formData: FormData) {
    "use server";

    const categoryId = getFormString(formData, "categoryId").trim();
    const name = getFormString(formData, "name").trim();

    if (!categoryId || !name) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    const result = await updateProductCategory(categoryId, { name });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    redirect(`/${tenantSlug}/admin/products?created=categoryUpdated`);
  }

  async function deleteCategoryAction(formData: FormData) {
    "use server";

    const categoryId = getFormString(formData, "categoryId").trim();

    if (!categoryId) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    const result = await deleteProductCategory(categoryId);

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/products?error=1`);
    }

    redirect(`/${tenantSlug}/admin/products?created=categoryRemoved`);
  }

  const [productsResult, categoriesResult] = await Promise.all([
    listAdminProducts(query.toString()),
    listProductCategories(),
  ]);

  if (!productsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-products">
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

  const categories: ProductCategory[] = categoriesResult.ok
    ? categoriesResult.data
    : [];

  // Keep a legacy/free-text filter value selectable even if it is no longer a
  // managed category.
  const categoryFilterOptions =
    selectedCategory &&
    !categories.some((category) => category.name === selectedCategory)
      ? [{ id: selectedCategory, name: selectedCategory }, ...categories]
      : categories;

  const productGroups = groupByCategory
    ? buildEntityGroups(
        products,
        (product) => product.category,
        (product) => product.category,
        t("noCategoryOption"),
        locale,
      )
    : [];

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-products">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
        <div className="toolbar">
          <AddProductModal
            action={createProductAction}
            categories={categories}
          />
        </div>
      </header>

      {pageState.created ? (
        <DismissableNotice
          ariaLabel={t("createdAria")}
          body={
            pageState.created === "category"
              ? t("createdCategoryBody")
              : pageState.created === "categoryUpdated"
                ? t("updatedCategoryBody")
                : pageState.created === "categoryRemoved"
                  ? t("removedCategoryBody")
                  : t("createdProductBody")
          }
          clearParams={["created"]}
          eyebrow={t("createdEyebrow")}
          title={
            pageState.created === "category"
              ? t("createdCategoryTitle")
              : pageState.created === "categoryUpdated"
                ? t("updatedCategoryTitle")
                : pageState.created === "categoryRemoved"
                  ? t("removedCategoryTitle")
                  : t("createdProductTitle")
          }
          tone="success"
        />
      ) : null}

      {pageState.updated ? (
        <DismissableNotice
          ariaLabel={t("updatedAria")}
          body={t("updatedBody")}
          clearParams={["updated"]}
          eyebrow={t("updatedEyebrow")}
          title={t("updatedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.deleted ? (
        <DismissableNotice
          ariaLabel={t("deletedAria")}
          body={t("deletedBody")}
          clearParams={["deleted"]}
          eyebrow={t("deletedEyebrow")}
          title={t("deletedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.error ? (
        <DismissableNotice
          ariaLabel={t("errorAria")}
          body={t("errorBody")}
          clearParams={["error"]}
          eyebrow={t("errorEyebrow")}
          title={t("errorTitle")}
          tone="danger"
        />
      ) : null}

      <section className="manager-grid" aria-label={t("metricsAria")}>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("tenantProducts")}</p>
            <span className="status-pill active">{tCommon("labels.live")}</span>
          </header>
          <p className="metric-value">{productsResult.data.total}</p>
          <p className="small-label">
            {t("activeCount", { count: activeCount })}
          </p>
        </article>
      </section>

      <CategoriesAccordion
        categories={categories}
        createAction={createCategoryAction}
        defaultOpen={
          pageState.created === "category" ||
          pageState.created === "categoryUpdated" ||
          pageState.created === "categoryRemoved"
        }
        deleteAction={deleteCategoryAction}
        updateAction={updateCategoryAction}
      />

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
          <div className="panel-toolbar-filters">
            <div className="filter-pills" aria-label={t("statusFiltersAria")}>
              <a
                aria-current={!selectedStatus ? "page" : undefined}
                href={buildProductHref(tenantSlug, {
                  category: selectedCategory,
                  search,
                  view: viewParam,
                })}
              >
                {tCommon("all")}
              </a>
              {productStatuses.map((status) => (
                <a
                  aria-current={selectedStatus === status ? "page" : undefined}
                  href={buildProductHref(tenantSlug, {
                    status,
                    category: selectedCategory,
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
                aria-current={!groupByCategory ? "page" : undefined}
                href={buildProductHref(tenantSlug, {
                  status: selectedStatus,
                  category: selectedCategory,
                  search,
                })}
              >
                {t("viewList")}
              </a>
              <a
                aria-current={groupByCategory ? "page" : undefined}
                href={buildProductHref(tenantSlug, {
                  status: selectedStatus,
                  category: selectedCategory,
                  search,
                  view: "category",
                })}
              >
                {t("viewByCategory")}
              </a>
            </div>
          </div>
        </div>

        <FilterDisclosure
          hasFilters={hasFilters}
          label={tCommon("filtersLabel")}
        >
          <FilterForm
            action={`/${tenantSlug}/admin/products`}
            className="filter-form products-filter-form"
          >
            {selectedStatus ? (
              <input name="status" type="hidden" value={selectedStatus} />
            ) : null}
            {groupByCategory ? (
              <input name="view" type="hidden" value="category" />
            ) : null}
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
                name="search"
                placeholder={t("searchPlaceholder")}
                type="text"
              />
            </FilterField>
            <FilterFooter
              resetHref={
                hasFilters ? `/${tenantSlug}/admin/products` : undefined
              }
              resetLabel={tCommon("reset")}
              resultText={t.rich("filterResultCount", {
                ...filterCountTags,
                count: productsResult.data.total,
              })}
            />
          </FilterForm>
        </FilterDisclosure>

        {products.length > 0 ? (
          groupByCategory ? (
            <div className="entity-group-list">
              {productGroups.map((group) => (
                <section className="entity-group" key={group.key}>
                  <h3 className="entity-group-title">
                    <span>{group.label}</span>
                    <span className="entity-group-count">
                      {group.items.length}
                    </span>
                  </h3>
                  <div className="admin-user-list">
                    {group.items.map((product) => (
                      <ProductRow
                        key={product.id}
                        categories={categories}
                        deleteProductAction={deleteProductAction}
                        product={product}
                        updateProductAction={updateProductAction}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="admin-user-list">
              {products.map((product) => (
                <ProductRow
                  key={product.id}
                  categories={categories}
                  deleteProductAction={deleteProductAction}
                  product={product}
                  updateProductAction={updateProductAction}
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
  categories,
  updateProductAction,
  deleteProductAction,
}: {
  product: Product;
  categories: ProductCategory[];
  updateProductAction: (formData: FormData) => Promise<void>;
  deleteProductAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("admin.products");
  const tCommon = useTranslations("common");

  // Preserve a legacy/free-text category that isn't (yet) a managed category so
  // opening the row doesn't silently reset it to "no category" on save.
  const categoryOptions =
    product.category &&
    !categories.some((category) => category.name === product.category)
      ? [{ id: product.category, name: product.category }, ...categories]
      : categories;

  const categorySelectOptions = [
    { value: "", label: t("noCategoryOption") },
    ...categoryOptions.map((category) => ({
      value: category.name,
      label: category.name,
    })),
  ];

  const statusSelectOptions = productStatuses.map((status) => ({
    value: status,
    label: formatEnumLabel(tCommon, status),
  }));

  return (
    // Exclusive-accordion disclosure: the shared `name` keeps only one product
    // expanded at a time; collapsed rows show just the name/SKU summary and the
    // edit form stays hidden until a row is opened.
    <details
      className="admin-user-row admin-user-disclosure"
      name="admin-product"
    >
      <summary className="admin-user-summary">
        <div className="admin-user-summary-lead">
          <h3>{product.name}</h3>
          <p>
            {product.sku ? t("skuLabel", { sku: product.sku }) : t("noSku")}
          </p>
        </div>
        <div className="admin-user-summary-meta">
          <span className={`status-pill ${statusTone(product.status)}`}>
            {formatEnumLabel(tCommon, product.status)}
          </span>
          <span className="disclosure-chevron" aria-hidden="true" />
        </div>
      </summary>

      <div className="admin-user-body">
        <div className="visit-form compact visit-form-2col">
          <InlineFieldEditor
            entityId={product.id}
            idFieldName="productId"
            namespace="admin.products"
            field="name"
            kind="text"
            label={t("name")}
            required
            updateAction={updateProductAction}
            value={product.name}
            displayText={product.name}
          />
          <InlineFieldEditor
            entityId={product.id}
            idFieldName="productId"
            namespace="admin.products"
            field="sku"
            kind="text"
            label={t("sku")}
            placeholder={t("noSku")}
            updateAction={updateProductAction}
            value={product.sku ?? ""}
            displayText={product.sku ?? ""}
          />
          <InlineFieldEditor
            entityId={product.id}
            idFieldName="productId"
            namespace="admin.products"
            field="category"
            kind="select"
            label={t("category")}
            options={categorySelectOptions}
            placeholder={t("noCategoryOption")}
            updateAction={updateProductAction}
            value={product.category ?? ""}
            displayText={product.category ?? ""}
          />
          <InlineFieldEditor
            entityId={product.id}
            idFieldName="productId"
            namespace="admin.products"
            field="status"
            kind="select"
            label={t("status")}
            options={statusSelectOptions}
            required
            updateAction={updateProductAction}
            value={product.status}
            displayText={formatEnumLabel(tCommon, product.status)}
          />
        </div>
        <div className="product-row-footer">
          <DeleteProductButton
            deleteAction={deleteProductAction}
            productId={product.id}
            productName={product.name}
          />
        </div>
      </div>
    </details>
  );
}

function buildProductHref(
  tenantSlug: string,
  filters: {
    status?: ProductStatus | null;
    category?: string | null;
    search?: string | null;
    view?: string | null;
  },
): string {
  const query = new URLSearchParams();

  if (filters.status) {
    query.set("status", filters.status);
  }

  if (filters.category) {
    query.set("category", filters.category);
  }

  if (filters.search) {
    query.set("search", filters.search);
  }

  if (filters.view) {
    query.set("view", filters.view);
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
  const normalizedValue = typeof value === "string" ? value.trim() : "";

  return normalizedValue || null;
}
