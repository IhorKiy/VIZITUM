-- Product category names are a curated per-tenant vocabulary, so uniqueness
-- should be case-insensitive: "Beverages" and "beverages" are the same label.
-- Replace the exact-case composite unique index with a functional unique index
-- on lower(name) per tenant. Display names are still stored exactly as typed.
DROP INDEX "product_categories_tenantId_name_key";

CREATE UNIQUE INDEX "product_categories_tenantId_lower_name_key"
  ON "product_categories" ("tenantId", lower("name"));
