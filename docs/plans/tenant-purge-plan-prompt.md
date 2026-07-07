# Task: Two-stage tenant deletion (archive → retention → background purge)

## Context

VIZITUM is a multi-tenant field-visit SaaS: NestJS API at repo root (`src/`), Next.js frontend in `apps/web`, PostgreSQL via Prisma, S3-compatible storage (Cloudflare R2) via `src/modules/storage`. Read `CLAUDE.md` and `AGENTS.md` first, then `docs/reference/data-model.md`, `api-reference.md` and `permissions.md`.

Current lifecycle state (verify against code — this is a snapshot):

- Tenant lifecycle lives on `PlatformTenant.status` (`prisma/schema.prisma`, enum `TenantStatus`): `pilot`/`team`/`business` double as plan tiers, plus `suspended` and `archived`. `archivedAt` is set on archive.
- `src/modules/platform/platform.service.ts` has idempotent, race-safe `archiveTenant`/`unarchiveTenant` (`POST /:tenantId/archive|unarchive` in `platform.controller.ts`). Unarchive deliberately restores to `suspended`, not the previous status. Archived/suspended tenants are blocked from serving requests by `tenancy.service.ts`.
- **There is no deletion.** Archived tenants and all their data live forever; the platform owner is worried about tenant accumulation (abandoned pilots, test tenants).
- Cascades are NOT ready for a hard delete: only two relations reference `PlatformTenant` with an `onDelete` rule (one `Cascade`, one `SetNull` — the `SetNull` one is `PlatformOperationEvent`, the platform audit trail). The ~20+ tenant-owned models (`User`, `Session`, `Invite`, `Location*`, `Product*`, `Route*`, `Visit*`, `Report`, `Task`, `TenantSetting`, `ImportJob`/`ImportRowIssue`, `AiJob`, `AuditEvent`, `StorageObject`, …) carry `tenantId` without an FK cascade to the tenant.
- The database is not the only store: `StorageObject` rows point at real R2 objects (visit audio, CSV imports). `StorageService` already knows how to delete objects and mark rows `deleted` (see its cleanup path).
- A background worker already exists: `src/worker.ts` (`WORKER_TASK=cleanup`, run via `npm run worker:cleanup`) boots a Nest application context and runs AI + storage cleanup. It runs through **ts-node, not tsx** (hard constraint, see CLAUDE.md).

## Target design (decided, do not re-litigate)

1. **Two-stage deletion, never a synchronous DELETE.** A tenant is only ever purged from the `archived` state, after a retention window, by the worker. HTTP endpoints only change markers; the worker does the destructive work in batches.
2. **Retention window**: purge eligibility is `status = archived` AND `archivedAt` older than `TENANT_PURGE_RETENTION_DAYS` (env var, default 30; document in `docs/reference/environment.md`). Until then, `unarchive` remains the rescue hatch — do not weaken its semantics.
3. **Explicit early purge** (platform owner only): `POST /platform/tenants/:tenantId/purge` marks an archived tenant for immediate purge (e.g. `purgeRequestedAt` timestamp on `PlatformTenant`). It must require a confirmation payload echoing the tenant **slug** (mistyped slug → 4xx, nothing happens), be idempotent like archive/unarchive, and refuse non-archived tenants. It does not delete anything itself.
4. **The worker purges.** Add a `WORKER_TASK` (either extend `cleanup` or add a `purge` task — pick one and keep `worker.ts`'s existing shape) that:
   - selects eligible tenants (retention elapsed OR `purgeRequestedAt` set),
   - first deletes R2 objects via `StorageService` (storage before rows — a dangling DB row is recoverable, an orphaned R2 object is silent cost),
   - then deletes tenant-owned rows **in explicit dependency order, in batches** (children before parents; do not rely on adding `onDelete: Cascade` migrations for the purge itself — data volumes make explicit batching safer and observable),
   - finally deletes the `Tenant`/`PlatformTenant` rows,
   - is crash-safe and re-runnable: a purge interrupted halfway must complete on the next run, never leave a tenant half-visible. Consider a `purging` marker/status so a partially-purged tenant can never be unarchived.
5. **What survives**: `PlatformOperationEvent` rows (already `SetNull`) stay forever. Emit a final platform operation event per purge recording who/when/what (tenant slug + name, row counts per table, storage object count). Tenant-scoped `AuditEvent` rows are tenant data and are purged with the tenant.
6. **Auto-archive of dead pilots** (the root cause of accumulation): the worker also archives `pilot` tenants with no activity for `TENANT_PILOT_AUTO_ARCHIVE_DAYS` (env var; **disabled when unset** — opt-in). Define "activity" concretely from what the schema can answer cheaply (e.g. latest session/visit/import timestamps) and emit an operation event per auto-archive. Auto-archived tenants then flow into the normal retention → purge pipeline.
7. **Frontend**: platform tenants screen (`apps/web/app/platform/...`) shows purge eligibility (archived + days remaining) and a purge action with a type-the-slug confirmation dialog. No purge UI anywhere under `[tenantSlug]/` — this is platform-owner-only.
8. **Permissions**: purge/marking follows the same platform-owner auth as archive (see `platform-auth.*`); document the new endpoint(s) in `docs/reference/api-reference.md` and `permissions.md`.

## Non-goals (explicitly out of scope, list as follow-ups in the PR description)

- Tenant data export ("download my data before deletion") — worth a follow-up ticket, not this change.
- Legal/GDPR retention policy configuration per tenant — single global env-var window is enough now.
- Deleting or reworking the retired `TenantStatus` values (`draft`/`provisioning`/`ready`/`active`) — leave the enum alone except for what this task needs.
- Backups/restore-drill changes (`restore:drill:check`) beyond verifying they still pass.
- Any scheduling infrastructure (cron) — the worker stays externally scheduled like the existing cleanup task.

## Suggested execution order

1. **Schema + markers** (small): `purgeRequestedAt` (and `purging` marker if chosen) on `PlatformTenant`; migration; update `docs/reference/data-model.md`.
2. **Purge-marking endpoint** (small): controller + service, mirroring the archive/unarchive idempotency-and-race pattern already in `platform.service.ts` (read those first and copy the transaction/`updateMany`-conditional style). Operation event on mark. Tests alongside.
3. **Purge worker** (the bulk): eligibility query, R2 deletion, ordered batched row deletion, final tenant delete, completion event, crash-safety. Derive the deletion order from `prisma/schema.prisma` relations and write it down as a comment where the order lives.
4. **Auto-archive of stale pilots** (medium): activity definition, env-gated, events.
5. **Frontend purge UI** (small-medium): eligibility display + confirm dialog on the platform tenants screen.
6. **Docs**: `api-reference.md`, `data-model.md`, `environment.md`, `permissions.md`, `module-map.md` as touched — hard project convention; plus a runbook note if `docs/` has operational runbooks (check).

## Verification

- New tests under `tests/` (plain `node --test`, one behavior per file, mirroring e.g. `tests/…archive…` if present — check `docs/reference/executable-spec.md` for the naming/mapping convention and update it):
  - purge marking: archived-only, slug confirmation, idempotency, race (same pattern as archive tests),
  - purge eligibility: retention math, `purgeRequestedAt` override, non-archived never eligible,
  - purge execution order and re-runnability (instantiate services directly with `new`, as existing tests do),
  - auto-archive: activity thresholds, env-gate off by default.
- `npm run test`, `npm run lint`, `npm run build`, `npm run web:typecheck` green after every stage.
- Manual walk: seed a tenant with users/visits/imports/storage objects locally (`npm run db:up`, `npm run dev` via ts-node), archive it, force eligibility (short env window), run `npm run worker:cleanup` (or the new task), verify: all tenant rows gone, R2/local storage objects gone, `PlatformOperationEvent` trail intact, other tenants untouched, worker re-run is a no-op.
- Kill the worker mid-purge once and re-run to confirm crash-safety.

## Rough sizing

- Stages 1–2: day-scale.
- Stage 3 (worker): the bulk — the deletion-order and crash-safety work is where the real thinking is; budget most of the effort here.
- Stages 4–5: a day-scale each.

## Working notes

- The branch this was written on is `platform-tenant-lifecycle-and-plan`; the code may have moved — trust the code over this snapshot.
- **Tenancy invariant is load-bearing**: the worker operates across tenants by design, but any new HTTP surface must take tenant identity from path/platform auth context per the existing platform controllers — never from a client-supplied body field used for scoping.
- Do not touch the manual report-confirmation flow or AI module behavior.
- Purge is the one irreversible operation in the system — bias every ambiguity toward refusing to delete.
