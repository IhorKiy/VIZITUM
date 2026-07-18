-- Replace the plain unique index on (tenantId, externalCode) with a PARTIAL
-- unique index scoped to live rows (`deletedAt IS NULL`). An archived location
-- (deletedAt set) would otherwise keep reserving its externalCode at the DB
-- level even though every read path and the create/import pre-checks ignore
-- soft-deleted rows (`deletedAt: null`). That mismatch turns "re-import or
-- re-create a code that belongs to an archived location" into a P2002 ->
-- opaque 500. Scoping the index to live rows makes the constraint agree with
-- those pre-checks. Mirrors the Product fix
-- (20260713120000_product_external_code_partial_unique).
DROP INDEX "locations_tenantId_externalCode_key";

CREATE UNIQUE INDEX "locations_tenantId_externalCode_live_key"
  ON "locations" ("tenantId", "externalCode")
  WHERE "deletedAt" IS NULL;
