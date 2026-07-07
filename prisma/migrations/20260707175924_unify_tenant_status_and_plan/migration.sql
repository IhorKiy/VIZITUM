-- Status now doubles as the plan tier for a live tenant, replacing the
-- separate planCode field: "pilot_active" becomes "pilot", and "team"/
-- "business" are new plan-tier statuses alongside it.
ALTER TYPE "TenantStatus" RENAME VALUE 'pilot_active' TO 'pilot';
ALTER TYPE "TenantStatus" ADD VALUE 'team' AFTER 'pilot';
ALTER TYPE "TenantStatus" ADD VALUE 'business' AFTER 'team';

-- "active" is retired the same way draft/provisioning/ready already are:
-- move existing active tenants onto a specific plan tier (pilot, per product
-- decision) rather than leaving them on a status the app no longer assigns.
UPDATE "platform_tenants" SET "status" = 'pilot' WHERE "status" = 'active';

-- Plan is no longer a separate field now that status carries it.
ALTER TABLE "platform_tenants" ALTER COLUMN "status" SET DEFAULT 'pilot';
ALTER TABLE "platform_tenants" DROP COLUMN "planCode";
