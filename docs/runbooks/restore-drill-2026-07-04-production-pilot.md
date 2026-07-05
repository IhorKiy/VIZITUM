# Restore Drill Record - 2026-07-04 Production Pilot

Use this record for the first restore drill after paid PostgreSQL became available. Keep completed evidence here or linked from here. Do not paste production secrets, database URLs, passwords or provider tokens.

## Drill Metadata

- Drill id: restore-drill-2026-07-04-production-pilot
- Date/time started:
- Date/time completed:
- Environment: staging/recovery
- Database provider:
- Backup id or restore timestamp:
- Restored database name/id:
- Operator: Ihor Kiyanych
- Reviewer:
- Related release or incident: final production-pilot gate
- Related PostgreSQL evidence: `docs/runbooks/production-postgresql-evidence-2026-07-04.md`
- Restore target setup: `docs/runbooks/restore-target-setup.md`

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
| `npm run restore:drill:check` | Pending |  |
| `npm run prisma:validate` | Pending |  |
| `npm run prisma:generate` | Pending |  |
| `npm run build` | Pending |  |
| `npm test` | Pending |  |
| `npm run lint` | Pending |  |
| `npm run web:typecheck` | Pending |  |
| `npm run web:build` | Pending |  |
| `npm run format:check` | Pending |  |
| `npm run worker:cleanup:prod` or staging equivalent | Pending |  |
| API `/api/health/readiness` returns healthy | Pending |  |

## Data Read Checks

| Data area | Result | Evidence |
| --- | --- | --- |
| Tenant registry is readable | Pending |  |
| Active users and roles are readable | Pending |  |
| Locations and contacts are readable | Pending |  |
| Visits and confirmed reports are readable | Pending |  |
| Tasks are readable | Pending |  |
| Import job metadata is readable | Pending |  |
| AI job metadata is readable without raw temporary transcript/audio payloads | Pending |  |

## Temporary Data Lifecycle Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Expired temporary storage objects are visible for cleanup | Pending |  |
| Confirmed reports do not require raw audio/transcripts | Pending |  |
| Failed AI cleanup can run without missing-object crashes | Pending |  |
| Storage cleanup failures would be visible in logs | Pending |  |

## Observability Checks

| Check | Result | Evidence |
| --- | --- | --- |
| JSON logs include `requestId` for API requests | Pending |  |
| Job logs include `jobId` where applicable | Pending |  |
| Sentry environment/release is configured for staging/recovery | Pending |  |
| Health monitor target is known | Pending |  |

## Commands To Run

Run the core drill check with the restored staging/recovery database URL from a secure shell:

```sh
DATABASE_URL="<restored-staging-or-recovery-database-url>" \
API_READINESS_URL="https://<staging-or-recovery-api>/api/health/readiness" \
npm run restore:drill:check
```

Run cleanup verification only against the restored staging/recovery environment:

```sh
npm run worker:cleanup:prod
```

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
