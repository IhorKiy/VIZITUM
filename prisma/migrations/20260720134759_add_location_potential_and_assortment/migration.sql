-- CreateEnum
CREATE TYPE "AssortmentStatus" AS ENUM ('in_stock', 'out_of_stock', 'to_order', 'not_relevant');

-- CreateTable
CREATE TABLE "location_potentials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productCategoryId" TEXT NOT NULL,
    "potentialDate" DATE,
    "potentialAmount" INTEGER,
    "planMonth1" INTEGER,
    "planMonth2" INTEGER,
    "planMonth3" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_potentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_assortment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shouldBeListed" BOOLEAN NOT NULL DEFAULT true,
    "status" "AssortmentStatus" NOT NULL DEFAULT 'in_stock',
    "lastStock" INTEGER,
    "lastOrder" INTEGER,
    "lastSale" INTEGER,
    "lastCheckedAt" DATE,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_assortment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "location_potentials_tenantId_locationId_productCategoryId_key" ON "location_potentials"("tenantId", "locationId", "productCategoryId");

-- CreateIndex
CREATE INDEX "location_assortment_tenantId_productId_status_idx" ON "location_assortment"("tenantId", "productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "location_assortment_tenantId_locationId_productId_key" ON "location_assortment"("tenantId", "locationId", "productId");

-- AddForeignKey
ALTER TABLE "location_potentials" ADD CONSTRAINT "location_potentials_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_potentials" ADD CONSTRAINT "location_potentials_productCategoryId_fkey" FOREIGN KEY ("productCategoryId") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_assortment" ADD CONSTRAINT "location_assortment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_assortment" ADD CONSTRAINT "location_assortment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
