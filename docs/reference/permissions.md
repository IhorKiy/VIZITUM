# Roles & Permissions

Reference for the implemented access model. Source of truth: `src/modules/roles/permissions.ts`, `src/modules/roles/role-permission.matrix.ts` (matrix version `2026-07-20-location-insights-v1`), `src/modules/auth/permission.guard.ts`. Update this document in the same change as any permission or matrix change.

## How enforcement works

1. Controllers declare requirements with `@RequirePermissions(...)` (**all** listed permissions required) or `@RequireAnyPermissions(...)` (**one** is enough) from `src/modules/auth/permissions.decorator.ts`.
2. `PermissionGuard` resolves the session → tenant → user → roles, expands roles to permissions via `RolesService`, checks the requirement, and attaches the `RequestContext` to the request. Undecorated endpoints skip the guard entirely (auth, health). A request can carry a platform session cookie and a tenant session cookie at the same time (both are `path: "/"`, e.g. a platform owner accepting a tenant invite in the same tab used to create the tenant) — the guard builds a context candidate for every credential actually present (bearer token, platform session, tenant session) and uses whichever one satisfies the route's required permission(s), rather than always preferring one over the other. This is unambiguous because platform and tenant permissions never overlap (see matrix below; pinned by `tests/role-permission-domain-disjointness.test.ts`).
3. Users can hold **multiple roles**; their effective permission set is the union. Frontend navigation (`apps/web/lib/navigation.ts`) filters screens by the same permission strings.
4. A `platform_owner` session (`vizitum_platform_session`, resolved from a `PlatformUser`) yields a context with the full `platform_owner` permission set (`platform.tenants.read`, `platform.tenants.manage`, `platform.operations.read`), `tenantId: "platform"` and the platform user id as `userId`. The platform bearer token is a separate, narrower service credential that grants only `platform.operations.read` (for `GET /operations/summary`); it cannot manage tenants.

## Roles

- `platform_owner` — platform-level, not a tenant role (not in the Prisma `RoleCode` enum). Held by a `PlatformUser` (separate identity, own `platform_users`/`platform_sessions` tables) and granted through the `POST /platform/auth/login` session flow. No tenant `User` can hold this role. Platform owners invite, replace and promote the **tenant superadmin** from the platform console through `/platform/tenants/:tenantId/superadmin/*` — they no longer manage Company Admins directly (that moved to the superadmin, see below); those actions are tenant-scoped and audited as platform operation events (plus a tenant `AuditEvent`), but the platform owner does not gain tenant operational permissions.
- `tenant_superadmin` — tenant role (`RoleCode`), **one active per tenant**. The customer's responsible person: holds every `company_admin` permission plus admin-management (`admins.invite`, `admins.manage`). Only invited/replaced by the platform owner (`POST /platform/tenants/:tenantId/superadmin/invite`) or promoted from an existing Company Admin (`POST .../superadmin/promote`); see [api-reference.md](api-reference.md) for the replacement semantics (the old superadmin is demoted to a suspended `company_admin`, not just deactivated, when the new invite is accepted) and `data-model.md` for `PlatformTenant.adminLimit`.
- `company_admin`, `team_manager`, `field_representative` — tenant roles (`RoleCode`).

**Team Manager full tenant view means operational read access, not Company Admin rights** — managers see team visits/reports/tasks but cannot manage users, settings, or imports.

**Admin management is exclusive to the superadmin.** A `company_admin` cannot invite, suspend, reactivate, delete or re-role _any_ `company_admin` (including itself) — only a `tenant_superadmin` can, via `admins.invite`/`admins.manage`. `company_admin` keeps unrestricted control of `team_manager`/`field_representative` through the existing `users.*`/`roles.assign` permissions. The superadmin itself can only be modified by the platform owner — no tenant-side permission grants access to change its status or roles (see `SUPERADMIN_PROTECTED` in api-reference.md).

## Role → permission matrix

| Permission                 | platform_owner | tenant_superadmin | company_admin | team_manager | field_representative |
| -------------------------- | :------------: | :---------------: | :-----------: | :----------: | :------------------: |
| `platform.tenants.read`    |       x        |                   |               |              |                      |
| `platform.tenants.manage`  |       x        |                   |               |              |                      |
| `platform.operations.read` |       x        |                   |               |              |                      |
| `tenant.settings.read`     |                |         x         |       x       |              |                      |
| `tenant.settings.manage`   |                |         x         |       x       |              |                      |
| `users.read`               |                |         x         |       x       |              |                      |
| `users.invite`             |                |         x         |       x       |              |                      |
| `users.manage`             |                |         x         |       x       |              |                      |
| `roles.assign`             |                |         x         |       x       |              |                      |
| `admins.invite`            |                |         x         |               |              |                      |
| `admins.manage`            |                |         x         |               |              |                      |
| `locations.read`           |                |         x         |       x       |      x       |          x           |
| `locations.manage`         |                |         x         |       x       |              |                      |
| `locations.assign`         |                |         x         |       x       |              |                      |

<!-- Chains (`/chains`, retail networks) are part of the location domain and have no dedicated permission: reads use `locations.read`, create/update use `locations.manage`. -->
<!-- Location categories (`/location-categories`) are the same: no dedicated permission, reuses `locations.read`/`locations.manage`. -->

| `location_insights.read` | | x | x | x | x |
| `location_insights.manage` | | x | x | | |
| `location_insights.manage_own` | | | | | x |

| `contacts.read` | | x | x | x | x |
| `contacts.manage` | | x | x | | |
| `products.read` | | x | x | x | x |
| `products.manage` | | x | x | | |
| `routes.read` | | | | x | x |
| `routes.manage_team` | | | | x | |
| `routes.manage_own` | | | | | x |
| `visits.read_own` | | | | | x |
| `visits.read_team` | | | | x | |
| `visits.create` | | | | | x |
| `visits.update_own` | | | | | x |
| `visits.cancel_own` | | | | | x |
| `reports.read_own` | | | | | x |
| `reports.read_team` | | | | x | |
| `reports.confirm_own` | | | | | x |
| `tasks.read_own` | | | | | x |
| `tasks.read_team` | | | | x | |
| `tasks.create` | | | | x | x |
| `tasks.update_own` | | | | | x |
| `tasks.update_team` | | | | x | |
| `imports.read` | | x | x | | |
| `imports.upload` | | x | x | | |
| `imports.confirm` | | x | x | | |
| `ai.use_reporting` | | | | | x |
| `dashboard.manager.read` | | | | x | |
| `pilot_review.read` | | x | x | x | |
| `audit.read` | | x | x | | |

## Ownership-scoped permissions

- `routes.manage_team` vs `routes.manage_own`: route mutations (`POST /routes`, `PATCH /routes/:routePlanId`, item create/update) require either one at the guard level (`@RequireAnyPermissions`); `assertCanManageRouteForRepresentative` (`src/modules/routes/route-access.ts`) then enforces ownership. `routes.manage_team` may manage any plan in the tenant; `routes.manage_own` only plans whose `representativeUserId` equals the caller (403 `ROUTE_SCOPE_FORBIDDEN` otherwise). `RouteTemplatesService` (`/routes/templates/*`) calls the same shared helper against a template's `representativeUserId`, so route-plan and route-template ownership can never drift apart into two different checks.
- The `visits.*_own` / `tasks.*_own` permissions are scoped the same way inside their services.
- `location_insights.manage` vs `location_insights.manage_own`: writes to `PUT`/`DELETE /locations/:locationId/potential[/:productCategoryId]` and `.../assortment[/:productId]` require either one at the guard level (`@RequireAnyPermissions`); `assertCanManageLocationInsights` (`src/modules/location-insights/location-insights-access.ts`) then enforces ownership. `location_insights.manage` may manage any location in the tenant; `location_insights.manage_own` only a location the caller (a `field_representative`) has an **active `LocationAssignment`** for — a live query per request, not a column stamped on the row, since potential/assortment rows have no representative field of their own (403 `LOCATION_INSIGHTS_SCOPE_FORBIDDEN` otherwise). `LocationPotentialService` and `LocationAssortmentService` call the same shared helper, so the two tables' ownership rules can never drift apart. Reads (`location_insights.read`) stay tenant-wide for all four roles, same as `locations.read` — only writes are ownership-scoped. Each list response also exposes a computed `canManage: boolean` (from the same helper's non-throwing form) so the frontend can hide edit affordances a field rep can't use, without re-deriving the rule client-side.
- `tenant.settings.manage` also covers tenant branding: the color-scheme field on `PATCH /admin/settings` and the logo endpoints `/admin/settings/logo/*`; inside `StorageService`, `branding_logo` objects require it to write and `tenant.settings.read` to read (the login page reads branding via the public unguarded `GET /tenants/:slug/branding` instead).
- `admins.invite`/`admins.manage` are role-target-scoped inside `UsersService` rather than guard-level: the guard only requires the baseline `users.invite`/`users.manage`/`roles.assign` (or `admins.manage` directly for `DELETE /admin/users/:userId`), and the service checks the finer-grained permission only when the request targets (or would grant) `company_admin`, and unconditionally blocks any request targeting a `tenant_superadmin` user regardless of the actor's permissions.

## Known gaps (as implemented)

- `visits.cancel_own` is defined and granted but no controller currently requires it.
- `platform.tenants.read`/`platform.tenants.manage` are enforced by `platform.controller.ts`, `platform-tenant-users.controller.ts` (read-only tenant user listing) and `platform-tenant-superadmin.controller.ts` (superadmin invite/replace/promote) across tenant lifecycle — including the purge-marking endpoint `POST /platform/tenants/:tenantId/purge`, which uses the same `platform.tenants.manage` gate as archive/unarchive plus a slug-echo confirmation payload. These are reachable via a `platform_owner` session (`POST /platform/auth/login`). The platform bearer token no longer grants these — it is limited to `platform.operations.read`. There is no purge surface anywhere under tenant routes: the destructive work itself runs only in the `purge` worker, not behind any HTTP endpoint.
- `pilot_review.read` is granted to `company_admin`/`tenant_superadmin` (they run onboarding, and the `/admin/pilot` section hosting the readiness checklist + pilot review is nav-gated on it) as well as `team_manager`. `dashboard.manager.read` stays manager-only; `GET /pilot-review/summary` requires `pilot_review.read` and `POST /pilot-review/dashboard-views` accepts either (`@RequireAnyPermissions`). Because `team_manager` holds `pilot_review.read`, the admin zone stays available to plain managers while the tenant is on the pilot plan — see the "Known cross-zone overlap" note in [module-map.md](module-map.md); the frontend hides the whole `admin/pilot` area (and drops it from zone availability) once the tenant graduates off the pilot plan (`pilotActive` from `GET /auth/me`).
