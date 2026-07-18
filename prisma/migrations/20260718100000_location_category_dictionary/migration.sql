-- Location category becomes a strict, admin-managed dictionary instead of the
-- free-text `type` column. This migration:
--   1. Creates `location_categories` with a case-insensitive unique name index
--      (mirrors `product_categories`, but locations hold a real FK — deleting
--      an in-use category is rejected at the service layer, not cascaded).
--   2. Backfills one category per tenant per distinct case-insensitive
--      trimmed `type` value (first-seen casing wins) and points existing
--      locations at their new category.
--   3. Drops `locations.type` and adds the `categoryId` FK.

-- CreateTable
CREATE TABLE "location_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "location_categories_tenantId_idx" ON "location_categories"("tenantId");

-- Location category names are a curated per-tenant vocabulary, so uniqueness
-- is case-insensitive: "Bakery" and "bakery" are the same label. Prisma can't
-- express a functional index in the schema, so it's managed here (see the
-- warning comment on the `LocationCategory` model in schema.prisma).
CREATE UNIQUE INDEX "location_categories_tenantId_lower_name_key"
  ON "location_categories" ("tenantId", lower("name"));

-- AlterTable: add the new column before backfilling it; `type` is dropped
-- only after every location has been pointed at its new category.
ALTER TABLE "locations" ADD COLUMN "categoryId" TEXT;

-- Backfill: one category per tenant per distinct case-insensitive trimmed
-- `type` value, keeping the first-seen (by createdAt, then id) casing as the
-- display name — the same collapse rule the product-category migration used.
INSERT INTO "location_categories" ("id", "tenantId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, grouped."tenantId", grouped."name", now(), now()
FROM (
  SELECT DISTINCT ON ("tenantId", lower(trim("type")))
    "tenantId",
    trim("type") AS "name"
  FROM "locations"
  WHERE "type" IS NOT NULL AND trim("type") <> ''
  ORDER BY "tenantId", lower(trim("type")), "createdAt" ASC, "id" ASC
) AS grouped;

UPDATE "locations" l
SET "categoryId" = lc."id"
FROM "location_categories" lc
WHERE l."type" IS NOT NULL
  AND trim(l."type") <> ''
  AND lc."tenantId" = l."tenantId"
  AND lower(lc."name") = lower(trim(l."type"));

-- AlterTable
ALTER TABLE "locations" DROP COLUMN "type";

-- CreateIndex
CREATE INDEX "locations_tenantId_categoryId_idx" ON "locations"("tenantId", "categoryId");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "location_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
