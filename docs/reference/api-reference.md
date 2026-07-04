# API Reference

Reference for the implemented HTTP API. Source of truth: `src/modules/*/**.controller.ts`, `src/modules/*/**.types.ts`, `src/main.ts`, `src/common/api-error.filter.ts`. Update this document in the same change as any controller change.

All routes are prefixed with **`/api`** (set in `src/main.ts`). Paths below omit the prefix.

## Authentication model

- **Session cookie (tenant)**: `vizitum_session` (httpOnly, SameSite=Lax, Secure in production, 30-day TTL). Set by `POST /auth/login` and `POST /auth/invites/accept`; cleared by `POST /auth/logout`. The server stores only a hash of the token (`sessions.sessionTokenHash`).
- **Session cookie (platform)**: `vizitum_platform_session` (same cookie attributes/TTL). Set by `POST /platform/auth/login`; cleared by `POST /platform/auth/logout`. Resolves to a `PlatformUser` and grants the full `platform_owner` permission set (`platform.tenants.read`/`manage`, `platform.operations.read`). Not bound to any tenant; `RequestContext.tenantId` is the sentinel `"platform"` and `userId` is the platform user id (used as the audit actor).
- **CSRF**: double-submit cookie. `vizitum_csrf` (readable by JS) must be echoed in the `x-csrf-token` header on every non-GET/HEAD/OPTIONS request that carries **either** session cookie. The token is an HMAC signed with the session token. Errors: `CSRF_TOKEN_REQUIRED`, `CSRF_TOKEN_INVALID`, `CSRF_TOKEN_MALFORMED` (403/400).
- **Tenant resolution**: the tenant session is bound to a tenant at login (`tenantSlug` in the login body). `PermissionGuard` (`src/modules/auth/permission.guard.ts`) loads the session, tenant, user and roles, and attaches a `RequestContext` to the request. Tenant id is **never** read from client input on tenant-owned routes.
- **Platform bearer token**: `Authorization: Bearer <token>` grants only `platform.operations.read` — a service credential used by `GET /operations/summary` (e.g. the alerts check). It **cannot** manage tenants; tenant management requires a `platform_owner` session. Validated against `PLATFORM_OPERATIONS_TOKEN_SHA256` (preferred) or `PLATFORM_OPERATIONS_TOKEN`.
- **Permissions**: endpoints declare `@RequirePermissions` (all required) or `@RequireAnyPermissions` (at least one). Missing permission → 403 `MISSING_PERMISSION`; missing/invalid session → 401 `AUTHENTICATION_REQUIRED`. See [permissions.md](permissions.md).
- **Request id**: `x-request-id` is accepted/generated and echoed in error bodies and some responses.

## Error envelope

All errors are JSON (`src/common/api-error.filter.ts`):

```json
{
  "code": "IMPORT_TEMPLATE_INVALID",
  "message": "Import template type is required.",
  "details": {},
  "fieldErrors": { "templateType": ["Import template type is required."] },
  "requestId": "..."
}
```

`details` and `fieldErrors` are optional. Unhandled errors → 500 `INTERNAL_SERVER_ERROR`. 5xx errors are reported to Sentry.

Paginated list responses share one shape: `{ items, page, pageSize, total, totalPages }`.

## Endpoints

Legend: **all** = `@RequirePermissions` (every permission required); **any** = `@RequireAnyPermissions` (one is enough). Public = no guard.

### Auth — `/auth` (public, `auth.controller.ts`)

| Method & path | Body | Returns |
| --- | --- | --- |
| `POST /auth/login` | `{ email, password, tenantSlug }` | `{ user: { id, email, name, status, lastSelectedRoleCode }, roleCodes, permissions }`; sets session + CSRF cookies |
| `GET /auth/me` | — | Same shape as login, plus `productsEnabled` (tenant setting, used to hide the Products nav item) |
| `POST /auth/role` | `{ roleCode }` | Switch `lastSelectedRoleCode` |
| `POST /auth/invites/accept` | `{ token, name, password, phone? }` | Activates invited user, sets session + CSRF cookies |
| `POST /auth/logout` | — | `{ ok: true }`; revokes session, clears cookies |

### Health — `/health` (public, `health.controller.ts`)

| Method & path | Returns |
| --- | --- |
| `GET /health` | Liveness info + `requestId` |
| `GET /health/readiness` | Readiness info; HTTP 503 when `status !== "ready"` |

### Operations — `/operations` (`operations.controller.ts`)

| Method & path | Permissions | Returns |
| --- | --- | --- |
| `GET /operations/summary` | all: `platform.operations.read` (session or bearer token) | `{ generatedAt, windowHours, tenants, provisioning, imports, ai, storage, requestId }` |

### Platform auth — `/platform/auth` (public, `platform-auth.controller.ts`)

| Method & path | Body | Returns |
| --- | --- | --- |
| `POST /platform/auth/login` | `{ email, password }` | `{ platformUser: { id, email, name, status }, roleCodes: ["platform_owner"], permissions }`; sets `vizitum_platform_session` + `vizitum_csrf` cookies. 401 `INVALID_CREDENTIALS` |
| `GET /platform/auth/me` | — | Same shape as login; 401 `AUTHENTICATION_REQUIRED` when unauthenticated |
| `POST /platform/auth/logout` | — | `{ ok: true }`; revokes the session, clears cookies |

### Platform — `/platform/tenants` (`platform_owner` session, `platform.controller.ts`)

| Method & path | Permissions | Body | Returns |
| --- | --- | --- | --- |
| `GET /platform/tenants` | all: `platform.tenants.read` | — | `PlatformTenant[]`, most recent first |
| `GET /platform/tenants/:tenantId` | all: `platform.tenants.read` | — | `{ tenant, provisioningJob }`; 404 `TENANT_NOT_FOUND` |
| `POST /platform/tenants` | all: `platform.tenants.manage` | `{ name, slug, segmentTemplate, country?, timezone?, language?, primaryDomain? }` | `{ tenant, provisioningJob }` (tenant created with `status: "draft"`, job `status: "queued"`); errors: 400 `TENANT_INVALID` (missing/invalid fields), 409 `TENANT_SLUG_ALREADY_EXISTS` |
| `PATCH /platform/tenants/:tenantId` | all: `platform.tenants.manage` | `{ name?, timezone?, language?, primaryDomain?, planCode?, status? }` — `status` cannot be `archived` (use the archive action) | updated `PlatformTenant`; errors: 400 `TENANT_UPDATE_INVALID`/`TENANT_UPDATE_EMPTY`, 404 `TENANT_NOT_FOUND`, 409 `TENANT_ARCHIVED` |
| `POST /platform/tenants/:tenantId/archive` | all: `platform.tenants.manage` | — | archived `PlatformTenant` (`status: "archived"`, `archivedAt` set); idempotent on an already-archived tenant; 404 `TENANT_NOT_FOUND` |

### Pilot review — `/pilot-review` (`pilot-review.controller.ts`)

| Method & path | Permissions | Body | Returns |
| --- | --- | --- | --- |
| `GET /pilot-review/summary` | all: `pilot_review.read` | — | `{ firstVisitAt, windowStart, windowEnd, thresholds: [{ key, label, target, result, status }], generatedAt }`. `status` is `met`/`not_met`/`na`. Window is the 7 calendar days starting at the tenant's first visit (see `docs/specs/pilot-readiness-spec.md`); before any visit exists every threshold is `na`. |
| `POST /pilot-review/dashboard-views` | any: `dashboard.manager.read`, `pilot_review.read` | `{ page: "manager" \| "admin_review" }` | `{ recorded: true }`; records a `manager_dashboard.viewed` audit event used by the "Manager review usage" threshold |

### Visits — `/visits` (`visits.controller.ts`)

| Method & path | Permissions | Body / query | Returns |
| --- | --- | --- | --- |
| `GET /visits` | any: `visits.read_own`, `visits.read_team` | query: `page, pageSize, representativeUserId, locationId, routePlanId, status (draft\|in_progress\|completed\|cancelled), startedFrom, startedTo` | paginated `Visit` (includes `location` and `representative` summaries) |
| `GET /visits/:visitId` | any: `visits.read_own`, `visits.read_team` | — | `Visit` |
| `GET /visits/:visitId/report` | any: `reports.read_own`, `reports.read_team` | — | confirmed `Report` for the visit, including `createdTaskCount` and `createdTasks` (the actual `Task` rows linked via `reportId`, distinct from the draft `confirmedData.tasksToCreate`) |
| `POST /visits` | all: `visits.create` | `{ locationId, representativeUserId, routeItemId?, visitType, startedAt? }` | `Visit` |
| `PATCH /visits/:visitId` | all: `visits.update_own` | `{ status?, startedAt?, completedAt?, cancelledAt? }` | `Visit` |
| `POST /visits/:visitId/notes/text` | all: `visits.update_own` | `{ textContent }` | `VisitNote` |
| `POST /visits/:visitId/notes/audio/register` | all: `visits.update_own` | `{ fileName, contentType, sizeBytes, checksum? }` | `{ note, storageObject, uploadUrl? }` — client then PUTs the audio to `uploadUrl.url` |
| `POST /visits/:visitId/ai/transcription-jobs` | all: `visits.update_own`, `ai.use_reporting` | `{ inputObjectId }` | `AiJob` |
| `POST /visits/:visitId/ai/extraction-jobs` | all: `visits.update_own`, `ai.use_reporting` | `{ transcriptionJobId }` | `AiJob`; when extraction succeeds the response also carries `draftQuality` (`{ state: ready_to_confirm \| needs_review, reasons, missingRequiredFields, confidence }` per the weak-output criteria in `docs/specs/ai-quality-spec.md`) — persisted on the `ai_jobs` row (`draftQuality` column) so it survives re-reads of an already-succeeded job |
| `POST /visits/:visitId/ai/drafts/confirm` | all: `visits.update_own`, `ai.use_reporting`, `reports.confirm_own` | `{ extractionJobId, confirmedData? }` | `{ report: Report, createdTaskCount }` — `report` is the same shape as `GET /visits/:visitId/report`, including `createdTasks`/`createdTaskCount` for tasks created by this confirmation |
| `POST /visits/:visitId/reports/confirm` | all: `reports.confirm_own` | `{ schemaVersion, confirmedData }` | `Report` — manual confirmation path; must always work when AI is unavailable |

### Tasks — `/tasks` (`tasks.controller.ts`)

| Method & path | Permissions | Body / query | Returns |
| --- | --- | --- | --- |
| `GET /tasks` | any: `tasks.read_own`, `tasks.read_team` | query: `page, pageSize, assignedToUserId, status (open\|in_progress\|done\|cancelled), priority (low\|normal\|high), locationId, visitId, routePlanId, dueFrom, dueTo` | paginated `Task` (includes `assignedTo` and `location` summaries) |
| `POST /tasks` | all: `tasks.create` | `{ title, description?, priority?, assignedToUserId?, locationId?, visitId?, reportId?, dueDate? }` | `Task` |
| `PATCH /tasks/:taskId` | any: `tasks.update_own`, `tasks.update_team` | any create field plus `status?, completedAt?` | `Task` |

### Locations — `/locations` (`locations.controller.ts`)

| Method & path | Permissions | Body / query |
| --- | --- | --- |
| `GET /locations` | all: `locations.read` | query: `page, pageSize, status (active\|inactive\|archived), city, region, territory, search` |
| `GET /locations/:locationId` | all: `locations.read` | — |
| `POST /locations` | all: `locations.manage` | `{ externalCode?, name, type?, addressLine, city, region?, territory?, latitude?, longitude?, notes? }` |
| `PATCH /locations/:locationId` | all: `locations.manage` | any create field plus `status?` |
| `GET /locations/:locationId/contacts` | all: `contacts.read` | — |
| `POST /locations/:locationId/contacts` | all: `contacts.manage` | `{ name, roleTitle?, phone?, email?, notes? }` |
| `PATCH /locations/:locationId/contacts/:contactId` | all: `contacts.manage` | partial contact fields |
| `DELETE /locations/:locationId/contacts/:contactId` | all: `contacts.manage` | — |
| `GET /locations/:locationId/assignments` | all: `locations.read` | — |
| `POST /locations/:locationId/assignments` | all: `locations.assign` | `{ representativeUserId }` |
| `PATCH /locations/:locationId/assignments/:assignmentId/deactivate` | all: `locations.assign` | — |

### Products — `/products` (`products.controller.ts`)

| Method & path | Permissions | Body / query |
| --- | --- | --- |
| `GET /products` | all: `products.read` | query: `page, pageSize, status (active\|inactive\|archived), category, search` |
| `GET /products/:productId` | all: `products.read` | — |
| `POST /products` | all: `products.manage` | `{ externalCode?, name, sku?, category?, notApplicable? }` |
| `PATCH /products/:productId` | all: `products.manage` | any create field plus `status?` |

### Routes — `/routes` (`routes.controller.ts`)

> Mutation scope: mutations require `routes.manage_team` or `routes.manage_own` at the guard level; `RoutesService.assertCanManageRouteForRepresentative` then enforces ownership. With `routes.manage_team` the caller may mutate any plan in the tenant; with only `routes.manage_own` the plan's `representativeUserId` must equal the caller's user id (403 `ROUTE_SCOPE_FORBIDDEN` otherwise). `GET /routes/today` is also scoped: `routes.manage_team` sees all of today's plans, everyone else only their own.

| Method & path | Permissions | Body / query |
| --- | --- | --- |
| `GET /routes/today` | all: `routes.read` | — (today's route plans with items) |
| `GET /routes` | all: `routes.read` | query: `page, pageSize, representativeUserId, planDate, status (draft\|published\|in_progress\|completed\|cancelled)` |
| `POST /routes` | any: `routes.manage_team`, `routes.manage_own` | `{ representativeUserId, planDate }` |
| `PATCH /routes/:routePlanId` | any: `routes.manage_team`, `routes.manage_own` | `{ status?, publishedAt? }` |
| `POST /routes/:routePlanId/items` | any: `routes.manage_team`, `routes.manage_own` | `{ locationId, sequence, plannedStartTime?, plannedEndTime? }` |
| `PATCH /routes/:routePlanId/items/:routeItemId` | any: `routes.manage_team`, `routes.manage_own` | partial item fields plus `status?, skipReason?` |

### Imports — `/imports` (`imports.controller.ts`)

Template types: `users`, `locations`, `contacts`, `products`, `initial_visit_task_plan`.

| Method & path | Permissions | Body | Returns |
| --- | --- | --- | --- |
| `GET /imports/templates` | all: `imports.read` | — | `ImportTemplateSummary[]` (`type, label, fileName, downloadPath, requiredColumns, optionalColumns`) |
| `GET /imports/templates/:templateFile` | all: `imports.read` | — | CSV file download |
| `POST /imports/jobs/validate` | all: `imports.upload` | `{ templateType, csvText }` | validation preview: `{ importJobId, status, rowCount, validRowCount, errorRowCount, warningRowCount, canConfirm, issues[] }` |
| `GET /imports/jobs` | all: `imports.read` | — | import history: `ImportJobHistoryItem[]` |
| `GET /imports/jobs/:importJobId` | all: `imports.read` | — | stored validation preview |
| `POST /imports/jobs/:importJobId/confirm` | all: `imports.confirm` | — | `{ importJobId, status: "applied", appliedRowCount, createdCounts }` |

### Admin users — `/admin/users` (`admin-users.controller.ts`)

| Method & path | Permissions | Body | Returns |
| --- | --- | --- | --- |
| `GET /admin/users` | all: `users.read` | query: `page, pageSize` | paginated `User` (with `roleCodes`) |
| `POST /admin/users/invite` | all: `users.invite` | `{ email, roleCodes }` | `{ id, email, roleCodes, status, expiresAt, token }` — token is returned once for link building |
| `GET /admin/users/invites` | all: `users.read` | — | invite history (status, expiry, createdBy/acceptedBy) |
| `POST /admin/users/invites/:inviteId/resend` | all: `users.invite` | — | new invite with fresh token |
| `PATCH /admin/users/:userId` | all: `users.manage` | `{ name?, phone?, status? }` | `User`; rejects (409 `TENANT_LAST_ADMIN`) deactivating the tenant's last active `company_admin` |
| `POST /admin/users/:userId/roles` | all: `roles.assign` | `{ roleCode }` | `User` |
| `DELETE /admin/users/:userId/roles/:roleCode` | all: `roles.assign` | — | `User`; rejects (409 `TENANT_LAST_ADMIN`) removing the tenant's last active `company_admin` role and (409 `USER_LAST_ROLE`) removing a user's only remaining role |

### Admin settings — `/admin/settings` (`admin-settings.controller.ts`)

| Method & path | Permissions | Body | Returns |
| --- | --- | --- | --- |
| `GET /admin/settings` | all: `tenant.settings.read` | — | `{ tenantId, name, timezone, productMode, productsEnabled, updatedAt }` |
| `PATCH /admin/settings` | all: `tenant.settings.manage` | `{ name?, timezone?, productsEnabled? }` — timezone must be a valid IANA zone; errors use code `SETTINGS_INVALID` with `fieldErrors` | updated settings |

### Storage — `/storage/objects` (`storage.controller.ts`)

| Method & path | Permissions | Body | Returns |
| --- | --- | --- | --- |
| `GET /storage/objects/:storageObjectId` | any: `visits.read_own`, `visits.read_team`, `imports.read` | — | `StorageObject` metadata |
| `POST /storage/objects/:storageObjectId/upload-url` | any: `visits.update_own`, `imports.upload` | `{ expiresInSeconds? }` | `{ url, method: "PUT", expiresAt, headers }` |
| `POST /storage/objects/:storageObjectId/download-url` | any: `visits.read_own`, `visits.read_team`, `imports.read` | `{ expiresInSeconds? }` | `{ url, method: "GET", expiresAt, headers }` |

## Endpoint count

71 endpoints across 15 controllers (auth 5, health 2, operations 1, platform auth 3, platform 5, pilot review 2, visits 11, tasks 3, locations 11, products 4, routes 6, imports 6, admin users 7, admin settings 2, storage 3).
