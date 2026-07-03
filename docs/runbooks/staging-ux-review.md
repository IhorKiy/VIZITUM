# Staging UX Review

Use this record after staging smoke checks to decide whether the current frontend is acceptable for a controlled pilot.

Review date: 2026-07-02
Reviewed surface: repository frontend routes and staging smoke evidence
Tenant: `vizitum-staging`
Mitigation update: unavailable assisted-pilot action controls were disabled in the frontend after this review. The Field page now includes new visit creation, text note capture, browser voice recording with file upload fallback and a minimal manual report confirmation form for assigned visits.
Expanded smoke update: the 2026-07-02 staging recheck passed Field visit creation, text note, browser recording/upload, audio file fallback and manual report confirmation, Admin template proxy/validation/confirm, plus Manager dashboard CSV export and task assignment.
P0 role-screen update: the 2026-07-03 staging re-smoke passed Admin setup/users/review, Manager visits/tasks drilldowns and Field location/tasks/AI draft messaging.
Dogfood update: the 2026-07-03 internal dogfood cycle exercised a planned visit, text note, manual fallback report and manager follow-up task. The flow worked, but exposed focused UX fixes for manager task assignment options, open-task counting, cancelled-task visibility and duplicate-submit feedback. Pending/disabled submit states were added to Field, Manager, Admin import and Admin users forms after these findings; Manager visits/tasks drilldowns now show filter context, filtered-empty recovery actions and representative/assignee date-range filters.

## Summary

The product-facing staging UX has passed the controlled product smoke path: Field visit creation, browser recording/upload, audio file fallback, manual report confirmation, Admin import template/validation/confirm, Manager dashboard export and Manager task assignment passed against staging. The initial P0 role-based screens for Company Admin, Team Manager and Field Representative also passed staging re-smoke on 2026-07-03.

The first internal dogfood cycle passed the core planned-visit path but showed that a real user needs stronger immediate feedback around multi-form submissions, manager task assignment defaults and filtered drilldown recovery states.

Before a self-serve customer pilot, keep the accepted staging product smoke as the baseline and track remaining alert, backup and restore gates in the launch readiness record.

## Passed Smoke Surfaces

| Surface                      | Status  | Notes                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant login                 | Pass    | Tenant-aware login posts `tenantSlug` to backend and forwards session cookies.                                                                                                                                                                                                |
| Invite acceptance            | Pass    | Invite acceptance page exists and creates session after accepted invite.                                                                                                                                                                                                      |
| Field page load              | Pass    | Authenticated session loads visits API and disables demo fallback by default in production; visit creation, text note and manual report passed on 2026-07-02; location cards, own task update and AI draft/fallback messaging passed on 2026-07-03.                           |
| Admin setup/users/review     | Pass    | Setup checklist, users/roles screen and pilot review summary render live tenant data without demo fallback; Admin users mutations now have pending/disabled submit states. Mutation controls were present and existing user churn was avoided during the 2026-07-03 re-smoke. |
| Admin imports page load      | Pass    | Page loads live templates; per-template downloads route through tenant-local Next proxy; one-row users import validated with 0 errors and confirmed with 1 applied row.                                                                                                       |
| Manager dashboard/drilldowns | Pass    | Reads routes, visits and tasks, builds live aggregate cards, exports CSV, creates manager tasks, filters visits/tasks by status, priority, representative/assignee and date range, shows selected-filter context and updates task status when APIs return data.               |
| Operations page load         | Partial | Page exists and live API path exists; operations bearer token env still needs verification.                                                                                                                                                                                   |
| Manual report confirmation   | Pass    | Smoke report confirmation passed according to staging evidence packet.                                                                                                                                                                                                        |

## Internal Dogfood Findings

| Scenario                    | Result          | Evidence                                                                                                                                                                                                               | Follow-up                                                                                                                                                     |
| --------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planned field visit         | Pass with note  | Created visit `cmr4iqtop00002aajnk67l8o7`, added a text note, confirmed manual fallback report and verified Manager visits showed 4 visits total and 3 confirmed reports.                                              | Success feedback can appear after a later action on the multi-form Field page; keep improving submit/pending states so users do not repeat an action.         |
| Manager follow-up task      | Pass with issue | Created `Dogfood manager follow-up 2026-07-03T05:54:37.128Z`; first repeated submit produced duplicate task ids `cmr4iuadg00052aajekks5g8f` and `cmr4itlv900042aajz8frm90h`; duplicate was cancelled.                  | Manager dashboard should expose real assignee/location options even when today's route list is empty, count only open tasks and reduce duplicate-submit risk. |
| Manager assignment re-smoke | Pass            | After deploy, Manager task form exposed `Vizitum Staging Admin` and `Smoke Test Location`; created assigned task `cmr4j55gz00002b79vn55wuju`, verified it in Manager Tasks and Field `My tasks`.                       | Keep the accepted path; filter cancelled tasks out of Field actionable tasks and Manager attention queue.                                                     |
| Cancelled task filtering    | Pass            | After deploy, cancelled task remained visible in Manager Tasks `?status=cancelled`, while Manager attention queue no longer showed the cancelled task and Field actionable tasks did not show the cancelled duplicate. | Keep cancelled records available for audit/filtering but out of default action queues.                                                                        |

## Pilot-Blocking Issues

These should be resolved or explicitly accepted before inviting non-internal pilot users.

| Issue                                             | Area       | Severity | Why It Matters                                                      | Recommended Decision                                                                        |
| ------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Production operations summary is not verified yet | Operations | Medium   | Production services and production operator token do not exist yet. | Repeat the staging-verified operations summary check after production services are created. |

## Non-Blocking UX Gaps

| Gap                                                    | Area                | Recommendation                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Demo fallback exists for local development             | All app pages       | Acceptable because production fallback is disabled by default. Keep `ENABLE_DEMO_FALLBACK` unset/false in production.                                                          |
| Operations page is platform-oriented but tenant-routed | Operations          | Acceptable for internal operators during pilot; revisit if exposing to customer tenants.                                                                                       |
| Import history list is not exposed yet                 | Admin imports       | Current upload result is live; add a historical import jobs list only if self-serve admin onboarding needs audit visibility.                                                   |
| Multi-form submit feedback can lag                     | Field/Manager/Admin | Pending/disabled submit states were added to Field, Manager, Admin import and Admin users forms; re-smoke after deploy and continue improving notice anchoring if lag appears. |
| Empty live lists need clear next actions               | Field/Manager       | Field and Manager now avoid demo-looking fallback for empty live lists; Manager filtered drilldowns show context, date/assignee filters and recovery actions.                  |
| Cancelled tasks can remain visually prominent          | Field/Manager       | Cancelled tasks are filtered out of Field actionable task cards and Manager attention queue while preserved in Manager task filters.                                           |

## Recommended Pilot Scope

For the first controlled pilot, use one of these scopes.

### Assisted Pilot

Recommended for the current state.

- Vizitum team handles imports/setup.
- Field users can log in, create visits, record/upload voice notes, review location cards and own tasks, update task status and confirm manual reports after smoke recheck.
- Manager dashboard and drilldowns can be used for review, CSV export, task assignment, visit filtering and task status updates after smoke recheck.
- Operations page is internal only.
- Production ops gates remain outside the product UI and must be completed before production pilot.

### Self-Serve Pilot

Do not use this scope until the accepted P0 screen set completes a short internal dogfood cycle and the relevant operations gates are configured or explicitly accepted.

Required before self-serve:

- production-like field smoke test for visit creation, audio upload, location/task review and report confirmation;
- production-like import and admin users/setup/review smoke test before broad self-serve rollout;
- production-like manager smoke test for CSV export, task assignment, filters and status updates;
- production operations token verification after production services are created.

## Next Product Actions

1. Re-smoke pending/disabled submit states and Manager representative/assignee/date filters after the next deploy.
2. Continue loading/error copy polish on remaining Field, Admin import and Manager dashboard paths.
3. Repeat platform operations token and operations summary alert check for production after production services are created.
4. Repeat UX review against staging if any new product-surface changes are introduced before pilot.

## Action Plan Mapping

This review completes the planning artifact for: `Review the staging UX after smoke pass and list any pilot-blocking product issues`.

The original product UI blockers have been converted into implemented workflows. The remaining work is staging/production verification and external operations readiness.
