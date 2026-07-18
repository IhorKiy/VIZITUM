-- AlterTable
ALTER TABLE "route_plans" ADD COLUMN     "routeTemplateId" TEXT;

-- CreateTable
CREATE TABLE "route_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "representativeUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_template_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "routeTemplateId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "route_templates_tenantId_representativeUserId_idx" ON "route_templates"("tenantId", "representativeUserId");

-- CreateIndex
CREATE INDEX "route_template_items_tenantId_routeTemplateId_idx" ON "route_template_items"("tenantId", "routeTemplateId");

-- CreateIndex
CREATE INDEX "route_template_items_tenantId_locationId_idx" ON "route_template_items"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "route_template_items_tenantId_routeTemplateId_sequence_key" ON "route_template_items"("tenantId", "routeTemplateId", "sequence");

-- CreateIndex
CREATE INDEX "route_plans_tenantId_routeTemplateId_idx" ON "route_plans"("tenantId", "routeTemplateId");

-- AddForeignKey
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_routeTemplateId_fkey" FOREIGN KEY ("routeTemplateId") REFERENCES "route_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_templates" ADD CONSTRAINT "route_templates_representativeUserId_fkey" FOREIGN KEY ("representativeUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_template_items" ADD CONSTRAINT "route_template_items_routeTemplateId_fkey" FOREIGN KEY ("routeTemplateId") REFERENCES "route_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_template_items" ADD CONSTRAINT "route_template_items_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
