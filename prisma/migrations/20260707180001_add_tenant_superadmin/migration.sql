-- AlterEnum
ALTER TYPE "RoleCode" ADD VALUE 'tenant_superadmin';

-- AlterTable
ALTER TABLE "platform_tenants" ADD COLUMN     "adminLimit" INTEGER NOT NULL DEFAULT 2;
