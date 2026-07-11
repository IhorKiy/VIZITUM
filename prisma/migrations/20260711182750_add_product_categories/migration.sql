-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_categories_tenantId_idx" ON "product_categories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_tenantId_name_key" ON "product_categories"("tenantId", "name");
