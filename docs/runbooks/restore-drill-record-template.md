# Restore Drill Record Template

Use this template for each staging or recovery restore drill before the production pilot and after major backup-provider changes. Keep completed records with the incident or release evidence.

## Drill Metadata

- Drill id:
- Date/time started:
- Date/time completed:
- Environment:
- Database provider:
- Backup id or restore timestamp:
- Restored database name/id:
- Operator:
- Reviewer:
- Related release or incident:

## Approval and Safety

- [ ] Restore target is staging/recovery, not production.
- [ ] Production write traffic is not affected.
- [ ] Restored database credentials are scoped to staging/recovery.
- [ ] Object storage is not overwritten by this drill.
- [ ] Sensitive data handling requirements are confirmed.

## Setup Evidence

- `DATABASE_URL` points to the restored staging/recovery database:
- API service started against restored database:
- Worker service started against restored database:
- Relevant release/git SHA:

## Command Checks

Record pass/fail and a short note for each command.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run restore:drill:check` |  |  |
| `npm run prisma:validate` |  |  |
| `npm run build` |  |  |
| `npm test` |  |  |
| `npm run lint` |  |  |
| `npm run web:typecheck` |  |  |
| `npm run web:build` |  |  |
| `npm run format:check` |  |  |
| API `/api/health` returns healthy |  |  |

## Data Read Checks

| Data area | Result | Evidence |
| --- | --- | --- |
| Tenant registry is readable |  |  |
| Active users and roles are readable |  |  |
| Locations and contacts are readable |  |  |
| Visits and confirmed reports are readable |  |  |
| Tasks are readable |  |  |
| Import job metadata is readable |  |  |
| AI job metadata is readable without raw temporary transcript/audio payloads |  |  |

## Temporary Data Lifecycle Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Expired temporary storage objects are visible for cleanup |  |  |
| Confirmed reports do not require raw audio/transcripts |  |  |
| Failed AI cleanup can run without missing-object crashes |  |  |
| Storage cleanup failures would be visible in logs |  |  |

## Observability Checks

| Check | Result | Evidence |
| --- | --- | --- |
| JSON logs include `requestId` for API requests |  |  |
| Job logs include `jobId` where applicable |  |  |
| Sentry environment/release is configured for staging/recovery |  |  |
| Health monitor target is known |  |  |

## Findings

- Issues found:
- Severity:
- Owner:
- Follow-up action:
- Target fix date:

## Result

- [ ] Passed with no follow-up.
- [ ] Passed with follow-up.
- [ ] Failed and must be repeated.

Reviewer sign-off:
