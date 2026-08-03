# Production Deployment Runbook

This runbook defines the minimum production deployment setup for the Team Pilot. It is provider-neutral, with Render-compatible commands because the current MVP deployment decision prefers Render for API and worker services.

## Services

Deploy these services from the same repository and release SHA.

| Service        | Type                        | Build Command                                                      | Pre-Deploy Command              | Start Command                 | Required Health/Alert                                  |
| -------------- | --------------------------- | ------------------------------------------------------------------ | ------------------------------- | ----------------------------- | ------------------------------------------------------ |
| Web            | Next.js frontend            | `npm ci --include=dev && npm run web:build`                        | —                               | `npm run web:start`           | Frontend Sentry project and route smoke check          |
| API            | Web service                 | `npm ci --include=dev && npm run prisma:generate && npm run build` | `npm run prisma:migrate:deploy` | `npm start`                   | `GET /api/health/readiness`                            |
| Cleanup worker | Scheduled job / cron worker | `npm ci --include=dev && npm run prisma:generate && npm run build` | —                               | `npm run worker:cleanup:prod` | Non-zero exit alert and `worker_cleanup_completed` log |
| Purge worker   | Scheduled job / cron worker | `npm ci --include=dev && npm run prisma:generate && npm run build` | —                               | `npm run worker:purge:prod`   | Non-zero exit alert and `worker_purge_completed` log   |

### `--include=dev` is load-bearing, because `NODE_ENV=production` reaches the build

Every build command above installs dev dependencies explicitly. That is not
belt-and-braces: `NODE_ENV` set on a Render service applies to the **build**
as well as the runtime, and npm reads it — `NODE_ENV=production` turns on
`omit=dev`, so `npm ci` installs only the runtime dependencies. Confirm it
anywhere:

```sh
NODE_ENV=production npm config get omit   # -> dev
```

`typescript` and every `@types/*` package are dev dependencies, so the install
succeeds and the very next step fails on something that reads like a code
problem rather than a configuration one:

```
src/modules/visits/visits.controller.ts(14,30): error TS7016: Could not find a
declaration file for module 'express'. Try `npm i --save-dev @types/express`
==> Build failed
```

This happened on 2026-08-02, on the deploy that first set `NODE_ENV=production`
on the API. Nothing about the message points at the variable that caused it,
and the suggested fix — install `@types/express` — is wrong: it is already a
dev dependency, and moving it to `dependencies` would ship type packages to
production to work around a flag.

Prefer `--include=dev` over `NPM_CONFIG_PRODUCTION=false`: both work, but the
flag says what it does at the point it does it, and does not depend on how a
given npm version reads a config npm has already changed twice.

**Set `NODE_ENV=production` anyway** — it is what gives the session and CSRF
cookies their `Secure` flag (`src/modules/auth/auth.constants.ts`) and what
arms the bootstrap gate in `src/modules/auth/security-config.ts`. Without it
both degrade silently, which is the failure mode that gate exists to refuse.
Set the variables the gate requires **before** the first build that succeeds
with it, or the deploy simply fails one step later, at boot instead of at
compile.

Migrations belong to the API service's pre-deploy command and nowhere else: it is the one service that deploys first and exactly once per release, so the schema is already current when the web app and the workers start on the same SHA. Do not add `migrate deploy` to a build command (builds run per service and can run without deploying) or to a worker (cron services run on their own schedule, so a migration could land hours after the code that needs it — or race a second worker run).

A pre-deploy command that fails aborts the deploy and leaves the previous release serving, which is the desired outcome: a release whose migrations did not apply must not reach production. The reverse — code that ships ahead of its migration — is the failure this column exists to prevent, and it does not surface as a failed deploy. It surfaces later, as a runtime error on whichever path first touches the new schema, typically a cron worker emailing `worker_task_failed` every run.

Render locks the pre-deploy field on free instance types (the field is visible under Settings → Deploy with a padlock). Until the API is on a paid instance, fold the migration into the start command instead:

```sh
npm run prisma:migrate:deploy && npm start
```

This keeps the schema ahead of the code, at three costs worth knowing. A failed migration leaves the service down rather than aborting the deploy and leaving the previous release serving. It runs on every container start rather than once per release, which on a free instance means every wake from sleep — harmless, since an up-to-date database makes it a sub-second no-op. And it would race across instances if the service ever scaled past one, which a free instance cannot. Move back to the pre-deploy command as soon as the instance is upgraded, and restore the plain `npm start`.

The cleanup worker is intentionally a one-shot task. Schedule it at least hourly for the pilot unless provider limits or storage policy require a shorter interval.

The purge worker is the destructive half of tenant lifecycle: it auto-archives stale `pilot` tenants (only when `TENANT_PILOT_AUTO_ARCHIVE_DAYS` is set — unset means disabled) and **permanently deletes** archived tenants once `TENANT_PURGE_RETENTION_DAYS` (default 30) has elapsed since archiving, or immediately after an explicit purge request from the platform console. Daily scheduling is enough. It deletes R2 storage objects before database rows, is crash-safe/re-runnable (an interrupted purge resumes on the next run; a partially-purged tenant can never be unarchived), and refuses to run on misconfigured env values instead of assuming defaults. Every purge leaves a `tenant.purge_started`/`tenant.purged` trail in `platform_operation_events` with per-table row counts.

There is no longer a provision worker: platform tenants are created directly with `status: "pilot"` (no `draft`/`provisioning` hold), so nothing needs to advance them. If a `worker:provision` cron is still scheduled with your provider from a previous deploy, disable it — the `worker:provision`/`worker:provision:prod` npm scripts and the underlying `ProvisioningService` were removed.

## Required Environment

Configure these variables for API and worker services unless marked otherwise.

| Variable                           | API      | Worker | Web      | Notes                                                                           |
| ---------------------------------- | -------- | ------ | -------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                     | yes      | yes    | no       | Managed PostgreSQL connection string                                            |
| `REDIS_URL`                        | yes      | yes    | no       | Required when queue workers are enabled                                         |
| `SESSION_SECRET`                   | yes      | no     | no       | Must be long and random                                                         |
| `COOKIE_SECURE`                    | yes      | no     | no       | Must be the literal `true`; the service refuses to start in production without it |
| `SESSION_COOKIE_NAME`              | no       | no     | no       | Dev-only override for worktree slots. Production always uses the hardcoded `__Host-vizitum_session` name regardless of this variable |
| `OPENAI_API_KEY`                   | yes      | yes    | no       | Required for AI jobs                                                            |
| `S3_ENDPOINT`                      | yes      | yes    | no       | R2/S3-compatible endpoint                                                       |
| `S3_REGION`                        | yes      | yes    | no       | Use `auto` for Cloudflare R2                                                    |
| `S3_BUCKET`                        | yes      | yes    | no       | Production bucket                                                               |
| `S3_ACCESS_KEY_ID`                 | yes      | yes    | no       | Secret                                                                          |
| `S3_SECRET_ACCESS_KEY`             | yes      | yes    | no       | Secret                                                                          |
| `S3_FORCE_PATH_STYLE`              | yes      | yes    | no       | Usually `true` for R2                                                           |
| `APP_BASE_URL`                     | yes      | no     | yes      | Public web origin                                                               |
| `API_BASE_URL`                     | yes      | no     | yes      | Public API origin; frontend uses `/api` base where configured                   |
| `ENABLE_DEMO_FALLBACK`             | no       | no     | optional | Leave unset or `false` in production so API/auth failures do not show demo data |
| `PLATFORM_OPERATIONS_TOKEN_SHA256` | yes      | no     | no       | Preferred hash for machine access to `/api/operations/summary`                  |
| `PLATFORM_OPERATIONS_TOKEN`        | optional | no     | no       | Plaintext fallback for staging only when hash-based setup is not available      |
| `SENTRY_DSN`                       | yes      | yes    | yes      | Separate projects or environment tags are preferred                             |
| `SENTRY_ENVIRONMENT`               | yes      | yes    | yes      | `production`                                                                    |
| `SENTRY_RELEASE`                   | yes      | yes    | yes      | Git SHA or release version                                                      |

Do not place raw audio, transcripts, notes or report free text in environment variables, logs or deploy metadata.

## Pre-Deploy Checks

Run before promoting a release:

```sh
npm ci
npm run prisma:validate
npm run format:check
npm run lint
npm run build
npm test
npm run web:typecheck
npm run web:build
```

If the release includes database changes, apply Prisma migrations through the approved deploy process only after a backup/snapshot exists.

Confirm what production is actually running before promoting — the answer decides whether step 2's snapshot is a formality or the thing that saves you:

```sh
DATABASE_URL="<production-url>" npx prisma migrate status
```

## Deploy Steps

1. Confirm the release SHA and changelog.
2. Confirm managed PostgreSQL backups are enabled.
3. Confirm production alert rules are enabled or the pilot owner has accepted the temporary gap.
4. Deploy API with the release SHA. Its pre-deploy command applies pending migrations; confirm they applied before the new instance took traffic, and stop here if the deploy aborted.
5. Verify `GET /api/health/readiness` returns ready.
6. Deploy web with the same release SHA.
7. Trigger or wait for one cleanup worker run.
8. Verify logs contain `worker_cleanup_completed`.
9. On first deploy, seed the platform owner (`npm run seed:platform-owner` with `PLATFORM_OWNER_EMAIL`/`PLATFORM_OWNER_PASSWORD`) and confirm `/platform/login` grants access to the tenant console. Confirm a newly created tenant is immediately `pilot` — no provision worker to schedule.
10. Verify Sentry release/environment tags appear for API, worker and web.
11. Record deployment timestamp, release SHA, operator and verification notes.

Use `docs/runbooks/production-ops-setup-guide.md` for first-time provider setup, `docs/runbooks/production-env-checklist.md` for production env var preparation and `docs/runbooks/production-launch-readiness-record.md` to collect final pilot-launch evidence across deploy, alerts, restore drill and smoke checks.

## Post-Deploy Smoke Checks

- Login works for a known admin test account.
- Tenant slug lookup works.
- Field page can load with authenticated session.
- Admin imports page can list templates.
- Manager dashboard can read live route, visit and task metrics.
- Manual report confirmation still works if AI is unavailable.
- Cleanup worker exits successfully or alerts clearly on failure.

## Rollback

Rollback is required when core pilot flows are blocked, readiness fails after deployment, database migrations are unsafe, or cleanup worker failures risk temporary data retention.

1. Pause new deploys.
2. Capture release SHA, failing check, request IDs and relevant logs.
3. Roll back web/API to the previous known-good release.
4. Keep the database at the migrated version unless a restore/repair decision is explicitly approved.
5. Re-run readiness and smoke checks.
6. Record the incident and follow-up owner.
