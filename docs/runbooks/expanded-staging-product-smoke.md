# Expanded Staging Product Smoke

Use this checklist after the latest self-serve Field, Admin imports and Manager changes are deployed to staging.

Do not paste secrets into this record. Use provider links, screenshots, object ids, request ids or short command output snippets as evidence.

## Smoke Metadata

- Date:
- Operator:
- Environment: staging
- Tenant slug: `vizitum-staging`
- Web URL: `https://vizitum-web.vercel.app`
- API URL: `https://vizitum-api-staging.onrender.com`
- Release SHA:
- Browser/device:

## Preconditions

- Staging API readiness returns `status=ready`.
- Staging web deploy is on the target release SHA.
- Test user can log in to tenant `vizitum-staging`.
- Tenant has at least one active location.
- Tenant has at least one manager or representative user for task assignment.
- Use non-production test data only.

## Smoke Checklist

| Area                          | Step                                                                                         | Expected Result                                                                                | Evidence                      | Status |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------- | ------ |
| Login                         | Open staging web and log in to `vizitum-staging`.                                            | User reaches tenant app shell without demo fallback.                                           |                               |        |
| Tenant lookup                 | Navigate between Field, Imports, Manager and Operations routes.                              | Tenant-aware routes load with the same tenant slug.                                            |                               |        |
| Field visit creation          | On Field page, use `New visit`, choose an active location and start a visit.                 | Success notice appears and the visit appears in the Field visit list after refresh/navigation. | Visit id:                     |        |
| Field text note               | Add a text note to the newly created or existing open visit.                                 | Success notice appears and API accepts the note.                                               | Note id/request id:           |        |
| Field browser voice recording | Use `Record`, allow microphone access, stop recording, then upload the generated voice note. | Audio preview appears before upload; success notice appears after upload.                      | Storage object id/request id: |        |
| Field audio fallback          | Upload a small supported audio file through the same voice note control.                     | Success notice appears after upload.                                                           | Storage object id/request id: |        |
| Field manual report           | Confirm a manual report with summary and optional next steps.                                | Success notice appears; visit is marked completed.                                             | Report id:                    |        |
| Admin import template         | Open Admin imports and download a template.                                                  | CSV template downloads from backend URL.                                                       | Template type:                |        |
| Admin import validation       | Upload a small CSV using an approved template.                                               | Validation result shows status, row counts and row-level issues when present.                  | Import job id:                |        |
| Admin import confirm          | Confirm a valid import job.                                                                  | Success notice appears with applied row count.                                                 | Import job id:                |        |
| Manager dashboard             | Open Manager dashboard.                                                                      | Live metrics, representatives and attention queue render without demo fallback.                |                               |        |
| Manager CSV export            | Click `Export`.                                                                              | `vizitum-manager-dashboard.csv` downloads and includes metrics/representatives/attention rows. |                               |        |
| Manager task assignment       | Create a manager task with title, priority, optional assignee/location and due date.         | Success notice appears and task appears in task metrics or queue after refresh/navigation.     | Task id/request id:           |        |
| Operations page               | Open Operations route as the intended operator.                                              | Page renders; if token is not configured, record the expected connection-required state.       |                               |        |

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
- [ ] Passed with follow-up.
- [ ] Failed and must be repeated.

## Follow-Up Items

| Item | Owner | Severity | Target Date | Notes |
| ---- | ----- | -------- | ----------- | ----- |
|      |       |          |             |       |

## Sign-Off

- Operator:
- Reviewer:
- Decision:
- Timestamp:
