# Production PostgreSQL Evidence - 2026-07-04

Use this record for the paid PostgreSQL setup that unblocks the final production-pilot gate. Keep secrets out of this file: no connection strings, passwords, raw database URLs or provider tokens.

## Resource Metadata

- Evidence id: production-postgresql-evidence-2026-07-04
- Environment: production-pilot preparation
- Provider:
- Database/resource name or id:
- Region:
- Plan/tier:
- Operator: Ihor Kiyanych
- Reviewer:
- Related launch record: `docs/runbooks/production-launch-readiness-record.md`

## Required Evidence

| Evidence item | Status | Link/Notes |
| --- | --- | --- |
| Paid/managed PostgreSQL plan is active | Pending |  |
| Automated backups are enabled | Pending |  |
| Latest successful backup is visible | Pending |  |
| Backup retention is at least 7 days | Pending |  |
| Export or restore workflow is available | Pending |  |
| Point-in-time recovery status is known | Pending |  |
| Backup failure or stale-backup alert exists | Pending |  |
| Database availability/connectivity alert exists | Pending |  |
| Storage or quota pressure alert exists | Pending |  |
| Connection pressure alert exists, where provider supports it | Pending |  |

## Backup Policy

- Backup cadence:
- Retention period:
- PITR support:
- Manual snapshot support:
- Export support:
- Restore target options:
- Pre-migration snapshot process:

## Restore Path

- Can restore into staging/recovery without touching production:
- Expected restore time:
- Restore creates a separate database/resource:
- Restore requires support ticket or self-service:
- Recovery database credentials can be scoped separately:

## Alert Routing

- Primary alert recipient/channel:
- Secondary alert recipient/channel:
- Owner who acknowledges database alerts:
- Owner who can approve a production restore:

## Evidence Attachments

Add provider links, issue links or screenshot filenames here. Redact secrets before attaching.

- Paid plan:
- Backup policy:
- Latest backup:
- Retention:
- Restore/export path:
- Alert rules:

## Result

- [ ] Passed: backup and restore evidence is sufficient for production pilot.
- [ ] Passed with follow-up: pilot can continue, but follow-up is tracked below.
- [ ] Failed: production pilot remains blocked on PostgreSQL evidence.

## Findings

- Issues found:
- Severity:
- Owner:
- Follow-up action:
- Target fix date:

Reviewer sign-off:
