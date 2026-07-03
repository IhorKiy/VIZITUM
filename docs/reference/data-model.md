# Data Model

Reference for the implemented database schema. Source of truth: `prisma/schema.prisma` (migrations in `prisma/migrations/`). This is the current state; `docs/vizitum-low-level-technical-design.md` §DB describes design intent and may differ. Update this document in the same change as any schema change.

**24 models**, one shared PostgreSQL database. Conceptual split: `platform_*` tables (tenant registry, operations) vs tenant-owned business tables (every one carries `tenantId`). Prisma migrations are the only allowed way to change production schema.

## Conventions

- IDs: `cuid()` strings.
- Tenant-owned tables: `tenantId` + `createdAt` + `updatedAt`; soft delete via `deletedAt` where user-facing records can be removed (`users`, `locations`, `location_contacts`, `products`, `tasks`, `visit_notes`, `storage_objects`).
- Uniqueness is tenant-scoped where it matters: `users @@unique([tenantId, email])`, `locations`/`products` `@@unique([tenantId, externalCode])`, `route_plans @@unique([tenantId, representativeUserId, planDate])`, `tenant_settings @@unique([tenantId, key])`.

## Platform group

| Model | Table | Purpose |
| --- | --- | --- |
| `PlatformTenant` | `platform_tenants` | Tenant registry: `slug` (unique, used in URLs), `status` (TenantStatus), `planCode`, `productMode`, `segmentTemplate`, `databasePlacement` (shared/dedicated), `timezone`, `language`. |
| `PlatformProvisioningJob` | `platform_provisioning_jobs` | Tenant provisioning job state (JobStatus, step, error). |
| `PlatformOperationEvent` | `platform_operation_events` | Platform-level event log (`eventType`, `metadata`, optional tenant). |

## Identity & config group

| Model | Table | Purpose |
| --- | --- | --- |
| `User` | `users` | Tenant user: `status` (invited/active/suspended/deleted), `passwordHash`, `lastSelectedRoleCode`. Email unique per tenant. |
| `UserRole` | `user_roles` | Role assignment (`roleCode`: company_admin / team_manager / field_representative), unique per (tenant, user, role). Users can hold multiple roles. |
| `Invite` | `invites` | Invite with `tokenHash` (raw token never stored), `roleCodes[]`, status (pending/accepted/expired/revoked), `expiresAt`. |
| `Session` | `sessions` | Backend session: `sessionTokenHash` (unique), `expiresAt`, `revokedAt`, hashed user agent/IP. |
| `TenantSetting` | `tenant_settings` | Key-value JSON settings per tenant (e.g. `products_enabled` used by the settings module). |
| `ProductCapability` | `product_capabilities` | Per-tenant feature flags (`capabilityCode`, `enabled`). |

## Field data group

| Model | Table | Purpose |
| --- | --- | --- |
| `Location` | `locations` | Visit points: address fields, `region`/`territory`, optional lat/long, LocationStatus. |
| `LocationContact` | `location_contacts` | Contacts attached to a location. |
| `LocationAssignment` | `location_assignments` | Representative ↔ location link with AssignmentStatus; unique per (tenant, location, representative). |
| `Product` | `products` | SKU catalog; `notApplicable` marks tenants that skip product tracking. |

## Routes & visits group

| Model | Table | Purpose |
| --- | --- | --- |
| `RoutePlan` | `route_plans` | One plan per representative per `planDate` (RouteStatus: draft→published→in_progress→completed/cancelled). |
| `RouteItem` | `route_items` | Ordered stop (`sequence` unique within plan) with RouteItemStatus (**planned / visited / skipped**), planned time window, `skipReason`. At most one visit per item (`Visit.routeItemId` unique). |
| `Visit` | `visits` | Visit lifecycle (VisitStatus: draft/in_progress/completed/cancelled) with `startedAt`/`completedAt`/`cancelledAt`; links location, representative, optional route item. |
| `VisitNote` | `visit_notes` | Text or audio note. Audio is referenced via `temporaryAudioObjectId` → `StorageObject` and is temporary processing data. |
| `Report` | `reports` | **The durable outcome of a visit** (one per visit, `visitId` unique): `templateCode` (SegmentTemplate), `schemaVersion`, `confirmedData` (JSON), `confirmedBy`/`confirmedAt`, optional `aiMetadata`. Default status `confirmed`. |
| `Task` | `tasks` | Follow-up work: status/priority, optional assignee, location, visit, report, `dueDate`. |

### Retention rule (product requirement)

Audio, transcript, and AI draft are **temporary processing data only**. After the report is confirmed, only the confirmed report plus minimal processing metadata (`Report.aiMetadata`) is retained. Temporary objects carry `expiresAt` and are removed by the cleanup worker (`src/worker.ts`).

## Imports group

| Model | Table | Purpose |
| --- | --- | --- |
| `ImportJob` | `import_jobs` | Validate-preview-then-confirm import (ImportType; ImportStatus: uploaded → validated/validation_failed → confirmed → applied/failed/cancelled) with row counters and `summary` JSON. |
| `ImportRowIssue` | `import_row_issues` | Row-level validation issue (severity error/warning, `code`, `message`, `rawValue`). |

## AI & storage group

| Model | Table | Purpose |
| --- | --- | --- |
| `AiJob` | `ai_jobs` | Transcription or extraction job (AiJobStatus), provider/model/prompt/schema versions, input object, temporary transcript object, `temporaryDraft` JSON, error fields, `expiresAt` for cleanup. |
| `StorageObject` | `storage_objects` | S3/R2 object metadata: `bucket` + `objectKey` (unique pair), purpose (temporary_audio / temporary_transcript / import_file / export_file / attachment), status (active/deleted/expired), `expiresAt` for temporary objects. |

## Audit group

| Model | Table | Purpose |
| --- | --- | --- |
| `AuditEvent` | `audit_events` | Tenant-scoped audit trail (`entityType`, `entityId`, `eventType`, `metadata`, `requestId`). Model exists; the `audit` backend module is still a placeholder. |

## Enums

Defined in `prisma/schema.prisma` and mirrored in TypeScript where needed:

`TenantStatus`, `PlanCode` (pilot/team/business), `ProductMode` (team/business), `DatabasePlacement` (shared/dedicated), `SegmentTemplate` (distribution/service/partner_account), `JobStatus`, `UserStatus`, `InviteStatus`, `RoleCode`, `LocationStatus`, `AssignmentStatus`, `ProductStatus`, `RouteStatus`, `RouteItemStatus`, `VisitStatus`, `VisitNoteInputType` (text/audio), `ReportStatus` (draft/confirmed/discarded), `TaskStatus`, `TaskPriority`, `ImportType`, `ImportStatus`, `ImportIssueSeverity`, `AiJobType`, `AiJobStatus`, `StorageObjectStatus`, `StorageObjectPurpose`.
