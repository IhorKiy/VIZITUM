-- Product category names are a curated per-tenant vocabulary, so uniqueness
-- should be case-insensitive: "Beverages" and "beverages" are the same label.
-- Replace the exact-case composite unique index with a functional unique index
-- on lower(name) per tenant. Display names are still stored exactly as typed.
--
-- The previous index was case-sensitive, so a tenant could already hold case
-- variants of the same label (e.g. "Beverages" + "beverages"). Those would make
-- CREATE UNIQUE INDEX below fail, so first collapse each case-insensitive group
-- down to a single surviving row, keeping the earliest-created one as canonical.

-- 1. Relabel products tagged with a losing case variant to the surviving
--    category's display name (products.category is free-text, no FK).
WITH ranked AS (
  SELECT
    "tenantId",
    name,
    row_number() OVER w AS rn,
    first_value(name) OVER w AS keep_name
  FROM "product_categories"
  WINDOW w AS (
    PARTITION BY "tenantId", lower("name")
    ORDER BY "createdAt" ASC, "id" ASC
  )
)
UPDATE "products" p
SET "category" = r.keep_name
FROM ranked r
WHERE r.rn > 1
  AND p."tenantId" = r."tenantId"
  AND p."category" = r.name;

-- 2. Delete the losing (non-canonical) category rows in each group.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenantId", lower("name")
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "product_categories"
)
DELETE FROM "product_categories"
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

-- 3. Swap the exact-case unique index for the case-insensitive functional one.
DROP INDEX "product_categories_tenantId_name_key";

CREATE UNIQUE INDEX "product_categories_tenantId_lower_name_key"
  ON "product_categories" ("tenantId", lower("name"));
