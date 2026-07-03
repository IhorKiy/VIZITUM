# Vizitum Role-Based Screen Delivery Plan

This plan turns the `Vizitum Team Pilot` MVP screen map into an implementation tracker. It focuses on role-specific screens for the Team product mode: one tenant workspace, Company Admin, Team Manager, Field Representatives, simple routes, tasks, manager dashboard and pilot review.

Status legend:

- `Live`: implemented and verified against staging.
- `Partial`: implemented as a shell or combined screen, but needs more product depth before pilot.
- `Planned`: not implemented as a dedicated screen yet.
- `Post-MVP`: intentionally outside Team Pilot.

Priority legend:

- `P0`: needed before the first real pilot.
- `P1`: valuable for dogfood or early pilot improvement.
- `P2`: post-pilot product expansion.

## 1. Current Implemented Routes

| Area                  | Route                         | Current capability                                                                                                                         | Status |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Tenant entry          | `/:tenantSlug/login`          | Tenant-aware login with backend session.                                                                                                   | Live   |
| Tenant entry          | `/:tenantSlug/invites/accept` | Invite acceptance flow.                                                                                                                    | Live   |
| Field Representative  | `/:tenantSlug/field`          | Today's visits, create visit, text note, browser recording, audio upload fallback, manual report confirmation.                             | Live   |
| Field Representative  | `/:tenantSlug/field/history`  | Own-scope visit history with status/date filters, counters and completed/unfinished visit review.                                          | Live   |
| Company Admin         | `/:tenantSlug/admin/setup`    | Live onboarding checklist, setup progress and pilot readiness signals.                                                                     | Live   |
| Company Admin         | `/:tenantSlug/admin/users`    | Live tenant users list, invite creation, status update and role assignment controls with pending submit states.                            | Live   |
| Company Admin         | `/:tenantSlug/admin/imports`  | Template downloads, CSV validation preview, row issues, all-or-nothing confirm.                                                            | Live   |
| Company Admin         | `/:tenantSlug/admin/review`   | Pilot usage thresholds, success metrics and copyable review summary.                                                                       | Live   |
| Team Manager          | `/:tenantSlug/manager`        | Live route/visit/task metrics, task assignment and CSV export.                                                                             | Live   |
| Team Manager          | `/:tenantSlug/manager/visits` | Live tenant visit table with route, status, representative and started date filters, filter context and filtered-empty recovery actions.   | Live   |
| Team Manager          | `/:tenantSlug/manager/tasks`  | Live team task table with route, status, priority, assignee and due date filters, task status updates and filtered-empty recovery actions. | Live   |
| Team Manager          | `/:tenantSlug/manager/locations` | Read-only tenant location coverage list with status/search/area filters, recent visit counts and open follow-up counts.                 | Live   |
| Team Manager          | `/:tenantSlug/manager/representatives` | Read-only representative workload list derived from routes, visits and tasks, with search/activity filters and drilldown links.       | Live   |
| Company Admin         | `/:tenantSlug/admin/settings` | Company display name, IANA time zone and products-applicable toggle, backed by `admin/settings` API.                                      | Live   |
| Company Admin         | `/:tenantSlug/admin/locations` | Location list with status/search filters and inline edit of name, city, type, region, territory and status.                              | Live   |
| Company Admin         | `/:tenantSlug/admin/products`  | Product/SKU list with status/search filters and inline edit of name, SKU, category, not-applicable flag and status.                      | Live   |
| Platform / Operations | `/:tenantSlug/operations`     | Aggregate operations summary for platform operator checks.                                                                                 | Live   |

## 2. Role Screen Map

### Platform / Operations

| Screen                     | MVP intent                                                        | Current state                                                                          | Next delivery step                                                                                              | Priority |
| -------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------- |
| Tenant list                | See all tenant workspaces and status.                             | Covered only indirectly by operations summary counters.                                | Add internal tenant list when production operations console becomes necessary.                                  | P2       |
| Create tenant              | Create pilot tenant, select template, invite Company Admin.       | Backend/platform setup exists; no self-serve UI.                                       | Keep as internal script/admin flow until pilot repeatability requires a UI.                                     | P1       |
| Tenant detail              | Review tenant status, plan, product mode, health and setup notes. | Covered by runbooks and provider dashboards, not app UI.                               | Add tenant detail to internal operations console after first pilot.                                             | P2       |
| Provisioning/import status | Monitor provisioning, migration and import jobs.                  | Operations summary exposes aggregate counters; Admin import shows one tenant job flow. | Add tenant-scoped job history and platform aggregate drilldown.                                                 | P1       |
| Pilot monitoring metrics   | Track pilot usage and readiness.                                  | Some signals are in Manager dashboard and ops summary.                                 | Build a dedicated pilot review screen for Company Admin first; platform monitoring can reuse its metrics later. | P0/P1    |

### Company Admin

| Screen                  | MVP intent                                                  | Current state                                                                                                                                                      | Next delivery step                                                                               | Priority |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------- |
| Onboarding checklist    | Guide customer setup before pilot activation.               | Live and staging-smoked at `/:tenantSlug/admin/setup` with live setup progress for users, roles, locations, products/SKUs, import templates and pilot readiness.   | Add deeper tenant settings once that screen exists.                                             | P0       |
| Admin overview          | Show setup status and next admin actions.                   | Not dedicated.                                                                                                                                                     | Add overview as the landing page for Company Admin, with links to imports and future settings.   | P1       |
| Users                   | Invite, view, deactivate users and manage roles.            | Live and staging-smoked at `/:tenantSlug/admin/users` with user list, invite creation, suspend/reactivate and add/remove role controls, pending submit states, invite history, expiry visibility and fresh-token resend. | Add deeper role audit/history only if pilot admins need it.                                      | P0       |
| Locations               | View/manage locations and assignments.                      | Live at `/:tenantSlug/admin/locations`: status/search filters and inline edit of name, city, type, region, territory and status. Contact/assignment management is still API-only. | Add contact and representative-assignment editing to the same screen if pilot admins need it inline. | P1       |
| Products/SKU            | View/manage products or mark products not applicable.       | Live at `/:tenantSlug/admin/products`: status/search filters and inline edit of name, SKU, category, not-applicable flag and status.                               | None planned; revisit only if pilot templates need custom SKU attributes.                        | Done     |
| Imports                 | Download templates, validate, review issues and confirm.    | Live and staging-smoked with tenant-scoped import history, row counts, statuses, uploader/confirmer and applied output summary.                                     | Add richer validation failure filtering only if pilot admins need it.                            | P1       |
| Visit template settings | Select report type/template and required fields.            | Templates exist in product spec and AI schemas; no dedicated admin UI.                                                                                             | Start with read-only template summary, then add editable tenant settings post-pilot.             | P1/P2    |
| Branding                | Tenant display identity.                                    | Not dedicated.                                                                                                                                                     | Defer unless pilot customer requires it.                                                         | P2       |
| Tenant settings         | Company name, timezone, product mode, enabled report types. | Live at `/:tenantSlug/admin/settings`: editable company name and IANA time zone (`PlatformTenant`), products-applicable toggle backed by `TenantSetting`, read-only product mode. | Enabled report types have no backend model yet; add a dedicated template/report-type settings surface only once that model exists. | P1/P2    |
| Pilot review            | Review usage thresholds after 7-10 days.                    | Live and staging-smoked at `/:tenantSlug/admin/review` with live usage metrics, success thresholds and copyable summary.                                           | Add AI draft and manager dashboard usage instrumentation when those events are tracked.          | P0       |

### Team Manager

| Screen          | MVP intent                                                    | Current state                                                                                                                                                                            | Next delivery step                                                          | Priority |
| --------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| Team overview   | See team activity, route execution, reports and blocked work. | Implemented as `/:tenantSlug/manager`.                                                                                                                                                   | Add route/date filtering once overview date range is selected.              | P0       |
| Visits          | Review all tenant visits and AI/manual summaries.             | Live and staging-smoked at `/:tenantSlug/manager/visits` with route, status, representative and started date filters, counters, tenant visit table and clearer empty filtered states.    | Add report detail when the report detail UI exists.                         | P0       |
| Tasks           | View/create/update team tasks.                                | Live and staging-smoked at `/:tenantSlug/manager/tasks` with route, status, priority, assignee and due date filters, counters, status update controls and clearer empty filtered states. | Add richer task board/grouping after pilot-critical table view is verified. | P0       |
| Locations       | Find locations, coverage and open issues.                     | Live at `/:tenantSlug/manager/locations` with read-only status/search/area filters, recent visit counts, open follow-up counts and links into location-filtered visits/tasks.           | Add contact/history detail only if pilot managers need it after the table view is verified. | P1       |
| Representatives | See field rep workload and activity.                          | Live at `/:tenantSlug/manager/representatives` with workload counters, search/activity filters and links into representative-filtered visits/tasks.                                      | Add deeper per-representative history only if pilot managers need it after the table view is verified. | P1       |

### Field Representative

| Screen                | MVP intent                                          | Current state                                                                                                              | Next delivery step                                                                              | Priority |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| Home / today          | See today's visits and route summary.               | Implemented as `/:tenantSlug/field`.                                                                                       | Improve empty states and mobile ergonomics.                                                     | P0       |
| Route or daily plan   | View/change own route using assigned locations.     | Combined into Field page; route management is shallow.                                                                     | Add clearer planned/unplanned visit flow and own route controls.                                | P0       |
| Location card         | Open location details, contacts, history and tasks. | Compact location cards are staging-smoked in the Field page with address, type/region/territory and notes when available.  | Add richer history/contact drilldown after the first pilot-critical flow is verified.           | P0       |
| Visit form            | Start visit and add text/audio note.                | Implemented and staging-smoked, including audio success/error recovery links and clearer recorder fallback copy.                              | Improve empty states and mobile ergonomics after pilot-critical flows stay stable.              | P0       |
| AI draft confirmation | Review structured AI output before final report.    | Field visit cards are staging-smoked with AI draft state messaging, weak-output guidance and manual fallback confirmation. | Add live AI job/draft listing when the frontend has a status/read endpoint for extraction jobs. | P0/P1    |
| Tasks                 | See and update own tasks.                           | Field page own task panel is staging-smoked with priority/due details and status update controls.                          | Add location names to task cards when task API includes location detail.                        | P0       |
| Visit history         | Review previous visits and reports.                 | Live at `/:tenantSlug/field/history` with own-scope visit table, status/date filters and completed/unfinished counters.    | Add report detail links after the report detail UI exists.                                      | P1       |

### Company Owner / Executive

| Screen                        | MVP intent                     | Current state       | Next delivery step                       | Priority |
| ----------------------------- | ------------------------------ | ------------------- | ---------------------------------------- | -------- |
| Executive dashboard           | High-level Business view.      | Outside Team Pilot. | Keep as Business/post-MVP extension.     | Post-MVP |
| Company/region/team analytics | Granular management analytics. | Outside Team Pilot. | Reuse core tenant data model later.      | Post-MVP |
| Management report export      | Executive export package.      | Outside Team Pilot. | Revisit after pilot review proves value. | Post-MVP |

## 3. P0 Screen Delivery Sequence

1. Company Admin users screen: list, invite, role assignment, deactivate, pending invite history, expiry visibility and fresh-token resend.
2. Company Admin onboarding checklist: setup progress and pilot readiness. Initial screen implemented.
3. Team Manager visits list: filters, visit status, report summary drilldown. Initial list/filter screen implemented.
4. Team Manager task list: update status/priority and track overdue work. Initial list/filter/update screen implemented.
5. Field location card and own tasks panel inside the current Field page. Initial compact cards and task status updates implemented.
6. Pilot review screen: usage thresholds, success metrics and copyable review summary. Initial screen implemented.
7. Field AI draft state: show extraction status, weak-output messaging and manual fallback. Initial UI state and fallback messaging implemented.

The full initial P0 sequence passed staging re-smoke on 2026-07-03 against release `9a3d84e37afa0b9892be6aa230c47f7f65b21898`.

## 4. P1 Screen Delivery Sequence

1. Admin import history with applied row counts and validation failure history. Initial version implemented and staging-smoked.
2. Tenant settings screen for company identity and products applicability. Implemented at `/:tenantSlug/admin/settings`; enabled report types deferred until a report-type model exists.
3. Admin locations and products/SKU list screens. Implemented at `/:tenantSlug/admin/locations` and `/:tenantSlug/admin/products` with status/search filters and inline edit; contact/assignment editing stays API-only for now.
4. Manager location browser. Initial read-only coverage list implemented at `/:tenantSlug/manager/locations`; staging smoke pending.
5. Representative drilldown. Initial read-only workload list implemented at `/:tenantSlug/manager/representatives`; staging smoke pending.
6. Field visit history. Initial own-scope history view implemented at `/:tenantSlug/field/history`; staging smoke pending.
7. Platform create tenant or tenant detail UI if internal setup needs repeatable non-script operation.

## 5. Product Rules For Role-Based Screens

- A user may have multiple roles; navigation must stay permission-aware and show only screens allowed by effective permissions.
- Team Manager full tenant view means operational read access, not Company Admin rights.
- Company Admin configures tenant setup, users, roles and imports, but does not automatically get manager dashboard unless assigned Team Manager too.
- Field Representative sees own work and assigned locations; creating master locations is not a default MVP right.
- Executive screens are not part of Team Pilot and should not distract from first-pilot delivery.
- Manual report confirmation must remain available whenever AI extraction is weak, delayed or unavailable.

## 6. Verification Path

Each P0 screen should be added to `docs/runbooks/expanded-staging-product-smoke.md` once implemented. Before the first production pilot, the smoke path must cover:

- Company Admin onboarding checklist, user invite/role update and imports.
- Team Manager dashboard, visits list, task list and CSV/export path.
- Field Representative today's plan, visit creation, location card, text/audio note, manual or AI draft confirmation and own tasks.
- Pilot review summary after seeded or real pilot activity.
