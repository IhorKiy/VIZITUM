# Task: Introduce a tenant Superadmin role and delegate admin management

## Context

VIZITUM is a multi-tenant field-visit SaaS: NestJS API at repo root (`src/`), Next.js frontend in `apps/web`, PostgreSQL via Prisma. Read `CLAUDE.md` and `AGENTS.md` first, then the implemented-state docs in `docs/reference/` (`permissions.md`, `api-reference.md`, `data-model.md`, `module-map.md`).

Current access model (verify against `src/modules/roles/role-permission.matrix.ts` and `docs/reference/permissions.md`):

- `platform_owner` is a platform-level identity (`platform_users` table, session via `POST /platform/auth/login`), not a tenant role. It currently invites, suspends and reactivates Company Admins directly via `/platform/tenants/:tenantId/users/*` (`src/modules/platform/platform-tenant-users.controller.ts`, `platform.service.ts`).
- Tenant roles (`RoleCode` enum in `prisma/schema.prisma`): `company_admin`, `team_manager`, `field_representative`. A user can hold multiple roles; permissions are the union.
- Anti-lockout: `UsersService.assertOtherActiveCompanyAdminExists` (`src/modules/users/users.service.ts`) blocks deactivating or de-roling the last active `company_admin` in a tenant (`TENANT_LAST_ADMIN` conflict), inside a Serializable transaction.
- Tenancy invariant: tenant id always comes from the resolved `RequestContext` (`src/modules/tenancy/request-context.ts`), never from client input. Do not violate this.

## Target business logic (decided, do not re-litigate)

1. New tenant role: **`tenant_superadmin`** — the customer's responsible person, one per tenant.
   - The **platform owner** invites the superadmin (and only the owner can re-send the invite or send it to a different person, replacing the previous one).
   - The **superadmin** invites Company Admins, and can suspend (pause), reactivate and delete them.
   - Permissions: superadmin gets **everything `company_admin` has, plus admin-management permissions** (invite/suspend/delete admins). Model this as a superset in the permission matrix (e.g. a new `admins.manage` / `admins.invite` permission granted only to `tenant_superadmin`).
2. **Admin limit**: at most N active Company Admins per tenant, where N is a **per-tenant configurable limit with default 2** (prefer tying it to the tenant plan/limits mechanism if one exists on this branch; otherwise a tenant-level field). Enforce at invite time and at reactivate/role-assign time. Return a clear conflict error code (e.g. `TENANT_ADMIN_LIMIT`).
3. **Directional protection**: a `company_admin` must not be able to deactivate, delete, de-role or otherwise modify the superadmin, and must not be able to invite or promote superadmins. Only the platform owner manages the superadmin.
4. **Anti-lockout invariant moves up**: replace "at least one active company_admin per tenant" with "at least one active `tenant_superadmin` per tenant". Zero active admins is now allowed (the superadmin can operate, since they hold all admin permissions). The superadmin cannot suspend/delete themselves — only the platform owner can replace them.
5. **Superadmin replacement flow**: when the owner invites a new superadmin for a tenant that already has one, define and implement explicit semantics — recommended: the previous superadmin stays active until the new invite is accepted, then is automatically demoted/deactivated (audited). Exactly one *active* superadmin at a time.
6. **Deletion is soft delete** (`deletedAt` already exists on users) and every superadmin/admin lifecycle action must be audited (see `src/modules/audit`).
7. **Migration/bootstrap for existing tenants**: existing tenants have admins but no superadmin. The platform owner must be able to either invite a superadmin into an existing tenant or promote an existing admin to superadmin. Until a tenant has a superadmin, do not brick it: the anti-lockout rule should fall back to protecting the last active admin in tenants with no active superadmin.

## Scope of changes (expected, verify against code)

- **Schema**: add `tenant_superadmin` to `RoleCode`; add the admin-limit field (tenant or plan level); Prisma migration.
- **Permission matrix**: `src/modules/roles/permissions.ts` + `role-permission.matrix.ts` — superadmin = company_admin set ∪ new admin-management permissions. Bump the matrix version string.
- **Platform module**: repoint owner-facing endpoints from managing admins to managing the superadmin (invite/replace/suspend/reactivate superadmin, promote existing admin). Keep audit events.
- **Users module**: superadmin-driven admin invite/suspend/delete with the limit check and directional protection; rework `assertOtherActiveCompanyAdminExists` into the new invariant (keep Serializable transactions — there was a prior race fix here, see commit history).
- **Invites flow**: ensure invite creation validates who may invite which role (`users.invite` today is admin-held; superadmin invitations of admins need the new permission; admins must not be able to invite superadmins).
- **Frontend** (`apps/web/app/[tenantSlug]/admin/...` and platform/operations screens): surface the superadmin in user management, hide/disable forbidden actions against the superadmin for admins, admin-limit feedback; navigation filtering is permission-string based (`apps/web/lib/navigation.ts`).
- **Docs**: update `docs/reference/permissions.md`, `api-reference.md`, `data-model.md` (and `executable-spec.md` mapping) in the same change — this is a hard project convention.
- **Tests**: plain `node --test` files under `tests/`, one behavior per file. Read existing role/lifecycle tests first (e.g. `tests/auth-tenant-isolation.test.ts`, any `TENANT_LAST_ADMIN` coverage) — they are the executable spec. Add tests for: admin limit, admin-cannot-touch-superadmin, last-superadmin lockout guard, superadmin replacement, bootstrap fallback for tenants without a superadmin.

## Working notes

- Run the API with `npm run dev` (ts-node, **not** tsx — tsx breaks Nest DI metadata; see CLAUDE.md).
- Single test file: `node --import tsx --test tests/<file>.test.ts`.
- Start by reading the current code paths listed above rather than trusting this prompt's snapshot of them; the branch `platform-tenant-lifecycle-and-plan` recently reworked tenant status/plan and admin lifecycle, so details may have moved.
