-- CreateEnum
CREATE TYPE "ChainStatus" AS ENUM ('active', 'archived');

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "chainId" TEXT;

-- CreateTable
CREATE TABLE "chains" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalCode" TEXT,
    "name" TEXT NOT NULL,
    "status" "ChainStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "chains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chains_tenantId_status_idx" ON "chains"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "chains_tenantId_externalCode_key" ON "chains"("tenantId", "externalCode");

-- CreateIndex
CREATE UNIQUE INDEX "chains_tenantId_name_key" ON "chains"("tenantId", "name");

-- CreateIndex
CREATE INDEX "locations_tenantId_chainId_idx" ON "locations"("tenantId", "chainId");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "chains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
