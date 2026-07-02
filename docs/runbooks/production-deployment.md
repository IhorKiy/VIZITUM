# Production Deployment Runbook

This runbook defines the minimum production deployment setup for the Team Pilot. It is provider-neutral, with Render-compatible commands because the current MVP deployment decision prefers Render for API and worker services.

## Services

Deploy these services from the same repository and release SHA.

| Service | Type | Build Command | Start Command | Required Health/Alert |
| --- | --- | --- | --- | --- |
| Web | Next.js frontend | `npm ci && npm run web:build` | `npm run web:start` | Frontend Sentry project and route smoke check |
| API | Web service | `npm ci && npm run prisma:generate && npm run build` | `npm start` | `GET /api/health/readiness` |
| Cleanup worker | Scheduled job / cron worker | `npm ci && npm run prisma:generate && npm run build` | `npm run worker:cleanup:prod` | Non-zero exit alert and `worker_cleanup_completed` log |

The cleanup worker is intentionally a one-shot task. Schedule it at least hourly for the pilot unless provider limits or storage policy require a shorter interval.

## Required Environment

Configure these variables for API and worker services unless marked otherwise.

| Variable | API | Worker | Web | Notes |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | yes | yes | no | Managed PostgreSQL connection string |
| `REDIS_URL` | yes | yes | no | Required when queue workers are enabled |
| `SESSION_SECRET` | yes | no | no | Must be long and random |
| `SESSION_COOKIE_NAME` | yes | no | no | Defaults can match `.env.example` |
| `OPENAI_API_KEY` | yes | yes | no | Required for AI jobs |
| `S3_ENDPOINT` | yes | yes | no | R2/S3-compatible endpoint |
| `S3_REGION` | yes | yes | no | Use `auto` for Cloudflare R2 |
| `S3_BUCKET` | yes | yes | no | Production bucket |
| `S3_ACCESS_KEY_ID` | yes | yes | no | Secret |
| `S3_SECRET_ACCESS_KEY` | yes | yes | no | Secret |
| `S3_FORCE_PATH_STYLE` | yes | yes | no | Usually `true` for R2 |
| `APP_BASE_URL` | yes | no | yes | Public web origin |
| `API_BASE_URL` | yes | no | yes | Public API origin; frontend uses `/api` base where configured |
| `ENABLE_DEMO_FALLBACK` | no | no | optional | Leave unset or `false` in production so API/auth failures do not show demo data |
| `PLATFORM_OPERATIONS_TOKEN_SHA256` | yes | no | no | Preferred hash for machine access to `/api/operations/summary` |
| `PLATFORM_OPERATIONS_TOKEN` | optional | no | no | Plaintext fallback for staging only when hash-based setup is not available |
| `SENTRY_DSN` | yes | yes | yes | Separate projects or environment tags are preferred |
| `SENTRY_ENVIRONMENT` | yes | yes | yes | `production` |
| `SENTRY_RELEASE` | yes | yes | yes | Git SHA or release version |

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

## Deploy Steps

1. Confirm the release SHA and changelog.
2. Confirm managed PostgreSQL backups are enabled.
3. Confirm production alert rules are enabled or the pilot owner has accepted the temporary gap.
4. Deploy API with the release SHA.
5. Verify `GET /api/health/readiness` returns ready.
6. Deploy web with the same release SHA.
7. Trigger or wait for one cleanup worker run.
8. Verify logs contain `worker_cleanup_completed`.
9. Verify Sentry release/environment tags appear for API, worker and web.
10. Record deployment timestamp, release SHA, operator and verification notes.

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
