# Data Model

Reference for the implemented database schema. Source of truth: `prisma/schema.prisma` (migrations in `prisma/migrations/`). This is the current state; `docs/vizitum-low-level-technical-design.md` §DB describes design intent and may differ. Update this document in the same change as any schema change.

**27 models**, one shared PostgreSQL database. Conceptual split: `platform_*` tables (tenant registry, platform identity, operations) vs tenant-owned business tables (every one carries `tenantId`). Prisma migrations are the only allowed way to change production schema.

## Conventions

- IDs: `cuid()` strings.
- Tenant-owned tables: `tenantId` + `createdAt` + `updatedAt`; soft delete via `deletedAt` where user-facing records can be removed (`users`, `locations`, `location_contacts`, `products`, `tasks`, `visit_notes`, `storage_objects`).
- Uniqueness is tenant-scoped where it matters: `users @@unique([tenantId, email])`, `locations @@unique([tenantId, externalCode])`, `route_plans @@unique([tenantId, representativeUserId, planDate])`, `tenant_settings @@unique([tenantId, key])`. `products` uniqueness on `(tenantId, externalCode)` is a **partial** unique index scoped to live rows (`WHERE deletedAt IS NULL`, migration `20260713120000_product_external_code_partial_unique`) — not a plain `@@unique`, so a soft-deleted product frees its externalCode for re-import/re-create (matches the `deletedAt: null` create + import pre-checks). Prisma can't express partial unique indexes, so it's managed via raw SQL and omitted from `schema.prisma`.

## Platform group

| Model | Table | Purpose |
| --- | --- | --- |
| `PlatformTenant` | `platform_tenants` | Tenant registry: `slug` (unique, used in URLs), `status` (TenantStatus — doubles as the plan tier for a live tenant: `pilot`/`team`/`business`, or `suspended`/`archived`; there is no separate plan field), `productMode`, `segmentTemplate`, `databasePlacement` (shared/dedicated), `country`, `timezone`, `language`, `contactName`/`contactEmail`/`contactPhone` (String?, nullable — primary contact captured at creation and shown in the platform console's Tenant information block; the `POST /platform/tenants` create flow requires all three, older rows predating them are null), `adminLimit` (Int?, nullable — the max active `company_admin` users, enforced by `UsersService`. NULL means the cap derives from the plan tier: pilot 0, team 1, business 2, suspended 0, other/legacy statuses fall back to 2 = `DEFAULT_ADMIN_LIMIT`; see `adminCapForStatus`/`resolveAdminCap` in `src/modules/users/users.types.ts`. A number is a deliberate platform-owner override, set/cleared via `PATCH /platform/tenants/:tenantId`. Platform tenant API responses expose the effective cap as `adminLimit`, the raw override as `adminLimitOverride`, and the plan-derived value as `adminLimitPlanDefault`). Two-stage deletion markers: `archivedAt` (set by archive), `purgeRequestedAt` (platform owner's explicit early-purge mark on an archived tenant; cleared by unarchive), `purgeStartedAt` (stamped by the purge worker before it deletes anything — the point of no return: unarchive refuses once set). The `purge` worker deletes an eligible tenant's data and finally the row itself; `PlatformOperationEvent` rows survive via `onDelete: SetNull`. |
| `PlatformUser` | `platform_users` | Platform-owner identity, separate from tenant `users`: `email` (globally unique), `passwordHash`, `status` (PlatformUserStatus: active/suspended). Holds the `platform_owner` role. |
| `PlatformSession` | `platform_sessions` | Platform-owner session (token hash, expiry, revoke) for `vizitum_platform_session`; mirrors `sessions` but keyed by `platformUserId`, no `tenantId`. |
| `PlatformProvisioningJob` | `platform_provisioning_jobs` | Tenant provisioning job state (JobStatus, step, error). Legacy: tenants are created straight into `pilot` and no longer get a job row; existing rows are kept for history and still readable via `GET /platform/tenants/:tenantId`. |
| `PlatformOperationEvent` | `platform_operation_events` | Platform-level event log (`eventType`, `metadata`, optional tenant). |

## Identity & config group

| Model | Table | Purpose |
| --- | --- | --- |
| `User` | `users` | Tenant user: `status` (invited/active/suspended/deleted), `passwordHash`, `lastSelectedRoleCode`, `lastSelectedZone` (NavZone?; frontend nav grouping, not part of the permission model — set by `POST /auth/zone`, see [api-reference.md](api-reference.md) and [module-map.md](module-map.md)). Email unique per tenant. |
| `UserRole` | `user_roles` | Role assignment (`roleCode`: tenant_superadmin / company_admin / team_manager / field_representative), unique per (tenant, user, role). Users can hold multiple roles, but a `tenant_superadmin` holds only that single role — see [permissions.md](permissions.md). |
| `Invite` | `invites` | Invite with `tokenHash` (raw token never stored), `roleCodes[]`, status (pending/accepted/expired/revoked), `expiresAt`. |
| `Session` | `sessions` | Backend session: `sessionTokenHash` (unique), `expiresAt`, `revokedAt`, hashed user agent/IP. |
| `TenantSetting` | `tenant_settings` | Key-value JSON settings per tenant (e.g. `products_enabled` used by the settings module). |
| `ProductCapability` | `product_capabilities` | Per-tenant feature flags (`capabilityCode`, `enabled`). |

## Field data group

| Model | Table | Purpose |
| --- | --- | --- |
| `Chain` | `chains` | Retail chain/network a location belongs to (ChainStatus active/archived). Canonical per-tenant list, unique on `(tenant, name)` and `(tenant, externalCode)`; `Location.chainId` → `Chain` is optional and `SetNull` on chain delete. |
| `Location` | `locations` | Visit points: address fields, `region`/`territory`, optional lat/long, LocationStatus, optional `chainId` → `Chain`. |
| `LocationContact` | `location_contacts` | Contacts attached to a location. |
| `LocationAssignment` | `location_assignments` | Representative ↔ location link with AssignmentStatus; unique per (tenant, location, representative). |
| `Product` | `products` | SKU catalog. `notApplicable` is a **deprecated** legacy flag — no longer read/written by the web UI (kept as a column, still accepted by the API); see api-reference Products note. Soft-deleted via `deletedAt` (all reads filter `deletedAt: null`). |
| `ProductCategory` | `product_categories` | Curated per-tenant category labels for grouping products (managed from the admin Products screen). Names are unique per tenant **case-insensitively** — enforced by a functional unique index on `(tenantId, lower(name))` (raw SQL, since Prisma can't express it declaratively), so "Beverages" and "beverages" can't coexist; the display name is stored exactly as typed. Hard-deleted — no FK from `products.category`, which stays a free-text string; renames cascade case-insensitively to matching `products.category` values. |

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
| `AuditEvent` | `audit_events` | Tenant-scoped audit trail (`entityType`, `entityId`, `eventType`, `metadata`, `requestId`), written via `AuditService.recordEvent`. Used for `manager_dashboard.viewed` events (`pilot-review` module) and the superadmin/admin lifecycle (`admin.invited`/`admin.suspended`/`admin.reactivated`/`admin.deleted`/`admin.role_granted`/`admin.role_revoked`/`superadmin.invited`/`superadmin.promoted`/`superadmin.replaced`, from `UsersService`, `PlatformService` and `AuthService.acceptInvite`). |

## Enums

Defined in `prisma/schema.prisma` and mirrored in TypeScript where needed:

`TenantStatus` (draft/provisioning/ready/active retired — see `PlatformTenant` above; `pilot`/`team`/`business` double as the plan tier, plus `suspended`/`archived`), `ProductMode` (team/business), `DatabasePlacement` (shared/dedicated), `SegmentTemplate` (distribution/service/partner_account), `JobStatus`, `PlatformUserStatus` (active/suspended), `UserStatus`, `InviteStatus`, `RoleCode`, `NavZone` (field/manager/admin/operations — frontend nav grouping, see `User.lastSelectedZone` above), `LocationStatus`, `ChainStatus` (active/archived), `AssignmentStatus`, `ProductStatus`, `RouteStatus`, `RouteItemStatus`, `VisitStatus`, `VisitNoteInputType` (text/audio), `ReportStatus` (draft/confirmed/discarded), `TaskStatus`, `TaskPriority`, `ImportType`, `ImportStatus`, `ImportIssueSeverity`, `AiJobType`, `AiJobStatus`, `StorageObjectStatus`, `StorageObjectPurpose`.
