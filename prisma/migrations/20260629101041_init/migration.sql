-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('draft', 'provisioning', 'ready', 'pilot_active', 'active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('pilot', 'team', 'business');

-- CreateEnum
CREATE TYPE "ProductMode" AS ENUM ('team', 'business');

-- CreateEnum
CREATE TYPE "DatabasePlacement" AS ENUM ('shared', 'dedicated');

-- CreateEnum
CREATE TYPE "SegmentTemplate" AS ENUM ('distribution', 'service', 'partner_account');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('invited', 'active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('company_admin', 'team_manager', 'field_representative');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('draft', 'published', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "RouteItemStatus" AS ENUM ('planned', 'visited', 'skipped');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('draft', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "VisitNoteInputType" AS ENUM ('text', 'audio');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('draft', 'confirmed', 'discarded');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'in_progress', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('users', 'locations', 'contacts', 'products', 'initial_visit_task_plan');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('uploaded', 'validated', 'validation_failed', 'confirmed', 'applied', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ImportIssueSeverity" AS ENUM ('error', 'warning');

-- CreateEnum
CREATE TYPE "AiJobType" AS ENUM ('transcription', 'extraction');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "StorageObjectStatus" AS ENUM ('active', 'deleted', 'expired');

-- CreateEnum
CREATE TYPE "StorageObjectPurpose" AS ENUM ('temporary_audio', 'temporary_transcript', 'import_file', 'export_file', 'attachment');

-- CreateTable
CREATE TABLE "platform_tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'draft',
    "planCode" "PlanCode" NOT NULL DEFAULT 'pilot',
    "productMode" "ProductMode" NOT NULL DEFAULT 'team',
    "segmentTemplate" "SegmentTemplate" NOT NULL,
    "databasePlacement" "DatabasePlacement" NOT NULL DEFAULT 'shared',
    "databaseKey" TEXT NOT NULL,
    "primaryDomain" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_provisioning_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "step" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_provisioning_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_operation_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "metadata" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_operation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'invited',
    "passwordHash" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "lastSelectedRoleCode" "RoleCode",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleCode" "RoleCode" NOT NULL,
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleCodes" "RoleCode"[],
    "tokenHash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "userAgentHash" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_capabilities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "capabilityCode" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalCode" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "status" "LocationStatus" NOT NULL DEFAULT 'active',
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "territory" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleTitle" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "location_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "representativeUserId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'active',
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalCode" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'active',
    "notApplicable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "representativeUserId" TEXT NOT NULL,
    "planDate" DATE NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "routePlanId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "RouteItemStatus" NOT NULL DEFAULT 'planned',
    "plannedStartTime" TIMESTAMP(3),
    "plannedEndTime" TIMESTAMP(3),
    "skipReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "representativeUserId" TEXT NOT NULL,
    "routeItemId" TEXT,
    "visitType" TEXT NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'draft',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "inputType" "VisitNoteInputType" NOT NULL,
    "textContent" TEXT,
    "temporaryAudioObjectId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "visit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "representativeUserId" TEXT NOT NULL,
    "templateCode" "SegmentTemplate" NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'confirmed',
    "confirmedData" JSONB NOT NULL,
    "confirmedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "aiMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
    "assignedToUserId" TEXT,
    "createdByUserId" TEXT,
    "locationId" TEXT,
    "visitId" TEXT,
    "reportId" TEXT,
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ImportType" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'uploaded',
    "sourceFileObjectId" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "validRowCount" INTEGER NOT NULL DEFAULT 0,
    "errorRowCount" INTEGER NOT NULL DEFAULT 0,
    "warningRowCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row_issues" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "fieldName" TEXT,
    "severity" "ImportIssueSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_row_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "type" "AiJobType" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT,
    "schemaVersion" TEXT,
    "inputObjectId" TEXT,
    "temporaryTranscriptObjectId" TEXT,
    "temporaryDraft" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_objects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "purpose" "StorageObjectPurpose" NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "checksum" TEXT,
    "status" "StorageObjectStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "metadata" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_tenants_slug_key" ON "platform_tenants"("slug");

-- CreateIndex
CREATE INDEX "platform_tenants_status_idx" ON "platform_tenants"("status");

-- CreateIndex
CREATE INDEX "platform_tenants_databasePlacement_idx" ON "platform_tenants"("databasePlacement");

-- CreateIndex
CREATE INDEX "platform_tenants_segmentTemplate_idx" ON "platform_tenants"("segmentTemplate");

-- CreateIndex
CREATE INDEX "platform_provisioning_jobs_tenantId_idx" ON "platform_provisioning_jobs"("tenantId");

-- CreateIndex
CREATE INDEX "platform_provisioning_jobs_status_idx" ON "platform_provisioning_jobs"("status");

-- CreateIndex
CREATE INDEX "platform_operation_events_tenantId_createdAt_idx" ON "platform_operation_events"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "platform_operation_events_eventType_idx" ON "platform_operation_events"("eventType");

-- CreateIndex
CREATE INDEX "users_tenantId_status_idx" ON "users"("tenantId", "status");

-- CreateIndex
CREATE INDEX "users_tenantId_lastLoginAt_idx" ON "users"("tenantId", "lastLoginAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "user_roles_tenantId_roleCode_idx" ON "user_roles"("tenantId", "roleCode");

-- CreateIndex
CREATE INDEX "user_roles_assignedByUserId_idx" ON "user_roles"("assignedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_tenantId_userId_roleCode_key" ON "user_roles"("tenantId", "userId", "roleCode");

-- CreateIndex
CREATE UNIQUE INDEX "invites_tokenHash_key" ON "invites"("tokenHash");

-- CreateIndex
CREATE INDEX "invites_tenantId_email_idx" ON "invites"("tenantId", "email");

-- CreateIndex
CREATE INDEX "invites_tenantId_status_idx" ON "invites"("tenantId", "status");

-- CreateIndex
CREATE INDEX "invites_expiresAt_idx" ON "invites"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionTokenHash_key" ON "sessions"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "sessions_tenantId_userId_idx" ON "sessions"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenantId_key_key" ON "tenant_settings"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "product_capabilities_tenantId_capabilityCode_key" ON "product_capabilities"("tenantId", "capabilityCode");

-- CreateIndex
CREATE INDEX "locations_tenantId_status_idx" ON "locations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "locations_tenantId_city_idx" ON "locations"("tenantId", "city");

-- CreateIndex
CREATE INDEX "locations_tenantId_region_idx" ON "locations"("tenantId", "region");

-- CreateIndex
CREATE INDEX "locations_tenantId_territory_idx" ON "locations"("tenantId", "territory");

-- CreateIndex
CREATE UNIQUE INDEX "locations_tenantId_externalCode_key" ON "locations"("tenantId", "externalCode");

-- CreateIndex
CREATE INDEX "location_contacts_tenantId_locationId_idx" ON "location_contacts"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "location_assignments_tenantId_representativeUserId_status_idx" ON "location_assignments"("tenantId", "representativeUserId", "status");

-- CreateIndex
CREATE INDEX "location_assignments_tenantId_locationId_status_idx" ON "location_assignments"("tenantId", "locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "location_assignments_tenantId_locationId_representativeUser_key" ON "location_assignments"("tenantId", "locationId", "representativeUserId");

-- CreateIndex
CREATE INDEX "products_tenantId_status_idx" ON "products"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_externalCode_key" ON "products"("tenantId", "externalCode");

-- CreateIndex
CREATE INDEX "route_plans_tenantId_planDate_idx" ON "route_plans"("tenantId", "planDate");

-- CreateIndex
CREATE INDEX "route_plans_tenantId_representativeUserId_planDate_idx" ON "route_plans"("tenantId", "representativeUserId", "planDate");

-- CreateIndex
CREATE UNIQUE INDEX "route_plans_tenantId_representativeUserId_planDate_key" ON "route_plans"("tenantId", "representativeUserId", "planDate");

-- CreateIndex
CREATE INDEX "route_items_tenantId_routePlanId_idx" ON "route_items"("tenantId", "routePlanId");

-- CreateIndex
CREATE INDEX "route_items_tenantId_locationId_idx" ON "route_items"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "route_items_tenantId_routePlanId_sequence_key" ON "route_items"("tenantId", "routePlanId", "sequence");

-- CreateIndex
CREATE INDEX "visits_tenantId_representativeUserId_startedAt_idx" ON "visits"("tenantId", "representativeUserId", "startedAt");

-- CreateIndex
CREATE INDEX "visits_tenantId_locationId_startedAt_idx" ON "visits"("tenantId", "locationId", "startedAt");

-- CreateIndex
CREATE INDEX "visits_tenantId_routeItemId_idx" ON "visits"("tenantId", "routeItemId");

-- CreateIndex
CREATE INDEX "visits_tenantId_status_idx" ON "visits"("tenantId", "status");

-- CreateIndex
CREATE INDEX "visits_tenantId_completedAt_idx" ON "visits"("tenantId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "visits_routeItemId_key" ON "visits"("routeItemId");

-- CreateIndex
CREATE INDEX "visit_notes_tenantId_visitId_idx" ON "visit_notes"("tenantId", "visitId");

-- CreateIndex
CREATE INDEX "visit_notes_temporaryAudioObjectId_idx" ON "visit_notes"("temporaryAudioObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "reports_visitId_key" ON "reports"("visitId");

-- CreateIndex
CREATE INDEX "reports_tenantId_confirmedAt_idx" ON "reports"("tenantId", "confirmedAt");

-- CreateIndex
CREATE INDEX "reports_tenantId_templateCode_idx" ON "reports"("tenantId", "templateCode");

-- CreateIndex
CREATE INDEX "reports_tenantId_representativeUserId_confirmedAt_idx" ON "reports"("tenantId", "representativeUserId", "confirmedAt");

-- CreateIndex
CREATE INDEX "reports_tenantId_locationId_confirmedAt_idx" ON "reports"("tenantId", "locationId", "confirmedAt");

-- CreateIndex
CREATE INDEX "tasks_tenantId_assignedToUserId_status_idx" ON "tasks"("tenantId", "assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "tasks_tenantId_dueDate_idx" ON "tasks"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "tasks_tenantId_locationId_idx" ON "tasks"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "tasks_tenantId_visitId_idx" ON "tasks"("tenantId", "visitId");

-- CreateIndex
CREATE INDEX "import_jobs_tenantId_type_createdAt_idx" ON "import_jobs"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "import_jobs_tenantId_status_idx" ON "import_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "import_row_issues_tenantId_importJobId_idx" ON "import_row_issues"("tenantId", "importJobId");

-- CreateIndex
CREATE INDEX "import_row_issues_tenantId_importJobId_rowNumber_idx" ON "import_row_issues"("tenantId", "importJobId", "rowNumber");

-- CreateIndex
CREATE INDEX "ai_jobs_tenantId_visitId_idx" ON "ai_jobs"("tenantId", "visitId");

-- CreateIndex
CREATE INDEX "ai_jobs_tenantId_status_idx" ON "ai_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ai_jobs_expiresAt_idx" ON "ai_jobs"("expiresAt");

-- CreateIndex
CREATE INDEX "storage_objects_tenantId_purpose_idx" ON "storage_objects"("tenantId", "purpose");

-- CreateIndex
CREATE INDEX "storage_objects_tenantId_expiresAt_idx" ON "storage_objects"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "storage_objects_tenantId_status_idx" ON "storage_objects"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "storage_objects_bucket_objectKey_key" ON "storage_objects"("bucket", "objectKey");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_createdAt_idx" ON "audit_events"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_entityType_entityId_idx" ON "audit_events"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_actorUserId_createdAt_idx" ON "audit_events"("tenantId", "actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "platform_provisioning_jobs" ADD CONSTRAINT "platform_provisioning_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "platform_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_operation_events" ADD CONSTRAINT "platform_operation_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "platform_tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_contacts" ADD CONSTRAINT "location_contacts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_assignments" ADD CONSTRAINT "location_assignments_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_assignments" ADD CONSTRAINT "location_assignments_representativeUserId_fkey" FOREIGN KEY ("representativeUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_assignments" ADD CONSTRAINT "location_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_representativeUserId_fkey" FOREIGN KEY ("representativeUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_items" ADD CONSTRAINT "route_items_routePlanId_fkey" FOREIGN KEY ("routePlanId") REFERENCES "route_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_items" ADD CONSTRAINT "route_items_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_representativeUserId_fkey" FOREIGN KEY ("representativeUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_routeItemId_fkey" FOREIGN KEY ("routeItemId") REFERENCES "route_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_temporaryAudioObjectId_fkey" FOREIGN KEY ("temporaryAudioObjectId") REFERENCES "storage_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_representativeUserId_fkey" FOREIGN KEY ("representativeUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_sourceFileObjectId_fkey" FOREIGN KEY ("sourceFileObjectId") REFERENCES "storage_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row_issues" ADD CONSTRAINT "import_row_issues_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_inputObjectId_fkey" FOREIGN KEY ("inputObjectId") REFERENCES "storage_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_temporaryTranscriptObjectId_fkey" FOREIGN KEY ("temporaryTranscriptObjectId") REFERENCES "storage_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
