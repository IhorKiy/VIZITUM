-- Primary contact details for a tenant, captured at creation. Nullable so
-- tenants created before this migration remain valid; the create flow requires
-- all three for new tenants.
ALTER TABLE "platform_tenants" ADD COLUMN "contactName" TEXT;
ALTER TABLE "platform_tenants" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "platform_tenants" ADD COLUMN "contactPhone" TEXT;
