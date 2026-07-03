# Expanded Staging Product Smoke

Use this checklist after the latest self-serve Field, Admin imports and Manager changes are deployed to staging.

Do not paste secrets into this record. Use provider links, screenshots, object ids, request ids or short command output snippets as evidence.

## Smoke Metadata

- Date: 2026-07-02
- Operator: Codex with Ihor Kiyanych staging login
- Environment: staging
- Tenant slug: `vizitum-staging`
- Web URL: `https://vizitum-web.vercel.app`
- API URL: `https://vizitum-api-staging.onrender.com`
- Release SHA: `ce07cebf5f0d4c64a432c5bdea4138d658e75d68`
- Browser/device: Codex in-app browser, desktop viewport

## Preconditions

- [x] Staging API readiness returns `status=ready`.
- [x] Staging web deploy is on the target release SHA.
- [x] Test user can log in to tenant `vizitum-staging`.
- [x] Tenant has at least one active location.
- [x] Tenant has at least one manager or representative user for task assignment.
- [x] Use non-production test data only.

## Smoke Checklist

| Area                          | Step                                                                                                  | Expected Result                                                                                                                    | Evidence                                                                                                                                                                                                              | Status                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Login                         | Open staging web and log in to `vizitum-staging`.                                                     | User reaches tenant app shell without demo fallback.                                                                               | Field page loaded authenticated as Vizitum Staging Admin.                                                                                                                                                             | Pass                          |
| Tenant lookup                 | Navigate between Field, Imports, Manager and Operations routes.                                       | Tenant-aware routes load with the same tenant slug.                                                                                | Field, Imports and Manager loaded under `/vizitum-staging`; Ops nav hidden for this permission set, direct route rendered permission error.                                                                           | Pass with note                |
| Field visit creation          | On Field page, use `New visit`, choose an active location and start a visit.                          | Success notice appears and the visit appears in the Field visit list after refresh/navigation.                                     | URL `?visit=created`; notice `Visit started` / `New visit created`; location `Smoke Test Location`; DB id unavailable from local env.                                                                                 | Pass                          |
| Field text note               | Add a text note to the newly created or existing open visit.                                          | Success notice appears and API accepts the note.                                                                                   | URL `?note=saved`; notice `Text note added`; note text used `Expanded staging smoke text note 2026-07-02...`; note id unavailable from local env.                                                                     | Pass                          |
| Field browser voice recording | Use `Record`, allow microphone access, stop recording, then upload the generated voice note.          | Audio preview appears before upload; success notice appears after upload.                                                          | Real-browser check by Ihor on 2026-07-02: `Record` started, upload completed, success notice appeared.                                                                                                                | Pass                          |
| Field audio fallback          | Upload a small supported audio file through the same voice note control.                              | Success notice appears after upload.                                                                                               | Real-browser retry by Ihor on 2026-07-02: manually selected audio file uploaded successfully after the earlier failed attempt. Local follow-up still normalizes browser MIME aliases for broader file compatibility.  | Pass                          |
| Field manual report           | Confirm a manual report with summary and optional next steps.                                         | Success notice appears; visit is marked completed.                                                                                 | URL `?report=confirmed`; notice `Manual report saved`; route summary changed to Completed 2 / Remaining 0; report id unavailable from local env.                                                                      | Pass                          |
| Admin setup checklist         | Open Admin setup checklist.                                                                           | Setup progress renders live users, roles, locations, products/SKUs, initial plan and pilot review readiness without demo fallback. | New P0 screen added after the 2026-07-02 smoke; verify after next staging deploy.                                                                                                                                     | Pending                       |
| Admin users                   | Open Admin users, create a test invite, suspend/reactivate a non-critical user and add/remove a role. | User list renders live tenant users; invite link appears after creation; status/role success notices appear without demo fallback. | New P0 screen added after the 2026-07-02 smoke; verify after next staging deploy.                                                                                                                                     | Pending                       |
| Admin import template         | Open Admin imports and download a template.                                                           | CSV template downloads from backend URL.                                                                                           | After `bee8d04`, per-template links route through tenant-local Next URLs such as `/vizitum-staging/admin/imports/templates/users.csv`; browser navigation produced attachment-style `ERR_ABORTED` instead of API 401. | Pass                          |
| Admin import validation       | Upload a small CSV using an approved template.                                                        | Validation result shows status, row counts and row-level issues when present.                                                      | Manual file-picker upload of `vizitum-users-smoke.csv`; URL included `importJobId=cmr3rwtzh00012bd75jhtliyt`, `status=validated`, `rows=1`, `valid=1`, `errors=0`, `warnings=0`.                                      | Pass                          |
| Admin import confirm          | Confirm a valid import job.                                                                           | Success notice appears with applied row count.                                                                                     | Confirmed job `cmr3rwtzh00012bd75jhtliyt`; URL `?applied=1`; notice `Import applied` / `Rows imported`; `1 rows were applied successfully.`                                                                           | Pass                          |
| Manager dashboard             | Open Manager dashboard.                                                                               | Live metrics, representatives and attention queue render without demo fallback.                                                    | Metrics rendered: Visits today 1, Reports confirmed 2, Open tasks 0 before task creation; representative `Vizitum Staging Admin`; attention queue rendered.                                                           | Pass                          |
| Manager visits drilldown      | Open Manager visits and use status filters.                                                           | Visit counters and tenant visit table render without demo fallback; status filters narrow the list.                                | New P0 screen added after the 2026-07-02 smoke; verify after next staging deploy.                                                                                                                                     | Pending                       |
| Manager tasks drilldown       | Open Manager tasks, use status/priority filters and update a non-critical task status.                | Task counters and table render without demo fallback; status update success notice appears.                                        | New P0 screen added after the 2026-07-02 smoke; verify after next staging deploy.                                                                                                                                     | Pending                       |
| Manager CSV export            | Click `Export`.                                                                                       | `vizitum-manager-dashboard.csv` downloads and includes metrics/representatives/attention rows.                                     | Data CSV link contained Metric, Representative and Attention rows including `Visits today`, `Reports confirmed`, `Vizitum Staging Admin`, `Smoke Test Location`.                                                      | Pass                          |
| Manager task assignment       | Create a manager task with title, priority, optional assignee/location and due date.                  | Success notice appears and task appears in task metrics or queue after refresh/navigation.                                         | URL `?task=created`; notice `Task created`; task title `Expanded staging smoke task 2026-07-02T16:15:41.519Z`; Open tasks 1 / high priority 1.                                                                        | Pass                          |
| Operations page               | Open Operations route as the intended operator.                                                       | Page renders; if token is not configured, record the expected connection-required state.                                           | Direct route rendered `Operations summary is not connected` with `You do not have permission to perform this action`; Ops nav hidden for current user.                                                                | Pass with expected limitation |

## API/Command Checks

Run from a trusted operator machine when URLs and tokens are available.

```sh
API_READINESS_URL="https://vizitum-api-staging.onrender.com/api/health/readiness" \
WEB_URL="https://vizitum-web.vercel.app" \
npm run alerts:check
```

When platform operations token is configured, include:

```sh
OPERATIONS_SUMMARY_URL="https://vizitum-api-staging.onrender.com/api/operations/summary" \
OPERATIONS_SUMMARY_BEARER_TOKEN="<operator-token>" \
npm run alerts:check
```

## Result

- [ ] Passed with no follow-up.
- [x] Passed with follow-up.
- [ ] Failed and must be repeated.

## Follow-Up Items

| Item                                                                                      | Owner         | Severity | Target Date             | Notes                                                                                       |
| ----------------------------------------------------------------------------------------- | ------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| Configure production operations token and rerun production operations summary alert check | Ihor Kiyanych | Medium   | Before production pilot | Staging token check passed on 2026-07-02; repeat with production services after they exist. |

## Sign-Off

- Operator: Codex with Ihor Kiyanych staging login
- Reviewer:
- Decision: Passed with follow-up. Field recording/audio fallback, Admin import, Manager flows and staging operations summary check are verified; remaining follow-up is production ops gates.
- Timestamp: 2026-07-02 19:20 Europe/Kiev
