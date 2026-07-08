-- AlterTable
ALTER TABLE "platform_tenants" ADD COLUMN     "purgeRequestedAt" TIMESTAMP(3),
ADD COLUMN     "purgeStartedAt" TIMESTAMP(3);
