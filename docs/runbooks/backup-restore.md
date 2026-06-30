# Backup and Restore Runbook

This runbook covers the MVP shared PostgreSQL database. Restore operations can affect all tenants, so production restore requires explicit operational approval.

## Scope

- Database: managed PostgreSQL used by the API and workers.
- Backup source: managed provider automated backups and point-in-time recovery when available.
- Object storage: Cloudflare R2/S3-compatible objects are not restored through this database runbook.

## Backup Policy

- Keep automated daily backups enabled.
- Retain at least 7 days for MVP, with 14 days preferred.
- Use point-in-time recovery when the provider supports it.
- Create a manual pre-migration snapshot before risky schema/data migrations.
- Never store database dumps in public buckets or local unencrypted shared folders.

## Production Restore Approval

Before restoring production data, record:

- incident/request id;
- requesting person;
- approving person;
- target restore timestamp or backup id;
- affected environment;
- expected tenant impact;
- rollback decision owner.

Do not restore the shared production database without approval from the operational owner and confirmation that affected tenant stakeholders have been notified where needed.

## Staging Restore Drill

Run before the production pilot and after major backup-provider changes.

1. Choose a recent production-like backup or snapshot.
2. Restore it into a staging or recovery database, not into production.
3. Set staging `DATABASE_URL` to the restored database.
4. Start the API against staging.
5. Run:

```sh
npm run prisma:validate
npm run build
npm test
```

6. Verify the app can read:

- tenant registry;
- active users and roles;
- locations and contacts;
- visits and confirmed reports;
- tasks;
- import job metadata;
- AI job metadata without raw temporary transcript/audio payloads.

7. Verify sensitive temporary storage lifecycle still works:

- expired temporary storage objects are marked for cleanup;
- confirmed reports remain available;
- raw audio/transcripts are not required for normal report viewing.

8. Record the drill date, backup timestamp, result and issues found.

## Emergency Production Restore

1. Stop write traffic if the incident requires avoiding further corruption.
2. Capture current incident context and approval record.
3. Create a final snapshot of the current production database before restore when the provider supports it.
4. Restore the selected backup to a recovery database first.
5. Verify data in the recovery database using read-only checks.
6. Decide between:
   - promoting the recovery database;
   - targeted manual data repair;
   - full production restore.
7. Update service `DATABASE_URL` only after approval.
8. Start API and workers.
9. Verify health endpoint, login, tenant lookup and key read flows.
10. Watch JSON logs, Sentry and provider metrics for errors.
11. Document the final restore timestamp and any tenant-facing impact.

## Post-Restore Checks

- API health returns healthy.
- Login works for a known admin test account.
- Tenant isolation checks pass.
- Imports cannot partially apply invalid rows.
- Manual report confirmation still works.
- AI failed-job cleanup does not reference missing temporary objects.
- Storage cleanup failures are visible in logs.

## Rollback

If the restore causes unexpected data loss or app startup failure:

1. Stop write traffic.
2. Repoint the app to the pre-restore snapshot or previous database if available.
3. Keep the failed recovery database for investigation.
4. Record the rollback decision and next action owner.
