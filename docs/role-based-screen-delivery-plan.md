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

| Area                  | Route                         | Current capability                                                                                             | Status |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| Tenant entry          | `/:tenantSlug/login`          | Tenant-aware login with backend session.                                                                       | Live   |
| Tenant entry          | `/:tenantSlug/invites/accept` | Invite acceptance flow.                                                                                        | Live   |
| Field Representative  | `/:tenantSlug/field`          | Today's visits, create visit, text note, browser recording, audio upload fallback, manual report confirmation. | Live   |
| Company Admin         | `/:tenantSlug/admin/imports`  | Template downloads, CSV validation preview, row issues, all-or-nothing confirm.                                | Live   |
| Team Manager          | `/:tenantSlug/manager`        | Live route/visit/task metrics, task assignment and CSV export.                                                 | Live   |
| Platform / Operations | `/:tenantSlug/operations`     | Aggregate operations summary for platform operator checks.                                                     | Live   |

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

| Screen                  | MVP intent                                                  | Current state                                                                                                                                                             | Next delivery step                                                                                                | Priority |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| Onboarding checklist    | Guide customer setup before pilot activation.               | Dedicated frontend screen exists at `/:tenantSlug/admin/setup` with live setup progress for users, roles, locations, products/SKUs, import templates and pilot readiness. | Add deeper tenant settings and applied import history once those screens exist.                                   | P0       |
| Admin overview          | Show setup status and next admin actions.                   | Not dedicated.                                                                                                                                                            | Add overview as the landing page for Company Admin, with links to imports and future settings.                    | P1       |
| Users                   | Invite, view, deactivate users and manage roles.            | Dedicated frontend screen exists at `/:tenantSlug/admin/users` with user list, invite creation, suspend/reactivate and add/remove role controls.                          | Add pending invite history once invite listing exists.                                                            | P0       |
| Locations               | View/manage locations and assignments.                      | Backend locations API exists; admin UI only imports locations.                                                                                                            | Add list/detail/edit screen after users screen.                                                                   | P1       |
| Products/SKU            | View/manage products or mark products not applicable.       | Backend products API exists; admin UI only imports products.                                                                                                              | Add products list/settings screen for pilot templates that need SKU tracking.                                     | P1       |
| Imports                 | Download templates, validate, review issues and confirm.    | Implemented and staging-smoked.                                                                                                                                           | Add import history and applied row counts.                                                                        | P1       |
| Visit template settings | Select report type/template and required fields.            | Templates exist in product spec and AI schemas; no dedicated admin UI.                                                                                                    | Start with read-only template summary, then add editable tenant settings post-pilot.                              | P1/P2    |
| Branding                | Tenant display identity.                                    | Not dedicated.                                                                                                                                                            | Defer unless pilot customer requires it.                                                                          | P2       |
| Tenant settings         | Company name, timezone, product mode, enabled report types. | Backend model exists; no dedicated frontend screen.                                                                                                                       | Add minimal settings screen for company name, default report types and products applicable flag.                  | P1       |
| Pilot review            | Review usage thresholds after 7-10 days.                    | Not dedicated.                                                                                                                                                            | Build pilot review summary with visits, confirmed reports, active reps, manager dashboard usage and task metrics. | P0       |

### Team Manager

| Screen          | MVP intent                                                    | Current state                                                                                                                       | Next delivery step                                                          | Priority |
| --------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| Team overview   | See team activity, route execution, reports and blocked work. | Implemented as `/:tenantSlug/manager`.                                                                                              | Add date range, route, representative and status filters.                   | P0       |
| Visits          | Review all tenant visits and AI/manual summaries.             | Dedicated frontend screen exists at `/:tenantSlug/manager/visits` with status filters, counters and tenant visit table.             | Add report detail drilldown when report detail UI exists.                   | P0       |
| Tasks           | View/create/update team tasks.                                | Dedicated frontend screen exists at `/:tenantSlug/manager/tasks` with status/priority filters, counters and status update controls. | Add richer task board/grouping after pilot-critical table view is verified. | P0       |
| Locations       | Find locations, coverage and open issues.                     | Location options appear in task assignment; no manager location browser.                                                            | Add location list focused on coverage and recent activity.                  | P1       |
| Representatives | See field rep workload and activity.                          | Representative summaries are derived from routes.                                                                                   | Add representative drilldown after visits/tasks list.                       | P1       |

### Field Representative

| Screen                | MVP intent                                          | Current state                                                                               | Next delivery step                                                              | Priority |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| Home / today          | See today's visits and route summary.               | Implemented as `/:tenantSlug/field`.                                                        | Improve empty states and mobile ergonomics.                                     | P0       |
| Route or daily plan   | View/change own route using assigned locations.     | Combined into Field page; route management is shallow.                                      | Add clearer planned/unplanned visit flow and own route controls.                | P0       |
| Location card         | Open location details, contacts, history and tasks. | Locations are selectable when creating a visit; no dedicated card.                          | Add compact location card or expandable location panel inside Field page first. | P0       |
| Visit form            | Start visit and add text/audio note.                | Implemented and staging-smoked.                                                             | Add stronger recovery guidance for audio/transcription errors.                  | P0       |
| AI draft confirmation | Review structured AI output before final report.    | Manual report confirmation is live; full AI draft confirmation UI still needs quality pass. | Add AI draft state with manual fallback and confidence/error messaging.         | P0/P1    |
| Tasks                 | See and update own tasks.                           | Tasks can be created by manager; Field page does not yet focus own task list.               | Add own tasks panel to Field page.                                              | P0       |
| Visit history         | Review previous visits and reports.                 | Current visits list exists; no dedicated history view.                                      | Add history section or separate tab after pilot-critical flows are stable.      | P1       |

### Company Owner / Executive

| Screen                        | MVP intent                     | Current state       | Next delivery step                       | Priority |
| ----------------------------- | ------------------------------ | ------------------- | ---------------------------------------- | -------- |
| Executive dashboard           | High-level Business view.      | Outside Team Pilot. | Keep as Business/post-MVP extension.     | Post-MVP |
| Company/region/team analytics | Granular management analytics. | Outside Team Pilot. | Reuse core tenant data model later.      | Post-MVP |
| Management report export      | Executive export package.      | Outside Team Pilot. | Revisit after pilot review proves value. | Post-MVP |

## 3. P0 Screen Delivery Sequence

1. Company Admin users screen: list, invite, role assignment and deactivate. Initial screen implemented; pending invite history remains an expansion.
2. Company Admin onboarding checklist: setup progress and pilot readiness. Initial screen implemented.
3. Team Manager visits list: filters, visit status, report summary drilldown. Initial list/filter screen implemented.
4. Team Manager task list: update status/priority and track overdue work. Initial list/filter/update screen implemented.
5. Field location card and own tasks panel inside the current Field page.
6. Pilot review screen: usage thresholds, success metrics and copyable review summary.
7. Field AI draft state: show extraction status, weak-output messaging and manual fallback.

## 4. P1 Screen Delivery Sequence

1. Admin import history with applied row counts and validation failure history.
2. Admin locations and products/SKU list screens.
3. Tenant settings screen for company identity, products applicability and report types.
4. Manager location browser and representative drilldown.
5. Field visit history.
6. Platform create tenant or tenant detail UI if internal setup needs repeatable non-script operation.

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
