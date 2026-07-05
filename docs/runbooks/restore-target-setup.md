# Restore Target Setup

Use this runbook to create a safe staging/recovery PostgreSQL database from a paid PostgreSQL backup. This is the step required before running the restore drill.

Do not restore into production. Do not paste database URLs, passwords or provider tokens into docs, chat or screenshots.

## Goal

Create a separate restored database that can be used as:

- the `DATABASE_URL` for `npm run restore:drill:check`;
- the temporary database for a staging/recovery API service;
- proof that production data can be recovered without touching the live production database.

## Required Inputs

- PostgreSQL provider name;
- source database/resource id;
- backup id, snapshot id or restore timestamp;
- target database name, for example `vizitum-recovery-2026-07-04`;
- operator name;
- reviewer name, if available;
- confirmation that the target is not production.

## Step 1: Confirm Backup Evidence

In the PostgreSQL provider console, confirm:

- paid/managed plan is active;
- automated backups are enabled;
- a recent successful backup exists;
- retention is at least 7 days;
- restore/export workflow is available;
- backup alerts are configured or tracked as a launch follow-up.

Record non-secret evidence in `docs/runbooks/production-postgresql-evidence-2026-07-04.md`.

## Step 2: Create The Recovery Target

In the provider console:

1. Open the production PostgreSQL resource.
2. Open the backups, recovery or snapshots screen.
3. Select a recent backup or a point-in-time restore timestamp.
4. Choose restore to a new database/resource, not overwrite existing database.
5. Name the target clearly, for example `vizitum-recovery-2026-07-04`.
6. Keep the target in the same or nearest practical region.
7. Create separate credentials for the recovery database.
8. Wait until the restore status is complete/available.

If the provider only supports export/import:

1. Export the source backup through the provider workflow.
2. Create a new empty staging/recovery PostgreSQL database.
3. Import the export into that database through the provider workflow.
4. Confirm the import completed successfully.

## Step 3: Safety Checks Before Use

Before connecting the app or scripts:

- the target database name includes `recovery`, `restore` or `staging`;
- the target is a separate resource from production;
- production connection strings remain unchanged;
- production API and workers still point to production;
- recovery credentials are not shared with production services;
- object storage buckets are not changed by this database restore;
- screenshots hide usernames, passwords and full connection strings.

## Step 4: Store The Recovery URL Safely

Store the restored database URL only in a local ignored env file or provider secret store.

Recommended local file:

```text
.env.restore-drill.local
```

This file is ignored by `.gitignore` because `.env.*` files are ignored.

Example shape, with placeholder values only:

```sh
DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<database>?sslmode=require"
API_READINESS_URL="https://<staging-or-recovery-api>/api/health/readiness"
```

Do not commit this file and do not paste its contents into evidence records.

## Step 5: Verify Database Connectivity

From a secure shell, load the recovery `DATABASE_URL` and run:

```sh
npm run restore:drill:check
```

If a staging/recovery API is running against the restored database, also set `API_READINESS_URL` before running the same command.

The script intentionally does not print `DATABASE_URL`.

## Step 6: Point A Staging/Recovery API At The Target

For API-level verification, create or temporarily configure a staging/recovery API service with:

- restored recovery `DATABASE_URL`;
- staging/recovery Redis, not production Redis;
- staging/recovery R2 bucket or read-safe storage setup;
- `SENTRY_ENVIRONMENT=staging` or `recovery`;
- production demo fallback disabled;
- no production write traffic routed to this service.

Then verify:

```text
GET https://<staging-or-recovery-api>/api/health/readiness
```

Expected result:

```json
{
  "status": "ready",
  "checks": {
    "database": {
      "status": "ok"
    },
    "criticalEnvironment": {
      "status": "ok",
      "missing": []
    }
  }
}
```

## Step 7: Complete The Drill Record

Fill `docs/runbooks/restore-drill-2026-07-04-production-pilot.md` with:

- backup id or restore timestamp;
- restored database name/id;
- confirmation that target is staging/recovery;
- command results;
- manual data-read checks;
- cleanup worker result;
- findings and reviewer sign-off.

## Provider Notes

### Render PostgreSQL

Use the database Recovery/Backups area. Restore into a new database when available. If the UI only allows restore over the same instance for the selected plan, do not proceed against production; use an export/import or create a temporary recovery database through provider support/workflow.

### Neon

Use branch or point-in-time restore into a separate branch/database. Use the branch connection string only for the restore drill.

### Supabase

Use a new project or restore workflow that creates a separate database target. Do not restore over the production project for a drill.

### Railway

Use backups/snapshots to restore into a separate service/database where supported. Keep production service variables unchanged.

## Done Criteria

- Recovery database exists as a separate non-production target.
- Restore source backup id/timestamp is recorded.
- Recovery `DATABASE_URL` is stored only in ignored local env/provider secrets.
- `npm run restore:drill:check` can run against the recovery database.
- Staging/recovery API readiness can be checked if an API service is attached.
- Production services remain untouched.
