# Vizitum Low-Level Technical Design: Team Pilot

## 1. Purpose

This document translates the `Vizitum Team Pilot` HLD into implementation-level decisions for the first build.

It focuses on:

- database entities and Prisma schema shape;
- tenant isolation rules;
- roles and permissions;
- API contracts;
- imports;
- visits, reports, AI jobs and retention;
- background jobs;
- storage lifecycle;
- deployment and operations details.

Source documents:

- `docs/vizitum-mvp-product-spec-team-pilot.md`;
- `docs/vizitum-user-flows-horizontal-partition.md`;
- `docs/vizitum-technical-stack.md`;
- `docs/vizitum-high-level-technical-design.md`.

## 2. Implementation Scope

LLD scope is the first production-ready MVP:

- product: `Vizitum Team Pilot`;
- product mode: `team`;
- commercial mode: `pilot`;
- database placement: shared DB;
- supported segment templates: `distribution`, `service`, `partner_account`;
- primary demo template: `distribution`;
- frontend: Next.js web/PWA;
- backend: NestJS API;
- ORM: Prisma;
- database: PostgreSQL;
- jobs: Redis + BullMQ worker service;
- storage: Cloudflare R2 through S3-compatible abstraction;
- AI provider: OpenAI for transcription and structured extraction;
- deployment: Vercel frontend, Render API, Render workers.

Out of scope for this LLD:

- dedicated tenant DB self-service;
- Business access scopes;
- Executive Dashboard;
- native mobile app;
- full offline write queue;
- billing automation;
- ERP integrations;
- BI/report builder.

## 3. Database Layout

MVP uses PostgreSQL with conceptual separation between:

- platform data: tenant registry, provisioning, operations metadata;
- tenant business data: users, locations, visits, reports, tasks, imports.

For MVP these may live in one PostgreSQL database, but tables must preserve conceptual boundaries through naming, modules and data access rules.

Recommended schema naming:

```text
public
  platform_* tables
  tenant-owned business tables with tenant_id
```

Every tenant-owned table must include:

- `tenant_id`;
- `created_at`;
- `updated_at`;
- soft-delete field where user-facing records can be removed without losing history.

Use Prisma migrations as the source of truth. Manual production schema edits are not allowed.

## 4. Core Enums

These enums should be defined in Prisma and mirrored in TypeScript contracts where needed.

```ts
TenantStatus =
  | 'draft'
  | 'provisioning'
  | 'ready'
  | 'pilot_active'
  | 'active'
  | 'suspended'
  | 'archived'

PlanCode = 'pilot' | 'team' | 'business'
ProductMode = 'team' | 'business'
DatabasePlacement = 'shared' | 'dedicated'
SegmentTemplate = 'distribution' | 'service' | 'partner_account'

UserStatus = 'invited' | 'active' | 'suspended' | 'deleted'
InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

LocationStatus = 'active' | 'inactive' | 'archived'
LocationAssignmentStatus = 'active' | 'inactive'

RouteStatus = 'draft' | 'published' | 'in_progress' | 'completed' | 'cancelled'
RouteItemStatus = 'planned' | 'visited' | 'skipped'

VisitStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled'
ReportStatus = 'draft' | 'confirmed' | 'discarded'

TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled'
TaskPriority = 'low' | 'normal' | 'high'

ImportType = 'users' | 'locations' | 'contacts' | 'products' | 'initial_visit_task_plan'
ImportStatus = 'uploaded' | 'validated' | 'validation_failed' | 'confirmed' | 'applied' | 'failed' | 'cancelled'

AiJobType = 'transcription' | 'extraction'
AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
```

## 5. Prisma Model Groups

This section defines the intended Prisma model shape. Exact field names may be refined during implementation, but the relationships and constraints should remain stable.

### 5.1 Platform Models

#### PlatformTenant

Stores the tenant registry and routing source of truth.

Key fields:

- `id`;
- `name`;
- `slug`;
- `country`;
- `timezone`;
- `language`;
- `status`;
- `planCode`;
- `productMode`;
- `segmentTemplate`;
- `databasePlacement`;
- `databaseKey`;
- `primaryDomain`;
- `createdAt`;
- `updatedAt`;
- `archivedAt`.

Constraints and indexes:

- unique `slug`;
- index `status`;
- index `databasePlacement`;
- index `segmentTemplate`.

Notes:

- `databaseKey` identifies the shared DB pool or dedicated DB connection profile.
- Client requests never provide `tenantId` as source of truth. Tenant is resolved by host/slug/session.

#### PlatformProvisioningJob

Tracks tenant provisioning and setup jobs.

Key fields:

- `id`;
- `tenantId`;
- `status`;
- `step`;
- `errorCode`;
- `errorMessage`;
- `startedAt`;
- `finishedAt`;
- `createdAt`;
- `updatedAt`.

#### PlatformOperationEvent

Stores platform-level operational events without sensitive tenant business content.

Key fields:

- `id`;
- `tenantId`;
- `actorUserId`;
- `eventType`;
- `metadata`;
- `requestId`;
- `createdAt`.

### 5.2 Tenant Identity Models

#### User

Represents a person inside one tenant workspace.

Key fields:

- `id`;
- `tenantId`;
- `email`;
- `name`;
- `phone`;
- `status`;
- `passwordHash`;
- `lastLoginAt`;
- `lastSelectedRoleCode`;
- `createdAt`;
- `updatedAt`;
- `deletedAt`.

Constraints and indexes:

- unique `tenantId + email`;
- index `tenantId + status`;
- index `tenantId + lastLoginAt`.

Notes:

- A single email can exist in multiple tenants.
- Within one tenant, one user can have multiple roles.

#### UserRole

Assigns roles to users.

Key fields:

- `id`;
- `tenantId`;
- `userId`;
- `roleCode`;
- `assignedByUserId`;
- `createdAt`.

Constraints:

- unique `tenantId + userId + roleCode`.

#### Invite

Stores invite links for onboarding.

Key fields:

- `id`;
- `tenantId`;
- `email`;
- `roleCodes`;
- `tokenHash`;
- `status`;
- `expiresAt`;
- `acceptedAt`;
- `acceptedByUserId`;
- `createdByUserId`;
- `createdAt`;
- `updatedAt`.

Constraints and indexes:

- unique `tokenHash`;
- index `tenantId + email`;
- index `tenantId + status`.

#### Session

Stores backend-owned cookie sessions.

Key fields:

- `id`;
- `tenantId`;
- `userId`;
- `sessionTokenHash`;
- `expiresAt`;
- `revokedAt`;
- `createdAt`;
- `lastSeenAt`;
- `userAgentHash`;
- `ipHash`.

Constraints:

- unique `sessionTokenHash`;
- index `tenantId + userId`;
- index `expiresAt`.

Security notes:

- Browser receives only a secure HTTP-only cookie.
- Cookie write requests must use CSRF protection.
- Logout revokes the session record.

### 5.3 Tenant Configuration Models

#### TenantSetting

Stores tenant-level settings not hardcoded by product mode.

Key fields:

- `id`;
- `tenantId`;
- `key`;
- `value`;
- `updatedByUserId`;
- `createdAt`;
- `updatedAt`.

Constraints:

- unique `tenantId + key`.

#### ProductCapability

Stores enabled capability flags for the tenant.

Key fields:

- `id`;
- `tenantId`;
- `capabilityCode`;
- `enabled`;
- `createdAt`;
- `updatedAt`.

Constraints:

- unique `tenantId + capabilityCode`.

### 5.4 Location and Contact Models

#### Location

Represents pharmacies, stores, partners, clinics, clients or other visit targets.

Key fields:

- `id`;
- `tenantId`;
- `externalCode`;
- `name`;
- `type`;
- `status`;
- `addressLine`;
- `city`;
- `region`;
- `territory`;
- `latitude`;
- `longitude`;
- `notes`;
- `createdAt`;
- `updatedAt`;
- `deletedAt`.

Constraints and indexes:

- unique nullable `tenantId + externalCode`;
- index `tenantId + status`;
- index `tenantId + city`;
- index `tenantId + region`;
- index `tenantId + territory`;
- search index strategy to be decided during implementation: PostgreSQL trigram or normalized search columns.

Notes:

- `region` and `territory` are simple filters in MVP, not permission boundaries.

#### LocationContact

Represents people connected to a location.

Key fields:

- `id`;
- `tenantId`;
- `locationId`;
- `name`;
- `roleTitle`;
- `phone`;
- `email`;
- `notes`;
- `createdAt`;
- `updatedAt`;
- `deletedAt`.

Indexes:

- `tenantId + locationId`.

#### LocationAssignment

Assigns locations to field representatives.

Key fields:

- `id`;
- `tenantId`;
- `locationId`;
- `representativeUserId`;
- `status`;
- `assignedByUserId`;
- `createdAt`;
- `updatedAt`.

Constraints:

- unique `tenantId + locationId + representativeUserId`.

Indexes:

- `tenantId + representativeUserId + status`;
- `tenantId + locationId + status`.

### 5.5 Product Models

#### Product

Represents a product, SKU or service item used in visit reports.

Key fields:

- `id`;
- `tenantId`;
- `externalCode`;
- `name`;
- `sku`;
- `category`;
- `status`;
- `notApplicable`;
- `createdAt`;
- `updatedAt`;
- `deletedAt`.

Constraints:

- unique nullable `tenantId + externalCode`;
- index `tenantId + status`.

Notes:

- If products are not applicable for a pilot, store a tenant setting/capability rather than creating fake products.

### 5.6 Routes and Daily Plans

#### RoutePlan

Represents a representative's plan for one day.

Key fields:

- `id`;
- `tenantId`;
- `representativeUserId`;
- `planDate`;
- `status`;
- `createdByUserId`;
- `publishedAt`;
- `createdAt`;
- `updatedAt`.

Constraints:

- unique `tenantId + representativeUserId + planDate`.

Indexes:

- `tenantId + planDate`;
- `tenantId + representativeUserId + planDate`.

#### RouteItem

Represents one planned location in a daily plan.

Key fields:

- `id`;
- `tenantId`;
- `routePlanId`;
- `locationId`;
- `sequence`;
- `status`;
- `plannedStartTime`;
- `plannedEndTime`;
- `visitId`;
- `skipReason`;
- `createdAt`;
- `updatedAt`.

Constraints:

- unique `tenantId + routePlanId + sequence`.

Indexes:

- `tenantId + routePlanId`;
- `tenantId + locationId`;

### 5.7 Visits, Reports and Tasks

#### Visit

Represents an actual or in-progress visit.

Key fields:

- `id`;
- `tenantId`;
- `locationId`;
- `representativeUserId`;
- `routeItemId`;
- `visitType`;
- `status`;
- `startedAt`;
- `completedAt`;
- `cancelledAt`;
- `createdAt`;
- `updatedAt`.

Indexes:

- `tenantId + representativeUserId + startedAt`;
- `tenantId + locationId + startedAt`;
- `tenantId + status`;
- `tenantId + completedAt`.

#### VisitNote

Temporary note input during report creation.

Key fields:

- `id`;
- `tenantId`;
- `visitId`;
- `inputType`;
- `textContent`;
- `temporaryAudioObjectId`;
- `createdByUserId`;
- `createdAt`;
- `deletedAt`.

Notes:

- Audio and transcript are temporary processing inputs.
- Raw audio/transcript must be deleted after final confirmation or after retry window expiration.

#### Report

Stores only the final confirmed business report.

Key fields:

- `id`;
- `tenantId`;
- `visitId`;
- `locationId`;
- `representativeUserId`;
- `templateCode`;
- `schemaVersion`;
- `status`;
- `confirmedData`;
- `confirmedByUserId`;
- `confirmedAt`;
- `aiMetadata`;
- `createdAt`;
- `updatedAt`.

Constraints:

- unique `tenantId + visitId` for the final report in MVP.

Indexes:

- `tenantId + confirmedAt`;
- `tenantId + templateCode`;
- `tenantId + representativeUserId + confirmedAt`;
- `tenantId + locationId + confirmedAt`.

Notes:

- `confirmedData` is JSON matching the selected template schema.
- Do not persist raw transcript or draft after confirmation.
- `aiMetadata` may include `promptVersion`, `schemaVersion`, model/provider, job timestamps and status.

#### Task

Represents follow-up work.

Key fields:

- `id`;
- `tenantId`;
- `title`;
- `description`;
- `status`;
- `priority`;
- `assignedToUserId`;
- `createdByUserId`;
- `locationId`;
- `visitId`;
- `reportId`;
- `dueDate`;
- `completedAt`;
- `createdAt`;
- `updatedAt`;
- `deletedAt`.

Indexes:

- `tenantId + assignedToUserId + status`;
- `tenantId + dueDate`;
- `tenantId + locationId`;
- `tenantId + visitId`;

### 5.8 Import Models

#### ImportJob

Tracks import lifecycle.

Key fields:

- `id`;
- `tenantId`;
- `type`;
- `status`;
- `sourceFileObjectId`;
- `uploadedByUserId`;
- `confirmedByUserId`;
- `rowCount`;
- `validRowCount`;
- `errorRowCount`;
- `warningRowCount`;
- `summary`;
- `createdAt`;
- `validatedAt`;
- `confirmedAt`;
- `appliedAt`;
- `failedAt`;
- `updatedAt`.

Indexes:

- `tenantId + type + createdAt`;
- `tenantId + status`.

#### ImportRowIssue

Stores validation errors and warnings.

Key fields:

- `id`;
- `tenantId`;
- `importJobId`;
- `rowNumber`;
- `fieldName`;
- `severity`;
- `code`;
- `message`;
- `rawValue`;
- `createdAt`.

Indexes:

- `tenantId + importJobId`;
- `tenantId + importJobId + rowNumber`.

Notes:

- MVP import is all-or-nothing.
- Invalid rows block confirm/apply.

### 5.9 AI and Storage Models

#### AiJob

Tracks transcription and extraction work.

Key fields:

- `id`;
- `tenantId`;
- `visitId`;
- `type`;
- `status`;
- `provider`;
- `model`;
- `promptVersion`;
- `schemaVersion`;
- `inputObjectId`;
- `temporaryTranscriptObjectId`;
- `temporaryDraft`;
- `errorCode`;
- `errorMessage`;
- `startedAt`;
- `finishedAt`;
- `expiresAt`;
- `createdAt`;
- `updatedAt`.

Indexes:

- `tenantId + visitId`;
- `tenantId + status`;
- `expiresAt`.

Retention notes:

- `temporaryDraft`, transcript references and raw audio references must be deleted after report confirmation.
- Failed jobs may keep temporary data only until retry window expires, up to 24 hours.

#### StorageObject

Registers files stored in Cloudflare R2.

Key fields:

- `id`;
- `tenantId`;
- `bucket`;
- `objectKey`;
- `purpose`;
- `contentType`;
- `sizeBytes`;
- `checksum`;
- `status`;
- `expiresAt`;
- `createdByUserId`;
- `createdAt`;
- `deletedAt`.

Indexes:

- `tenantId + purpose`;
- `tenantId + expiresAt`;
- `tenantId + status`.

Path examples:

```text
tenants/{tenantId}/tmp/audio/{visitId}/{fileId}
tenants/{tenantId}/imports/{importId}/{fileName}
tenants/{tenantId}/exports/{exportId}/{fileName}
```

### 5.10 Audit Model

#### AuditEvent

Stores tenant-scoped business audit events without raw sensitive content.

Key fields:

- `id`;
- `tenantId`;
- `actorUserId`;
- `entityType`;
- `entityId`;
- `eventType`;
- `metadata`;
- `requestId`;
- `createdAt`.

Indexes:

- `tenantId + createdAt`;
- `tenantId + entityType + entityId`;
- `tenantId + actorUserId + createdAt`.

## 6. Tenant Isolation Rules

Backend isolation rules:

- Resolve tenant from host/slug/session before controller logic.
- Build `RequestContext` with `tenantId`, `userId`, `roleCodes`, `permissions`, `requestId`.
- Never trust `tenantId` from request body.
- All tenant-owned Prisma queries must include tenant filter.
- Use repository/service helpers that require `tenantId` explicitly.
- Background jobs must include `tenantId` and either `actorUserId` or system actor metadata.
- Integration tests must create two tenants and verify cross-tenant reads/writes fail.

RLS:

- PostgreSQL RLS is not enabled for MVP.
- RLS remains a future hardening option after access patterns stabilize.

## 7. Roles and Permissions

Permission checks must use permission keys, not only role names.

### 7.1 MVP Roles

```ts
RoleCode =
  | 'platform_owner'
  | 'company_admin'
  | 'team_manager'
  | 'field_representative'
```

`platform_owner` is a platform-level role. Tenant user roles are:

- `company_admin`;
- `team_manager`;
- `field_representative`.

### 7.2 Permission Keys

Initial permission constants:

```ts
platform.tenants.read
platform.tenants.manage
platform.operations.read

tenant.settings.read
tenant.settings.manage

users.read
users.invite
users.manage
roles.assign

locations.read
locations.manage
locations.assign

contacts.read
contacts.manage

products.read
products.manage

routes.read
routes.manage_team
routes.manage_own

visits.read_own
visits.read_team
visits.create
visits.update_own
visits.cancel_own

reports.read_own
reports.read_team
reports.confirm_own

tasks.read_own
tasks.read_team
tasks.create
tasks.update_own
tasks.update_team

imports.read
imports.upload
imports.confirm

ai.use_reporting

dashboard.manager.read
pilot_review.read

audit.read
```

### 7.3 Role-Permission Matrix

Platform Owner:

- `platform.tenants.read`;
- `platform.tenants.manage`;
- `platform.operations.read`.

Company Admin:

- `tenant.settings.read`;
- `tenant.settings.manage`;
- `users.read`;
- `users.invite`;
- `users.manage`;
- `roles.assign`;
- `locations.read`;
- `locations.manage`;
- `locations.assign`;
- `contacts.read`;
- `contacts.manage`;
- `products.read`;
- `products.manage`;
- `imports.read`;
- `imports.upload`;
- `imports.confirm`;
- `audit.read`.

Team Manager:

- `locations.read`;
- `contacts.read`;
- `products.read`;
- `routes.read`;
- `routes.manage_team`;
- `visits.read_team`;
- `reports.read_team`;
- `tasks.read_team`;
- `tasks.create`;
- `tasks.update_team`;
- `dashboard.manager.read`;
- `pilot_review.read`.

Field Representative:

- `locations.read`;
- `contacts.read`;
- `products.read`;
- `routes.read`;
- `routes.manage_own`;
- `visits.read_own`;
- `visits.create`;
- `visits.update_own`;
- `visits.cancel_own`;
- `reports.read_own`;
- `reports.confirm_own`;
- `tasks.read_own`;
- `tasks.create`;
- `tasks.update_own`;
- `ai.use_reporting`.

Rules:

- Multiple roles are additive.
- Product capabilities may disable permission groups at runtime.
- Team Manager in MVP has full tenant operational view, not admin/settings/import rights.

## 8. API Contract Rules

All API responses use JSON.

List response shape:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 25,
  "total": 0,
  "totalPages": 0
}
```

Error response shape:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Validation failed.",
  "details": {},
  "fieldErrors": {
    "email": ["Email is required."]
  },
  "requestId": "req_..."
}
```

Rules:

- Validate request bodies with DTO validation.
- Validate query filters against whitelist.
- Pagination defaults: `page=1`, `pageSize=25`.
- Maximum `pageSize=100`.
- Sort fields must be whitelisted per endpoint.
- `requestId` must be returned on errors.

## 9. Initial API Surface

### 9.1 Auth

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/invites/accept
```

### 9.2 Platform

```text
GET  /api/platform/tenants
POST /api/platform/tenants
GET  /api/platform/tenants/:tenantId
GET  /api/platform/tenants/:tenantId/provisioning
```

### 9.3 Tenant Admin

```text
GET   /api/admin/settings
PATCH /api/admin/settings

GET   /api/admin/users
POST  /api/admin/users/invite
PATCH /api/admin/users/:userId
POST  /api/admin/users/:userId/roles
DELETE /api/admin/users/:userId/roles/:roleCode
```

### 9.4 Locations and Products

```text
GET   /api/locations
POST  /api/locations
GET   /api/locations/:locationId
PATCH /api/locations/:locationId
GET   /api/locations/:locationId/contacts
POST  /api/locations/:locationId/contacts
POST  /api/locations/:locationId/assignments

GET   /api/products
POST  /api/products
PATCH /api/products/:productId
```

### 9.5 Routes, Visits, Reports and Tasks

```text
GET   /api/routes/today
GET   /api/routes
POST  /api/routes
PATCH /api/routes/:routePlanId
POST  /api/routes/:routePlanId/items
PATCH /api/routes/:routePlanId/items/:routeItemId

POST  /api/visits
GET   /api/visits
GET   /api/visits/:visitId
PATCH /api/visits/:visitId

POST  /api/visits/:visitId/notes/text
POST  /api/visits/:visitId/notes/audio-upload
POST  /api/visits/:visitId/ai/extract
GET   /api/visits/:visitId/ai/status
POST  /api/visits/:visitId/reports/confirm

GET   /api/tasks
POST  /api/tasks
PATCH /api/tasks/:taskId
```

### 9.6 Imports

```text
POST /api/imports/upload
GET  /api/imports
GET  /api/imports/:importJobId
POST /api/imports/:importJobId/validate
POST /api/imports/:importJobId/confirm
```

### 9.7 Manager Dashboard

```text
GET /api/manager/dashboard
GET /api/manager/pilot-review
```

## 10. Import Templates

MVP supports direct `.xlsx` import for approved templates and `.csv` fallback.

All imports are:

- tenant-scoped;
- preview/validation first;
- explicit confirmation second;
- all-or-nothing.

### 10.1 Users Import

Required columns:

- `email`;
- `name`;
- `roles`.

Optional columns:

- `phone`;
- `external_code`.

Validation:

- email required and valid;
- email unique within tenant;
- roles must be from allowed tenant roles;
- duplicate emails in file are blocking.

### 10.2 Locations Import

Required columns:

- `name`;
- `address_line`;
- `city`.

Optional columns:

- `external_code`;
- `type`;
- `region`;
- `territory`;
- `latitude`;
- `longitude`;
- `assigned_representative_email`;
- `notes`.

Validation:

- name required;
- city required;
- external code unique if provided;
- assigned representative must exist or be present in the same import plan;
- duplicate name/address is warning, not automatic merge.

### 10.3 Contacts Import

Required columns:

- `location_external_code` or `location_name`;
- `name`.

Optional columns:

- `role_title`;
- `phone`;
- `email`;
- `notes`.

Validation:

- location reference must resolve to exactly one location;
- email must be valid if provided;
- unresolved location is blocking.

### 10.4 Products Import

Required columns:

- `name`.

Optional columns:

- `external_code`;
- `sku`;
- `category`.

Validation:

- name required;
- external code unique if provided;
- if products are marked not applicable for tenant, product import is disabled unless Company Admin changes setting.

### 10.5 Initial Visit/Task Plan Import

Required columns:

- `representative_email`;
- `location_external_code` or `location_name`;
- `plan_date`.

Optional columns:

- `sequence`;
- `planned_start_time`;
- `planned_end_time`;
- `task_title`;
- `task_due_date`;
- `task_priority`.

Validation:

- representative must exist and have field role;
- location must be assigned or assignment can be created during import if Company Admin confirms;
- plan date must be valid;
- one representative cannot have duplicate sequence for the same day.

## 11. AI Reporting Schemas

AI extraction creates an editable draft only. The final stored business object is the confirmed report.

Shared fields for all report templates:

```json
{
  "summary": "string",
  "outcome": "string",
  "issues": [],
  "nextSteps": [],
  "suggestedTasks": [],
  "confidence": 0.0
}
```

### 11.1 Distribution Report

Additional fields:

```json
{
  "productsChecked": [
    {
      "productId": "string | null",
      "productName": "string",
      "availability": "available | unavailable | low_stock | unknown",
      "shelfPresence": "yes | no | unknown",
      "comment": "string | null",
      "confidence": 0.0
    }
  ],
  "stockIssues": [],
  "merchandisingIssues": []
}
```

### 11.2 Service Report

Additional fields:

```json
{
  "serviceCategory": "string",
  "problemObserved": "string | null",
  "actionTaken": "string | null",
  "resolutionStatus": "resolved | partially_resolved | unresolved | unknown",
  "customerFeedback": "string | null"
}
```

### 11.3 Partner Account Report

Additional fields:

```json
{
  "contactPerson": "string | null",
  "agreementReached": "string | null",
  "partnerPotential": "low | medium | high | unknown",
  "risks": [],
  "commercialNextSteps": []
}
```

Retention rule:

- raw audio is temporary only;
- transcript is temporary only;
- AI draft is temporary only;
- after confirmation, store only final confirmed report and minimal AI metadata.

## 12. Background Jobs

BullMQ queues:

```text
provisioning
imports
ai
exports
cleanup
```

All job payloads include:

```json
{
  "tenantId": "string",
  "actorUserId": "string | null",
  "requestId": "string",
  "jobType": "string",
  "entityId": "string"
}
```

### 12.1 Import Jobs

Flow:

1. Upload file.
2. Create `StorageObject`.
3. Create `ImportJob`.
4. Parse expected sheet.
5. Validate rows.
6. Store `ImportRowIssue`.
7. Show preview.
8. Company Admin confirms.
9. Apply import in transaction where practical.
10. Write audit event.

### 12.2 AI Jobs

Flow:

1. Upload temporary audio or submit text note.
2. Create `VisitNote`.
3. Enqueue transcription if audio.
4. Enqueue extraction.
5. Store temporary draft in `AiJob`.
6. User reviews and edits.
7. Confirm report.
8. Delete temporary audio/transcript/draft.
9. Create tasks only from confirmed report.

Retry:

- transient provider/storage failures: retry with exponential backoff;
- validation/schema failures: mark failed and allow manual report;
- failed temporary data expires within 24 hours.

### 12.3 Cleanup Jobs

Cleanup must delete:

- expired session records;
- expired invites;
- temporary audio after confirmation or retry window;
- temporary transcripts/drafts after confirmation or retry window;
- expired import upload files where allowed.

## 13. Storage Lifecycle

Provider:

- Cloudflare R2 through S3-compatible abstraction.

Access rules:

- private buckets only;
- no public sensitive files;
- signed URLs are short-lived;
- object keys are tenant-scoped;
- logs must not include object contents or raw transcript text.

Retention:

- temporary audio: delete after report confirmation or after failed retry window, maximum 24 hours;
- temporary transcript: delete after report confirmation or after failed retry window, maximum 24 hours;
- import files: keep only as long as needed for validation/support, default 7-14 days unless removed earlier;
- confirmed reports: stored in PostgreSQL as business records.

## 14. Observability

MVP uses:

- Sentry for frontend/backend errors and basic performance monitoring;
- structured JSON logs in API/workers;
- Render service logs;
- BullMQ job status visibility.

Required correlation fields:

- `requestId`;
- `jobId`;
- `tenantId`;
- `actorUserId` where available;
- `module`;
- `operation`.

Minimum alerts:

- API error rate above threshold;
- repeated tenant resolution failures;
- import job failures;
- transcription/extraction failures;
- cleanup failures;
- database connectivity failures.

Sensitive content must never be logged:

- raw notes;
- transcripts;
- audio contents;
- final report free text beyond safe identifiers.

## 15. Backup and Restore

MVP uses managed PostgreSQL backups:

- automated daily backups;
- point-in-time recovery if provider supports it;
- retain 7-14 days for MVP;
- pre-migration backup/snapshot before risky migrations.

Before production pilot:

- restore backup into staging/test database;
- verify app startup;
- verify tenant registry;
- verify users, locations, visits, reports and tasks are readable;
- document manual restore runbook.

Because the MVP shared DB contains multiple tenants, restore operations can affect all tenants and must be performed manually with explicit operational approval.

## 16. Implementation Order

Recommended engineering sequence:

1. Repository/app skeleton.
2. PostgreSQL + Prisma setup.
3. Platform tenant registry.
4. Tenant resolver and request context.
5. Auth, sessions and invites.
6. Roles, permissions and guards.
7. Users and locations.
8. Route plans and visits.
9. Manual reports and tasks.
10. Imports.
11. Storage abstraction and R2.
12. AI reporting jobs.
13. Manager dashboard.
14. Pilot review metrics.
15. Observability, cleanup and backup drills.

## 17. LLD Definition of Done

This LLD is ready for implementation when:

- Prisma models are converted into `schema.prisma`;
- permission constants and role matrix are created in code;
- API DTOs are implemented with validation;
- tenant-aware repository/service patterns are enforced;
- import templates are available as downloadable files;
- AI schemas are represented as JSON Schema or Zod schemas;
- worker queues are configured;
- storage lifecycle cleanup is implemented;
- tenant isolation tests exist in CI.
