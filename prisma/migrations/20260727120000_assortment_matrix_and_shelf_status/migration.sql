-- Splits the assortment row into a manager-owned matrix flag and a
-- field-observed shelf state, and drops the observation columns no screen or
-- metric ever read.

-- `status` becomes optional: NULL means "in the matrix, not yet confirmed on
-- the shelf". Existing values are left as they are — rewriting a tenant's whole
-- matrix to NULL would zero their coverage overnight; those rows instead age
-- out naturally as visits start writing real observations.
ALTER TABLE "location_assortment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "location_assortment" ALTER COLUMN "status" DROP NOT NULL;

-- Fold the two dropped values into the surviving vocabulary. `not_relevant`
-- was always a second spelling of `shouldBeListed = false`; `to_order` is an
-- ordering decision, not a shelf observation, so it collapses to out_of_stock.
UPDATE "location_assortment"
SET "shouldBeListed" = false, "status" = NULL
WHERE "status" = 'not_relevant';

UPDATE "location_assortment"
SET "status" = 'out_of_stock'
WHERE "status" = 'to_order';

-- Postgres cannot drop enum values in place, so the type is recreated.
ALTER TYPE "AssortmentStatus" RENAME TO "AssortmentStatus_old";
CREATE TYPE "AssortmentStatus" AS ENUM ('in_stock', 'out_of_stock');
ALTER TABLE "location_assortment"
ALTER COLUMN "status" TYPE "AssortmentStatus" USING ("status"::text::"AssortmentStatus");
DROP TYPE "AssortmentStatus_old";

-- Written by the manager modal, displayed as tiles, read by nothing else.
ALTER TABLE "location_assortment"
DROP COLUMN "lastStock",
DROP COLUMN "lastOrder",
DROP COLUMN "lastSale",
DROP COLUMN "comment";
