-- The Company Admin cap now derives from the plan tier (`status`): pilot 0,
-- team 1, business 2. `adminLimit` becomes an optional platform-owner override
-- (NULL = derive from plan). Existing tenants are reset to NULL so they follow
-- their plan going forward; tenants already over the derived cap keep their
-- current admins (enforcement only blocks adding new ones).
ALTER TABLE "platform_tenants" ALTER COLUMN "adminLimit" DROP DEFAULT;
ALTER TABLE "platform_tenants" ALTER COLUMN "adminLimit" DROP NOT NULL;
UPDATE "platform_tenants" SET "adminLimit" = NULL;
