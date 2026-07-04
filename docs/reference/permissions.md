# Roles & Permissions

Reference for the implemented access model. Source of truth: `src/modules/roles/permissions.ts`, `src/modules/roles/role-permission.matrix.ts` (matrix version `2026-06-29-mvp-team-v1`), `src/modules/auth/permission.guard.ts`. Update this document in the same change as any permission or matrix change.

## How enforcement works

1. Controllers declare requirements with `@RequirePermissions(...)` (**all** listed permissions required) or `@RequireAnyPermissions(...)` (**one** is enough) from `src/modules/auth/permissions.decorator.ts`.
2. `PermissionGuard` resolves the session → tenant → user → roles, expands roles to permissions via `RolesService`, checks the requirement, and attaches the `RequestContext` to the request. Undecorated endpoints skip the guard entirely (auth, health).
3. Users can hold **multiple roles**; their effective permission set is the union. Frontend navigation (`apps/web/lib/navigation.ts`) filters screens by the same permission strings.
4. A `platform_owner` session (`vizitum_platform_session`, resolved from a `PlatformUser`) yields a context with the full `platform_owner` permission set (`platform.tenants.read`, `platform.tenants.manage`, `platform.operations.read`), `tenantId: "platform"` and the platform user id as `userId`. The platform bearer token is a separate, narrower service credential that grants only `platform.operations.read` (for `GET /operations/summary`); it cannot manage tenants.

## Roles

- `platform_owner` — platform-level, not a tenant role (not in the Prisma `RoleCode` enum). Held by a `PlatformUser` (separate identity, own `platform_users`/`platform_sessions` tables) and granted through the `POST /platform/auth/login` session flow. No tenant `User` can hold this role.
- `company_admin`, `team_manager`, `field_representative` — tenant roles (`RoleCode`).

**Team Manager full tenant view means operational read access, not Company Admin rights** — managers see team visits/reports/tasks but cannot manage users, settings, or imports.

## Role → permission matrix

| Permission | platform_owner | company_admin | team_manager | field_representative |
| --- | :-: | :-: | :-: | :-: |
| `platform.tenants.read` | x | | | |
| `platform.tenants.manage` | x | | | |
| `platform.operations.read` | x | | | |
| `tenant.settings.read` | | x | | |
| `tenant.settings.manage` | | x | | |
| `users.read` | | x | | |
| `users.invite` | | x | | |
| `users.manage` | | x | | |
| `roles.assign` | | x | | |
| `locations.read` | | x | x | x |
| `locations.manage` | | x | | |
| `locations.assign` | | x | | |
| `contacts.read` | | x | x | x |
| `contacts.manage` | | x | | |
| `products.read` | | x | x | x |
| `products.manage` | | x | | |
| `routes.read` | | | x | x |
| `routes.manage_team` | | | x | |
| `routes.manage_own` | | | | x |
| `visits.read_own` | | | | x |
| `visits.read_team` | | | x | |
| `visits.create` | | | | x |
| `visits.update_own` | | | | x |
| `visits.cancel_own` | | | | x |
| `reports.read_own` | | | | x |
| `reports.read_team` | | | x | |
| `reports.confirm_own` | | | | x |
| `tasks.read_own` | | | | x |
| `tasks.read_team` | | | x | |
| `tasks.create` | | | x | x |
| `tasks.update_own` | | | | x |
| `tasks.update_team` | | | x | |
| `imports.read` | | x | | |
| `imports.upload` | | x | | |
| `imports.confirm` | | x | | |
| `ai.use_reporting` | | | | x |
| `dashboard.manager.read` | | | x | |
| `pilot_review.read` | | | x | |
| `audit.read` | | x | | |

## Ownership-scoped permissions

- `routes.manage_team` vs `routes.manage_own`: route mutations (`POST /routes`, `PATCH /routes/:routePlanId`, item create/update) require either one at the guard level (`@RequireAnyPermissions`); `RoutesService.assertCanManageRouteForRepresentative` then enforces ownership. `routes.manage_team` may manage any plan in the tenant; `routes.manage_own` only plans whose `representativeUserId` equals the caller (403 `ROUTE_SCOPE_FORBIDDEN` otherwise).
- The `visits.*_own` / `tasks.*_own` permissions are scoped the same way inside their services.

## Known gaps (as implemented)

- `visits.cancel_own`, `audit.read` are defined and granted but no controller currently requires them.
- `platform.tenants.read`/`platform.tenants.manage` are enforced by `platform.controller.ts` across the full tenant lifecycle (list/get + create/update/archive) and reachable via a `platform_owner` session (`POST /platform/auth/login`). The platform bearer token no longer grants these — it is limited to `platform.operations.read`.
- `pilot_review.read` and `dashboard.manager.read` are granted only to `team_manager`, but the frontend Review nav item (`admin/review`) and `GET /pilot-review/summary`/`POST /pilot-review/dashboard-views` require one of them — so the review screen and its data are reachable by managers, not by `company_admin` without also holding the manager role.
