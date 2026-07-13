-- Replace the plain unique index on (tenantId, externalCode) with a PARTIAL
-- unique index scoped to live rows (`deletedAt IS NULL`). A soft-deleted product
-- (deletedAt set) previously kept reserving its externalCode at the DB level even
-- though every read path and the create/import pre-checks ignore soft-deleted
-- rows (`deletedAt: null`). That mismatch turned "re-import/re-create a code that
-- belongs to a soft-deleted product" into a P2002 -> opaque 500. Scoping the
-- index to live rows makes the constraint agree with those pre-checks.
DROP INDEX "products_tenantId_externalCode_key";

CREATE UNIQUE INDEX "products_tenantId_externalCode_live_key"
  ON "products" ("tenantId", "externalCode")
  WHERE "deletedAt" IS NULL;
