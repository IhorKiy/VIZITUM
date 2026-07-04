# Module Map

Reference for the implemented codebase. Source of truth: `src/modules/*`, `src/app.module.ts`, `src/main.ts`, `src/worker.ts`, `apps/web/app/**`, `apps/web/lib/*`. This describes the current state, not design intent — for design rationale see `docs/vizitum-low-level-technical-design.md`.

When you change a module's responsibility, routes, or key files, update this document in the same change.

## Backend entrypoints

- `src/main.ts` — API server. Applies request-id middleware, access log, CSRF protection, sets global prefix **`/api`**, installs `ApiErrorFilter`. Listens on `HOST`/`PORT` (default `0.0.0.0:4000`).
- `src/worker.ts` — run-to-completion worker process. `WORKER_TASK` selects the task: `cleanup` (deletes expired failed AI jobs and expired temporary storage objects) or `provision` (advances `queued` platform provisioning jobs — moves a `draft`/`provisioning` tenant to `ready`, marks the job `succeeded`, records a `tenant.provisioned` event). Each runs to completion and exits. Deployed as crons, not long-running queue consumers.
- `src/common/` — `request-id.middleware.ts`, `access-log.middleware.ts`, `api-error.filter.ts` (global error envelope), `json-logger.service.ts`, `sentry.service.ts`.

Note: Redis/BullMQ appear in the LLD and `.env.example`, but no backend code currently consumes `REDIS_URL`. AI transcription/extraction jobs execute in the API process; the worker is a cron cleanup task.

## Backend modules (`src/modules/`)

| Module | Route prefix | Responsibility |
| --- | --- | --- |
| `auth` | `/api/auth` | Login, logout, session cookies, CSRF, invite acceptance, role switching. Also home of `PermissionGuard` and the `@RequirePermissions`/`@RequireAnyPermissions` decorators used by every protected controller. |
| `tenancy` | — | `request-context.ts` defines `RequestContext` (requestId, tenantId, tenantSlug, userId, roleCodes, permissions); `tenancy.service.ts` resolves tenant by slug. The context is attached to the request by `PermissionGuard`, never taken from client input. |
| `roles` | — | `permissions.ts` (permission constants) and `role-permission.matrix.ts` (role → permissions). `roles.service.ts` expands role codes to permission sets. See [permissions.md](permissions.md). |
| `users` | `/api/admin/users` | Tenant user list, invites (create/list/resend), user updates (name/phone/status), role add/remove. |
| `settings` | `/api/admin/settings` | Tenant settings: company name, IANA timezone (on `PlatformTenant`) and `products_enabled` flag (in `TenantSetting` key-value table). |
| `locations` | `/api/locations` | Location CRUD, per-location contacts, representative assignments. |
| `products` | `/api/products` | Product/SKU catalog CRUD. |
| `routes` | `/api/routes` | Route plans (one per representative per date) and ordered route items; `/routes/today` returns today's plans. |
| `visits` | `/api/visits` | Visit lifecycle, text notes, temporary audio upload registration, manual report confirmation. Delegates AI sub-routes to `ai`. |
| `ai` | — (routes live under `/api/visits/:visitId/ai/*`) | OpenAI transcription and structured extraction jobs, draft confirmation, cleanup of expired failed jobs. `ai-extraction.schemas.ts` holds report extraction schemas. Manual report confirmation must always work when AI fails — hard product requirement. |
| `tasks` | `/api/tasks` | Task list/create/update with status, priority, assignee, due-date filters. |
| `imports` | `/api/imports` | CSV template catalog/download, validate-preview-then-confirm import jobs, row-level issues, import history. Template types: `users`, `locations`, `contacts`, `products`, `initial_visit_task_plan`. |
| `storage` | `/api/storage/objects` | S3-compatible object storage (Cloudflare R2 in staging). Presigned upload/download URLs, temporary-object lifecycle. `storage.config.ts` reads `S3_*` env vars. |
| `operations` | `/api/operations` | Platform operations summary (tenant counts, provisioning/import/AI/storage health counters). Accessible via session permission or platform bearer token. |
| `platform` | `/api/platform/tenants`, `/api/platform/auth` | Platform Owner identity + tenant lifecycle. `platform-auth.*` provides `PlatformUser` login/logout/me over a `vizitum_platform_session` cookie (own `PlatformSessionService`, resolved in `PermissionGuard` → `platform_owner` context). Tenant lifecycle: create/list/get/update/archive `PlatformTenant` rows, seed default product capabilities, queue a `PlatformProvisioningJob`. `ProvisioningService.runPendingProvisioningJobs` (the `provision` worker task) advances queued jobs to `ready`. Tenant routes require `platform.tenants.read`/`manage` (session only; the bearer token is limited to `platform.operations.read`). |
| `health` | `/api/health` | Liveness (`/health`) and readiness (`/health/readiness`, 503 when not ready). Unauthenticated. |
| `audit` | — | `AuditService.recordEvent` writes tenant-scoped `AuditEvent` rows (entityType/entityId/eventType/metadata). No controller of its own; consumed by other modules (e.g. `pilot-review`). |
| `pilot-review` | `/api/pilot-review` | `GET /summary` computes the 6 pilot success thresholds from `docs/specs/pilot-readiness-spec.md` over the 7-day window starting at the tenant's first visit. `POST /dashboard-views` records a `manager_dashboard.viewed` audit event (called from `/manager` and `/admin/review` on page load) to measure manager review usage. |
| `prisma` | — | `PrismaService` wrapper for DI. |

Full endpoint list with permissions and payloads: [api-reference.md](api-reference.md).

### Tenancy invariant (load-bearing)

Every module touching tenant-owned data reads `tenantId` from `RequestContext` (`request.context`), which `PermissionGuard` builds from the session. Never trust a `tenantId` from a request body, param, or query. Controllers use a local `getRequestContext(request)` helper that throws if the guard did not run.

## Frontend (`apps/web`)

Next.js App Router. All product screens live under the tenant slug: `apps/web/app/[tenantSlug]/...`. Navigation is filtered by session permissions.

| Route | Page | Role area | Backing API |
| --- | --- | --- | --- |
| `/` | `app/page.tsx` | — | Home/redirect. |
| `/[tenantSlug]` | `[tenantSlug]/page.tsx` | — | Tenant home / role dispatch. |
| `/[tenantSlug]/login` | `login/page.tsx` | Public | `POST /auth/login` |
| `/[tenantSlug]/invites/accept` | `invites/accept/page.tsx` | Public | `POST /auth/invites/accept` |
| `/[tenantSlug]/field` | `field/page.tsx` | Field | `/routes/today`, `/visits`, `/tasks`, visit notes/audio/AI/report endpoints |
| `/[tenantSlug]/field/history` | `field/history/page.tsx` | Field | Own-scope `/visits` history with status/date filters |
| `/[tenantSlug]/admin` | `admin/page.tsx` | Admin | Admin home |
| `/[tenantSlug]/admin/setup` | `admin/setup/page.tsx` | Admin | Onboarding checklist (settings, users, imports reads) |
| `/[tenantSlug]/admin/users` | `admin/users/page.tsx` | Admin | `/admin/users*` |
| `/[tenantSlug]/admin/imports` | `admin/imports/page.tsx` | Admin | `/imports/*` |
| `/[tenantSlug]/admin/locations` | `admin/locations/page.tsx` | Admin | `/locations*` |
| `/[tenantSlug]/admin/products` | `admin/products/page.tsx` | Admin | `/products*` |
| `/[tenantSlug]/admin/review` | `admin/review/page.tsx` | Admin | Pilot review summary from `/pilot-review/summary`; records a dashboard view via `/pilot-review/dashboard-views` |
| `/[tenantSlug]/admin/settings` | `admin/settings/page.tsx` | Admin | `/admin/settings` |
| `/[tenantSlug]/manager` | `manager/page.tsx` | Manager | Dashboard metrics from `/visits`, `/tasks`, `/routes`; CSV export; task assignment; records a dashboard view via `/pilot-review/dashboard-views` |
| `/[tenantSlug]/manager/visits` | `manager/visits/page.tsx` | Manager | `/visits` with filters |
| `/[tenantSlug]/manager/visits/[visitId]` | `manager/visits/[visitId]/page.tsx` | Manager | Visit metadata from `/visits/:visitId` and report detail from `/visits/:visitId/report` |
| `/[tenantSlug]/manager/tasks` | `manager/tasks/page.tsx` | Manager | `/tasks` with filters |
| `/[tenantSlug]/manager/locations` | `manager/locations/page.tsx` | Manager | Read-only `/locations` coverage list with visit/task activity from `/visits` and `/tasks` |
| `/[tenantSlug]/manager/representatives` | `manager/representatives/page.tsx` | Manager | Read-only representative workload from `/routes`, `/visits` and `/tasks` |
| `/[tenantSlug]/operations` | `operations/page.tsx` | Platform | `/operations/summary` |
| `/platform/login` | `platform/login/page.tsx` | Platform (not tenant-scoped) | `POST /platform/auth/login`; forwards the platform session + CSRF cookies to the browser |
| `/platform/tenants` | `platform/tenants/page.tsx` | Platform (not tenant-scoped) | `/platform/auth/me` (redirects to `/platform/login` when unauthenticated), `/platform/tenants*`, `/platform/auth/logout`; console authenticated via the `platform_owner` session cookie |

### Shared frontend libs (`apps/web/lib/`)

- `api-client.ts` — the only path to the backend. Server-side fetch helpers (`apiGet/apiPost/apiPatch/apiDelete`) that forward the incoming cookie header, `x-request-id`, and the CSRF token (read from the `vizitum_csrf` cookie, sent as `x-csrf-token`). Returns `ApiResult<T> = { ok: true; data } | { ok: false; status; message }` — screens branch on `ok`, they do not throw. Also holds the frontend response types. Base URL: `API_BASE_URL` env (default `http://127.0.0.1:4000/api`).
- `navigation.ts` — `buildTenantNav(tenantSlug, permissions)` returns nav items filtered by required permissions (a nav item shows if the user has *any* of its `requiredPermissions`). Add new screens here with their permission requirements.
- `backend-cookies.ts` — cookie forwarding helpers for server components.
- `demo-mode.ts` — demo data fallback, controlled by `ENABLE_DEMO_FALLBACK` / `NEXT_PUBLIC_ENABLE_DEMO_FALLBACK`; disabled by default in production.

## Tests (`tests/`)

Plain `node --test` + `tsx`, one behavior per file. Groups: `ai-*` (job lifecycle, schemas, draft confirmation, cleanup), `import-*` (CSV/XLSX parsing, validation, templates), `auth-tenant-isolation`, `platform-auth`, `platform-tenant-creation`, `platform-tenant-management`, `platform-provisioning`, `users-service`, `storage-*`, `visit-audio-upload-registration`, `manager-list-filters`, `manual-report-after-ai-failure`, `operations-summary`, `health-readiness`, `json-logger`, `sentry-service`.

Behavior covered by these tests is treated as executable specification. See [executable-spec.md](executable-spec.md) for the product/platform contract map.
