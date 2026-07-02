# Production Launch Readiness Record

Use this record before starting a production pilot. It collects evidence from deployment, alerts, restore drill, smoke checks and known launch risks.

## Launch Metadata

- Launch id: staging-ops-readiness-2026-07-01
- Target launch date:
- Release SHA:
- Environment: staging
- Operator: Ihor Kiyanych
- Reviewer:
- Business owner:
- Pilot tenant(s):

## Required Evidence

| Area               | Required Evidence                                                                                                | Status                 | Link/Notes                                                                                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI                 | Latest `main` checks pass                                                                                        | Pending                | Not verified during staging ops setup. Local `npm run build` and `npm test` passed while preparing Render fixes.                                                                                                                                    |
| Deployment         | `docs/runbooks/production-deployment.md` completed                                                               | Staging pass           | Render staging API deployed, Vercel staging web deployed, Render cleanup cron deployed. Production deployment not created yet.                                                                                                                      |
| API readiness      | `/api/health/readiness` returns ready                                                                            | Pass                   | `https://vizitum-api-staging.onrender.com/api/health/readiness` returned `status=ready`, `database=ok`, and no missing critical environment variables.                                                                                              |
| Alerts             | `docs/runbooks/production-alerts.md` readiness verification and `npm run alerts:check` completed                 | Staging pass           | UptimeRobot readiness monitor created with status Up. 2026-07-02 `npm run alerts:check` passed for API readiness, web URL and operations summary aggregate counters.                                                                                |
| Restore drill      | `docs/runbooks/restore-drill-record-template.md` completed                                                       | Pending                | Restore drill not performed yet.                                                                                                                                                                                                                    |
| Backups            | Automated backups and retention confirmed                                                                        | Blocked                | Staging Render Postgres exists, but Render Recovery page shows Point-in-Time Recovery and exports/backups require a paid instance type; backups are unavailable on the current Free Tier.                                                           |
| Sentry             | API, web and worker release tags visible                                                                         | Partial                | Sentry API project created and `SENTRY_DSN`, `SENTRY_ENVIRONMENT=staging`, `SENTRY_RELEASE=staging-initial` configured. Web/worker release tag evidence still needs screenshots or links.                                                           |
| Cleanup worker     | Latest scheduled cleanup run succeeded                                                                           | Pass                   | Render cron job `vizitum-cleanup-staging` completed successfully and logged `worker_cleanup_completed` with zero failed storage objects.                                                                                                            |
| Operations summary | `/api/operations/summary` returns aggregate counters and the web operations page renders for an operator account | Staging pass           | Staging `PLATFORM_OPERATIONS_TOKEN_SHA256` configured; 2026-07-02 `alerts:check` with `OPERATIONS_SUMMARY_URL` returned aggregate counters. Production verification remains pending until production services exist.                              |
| Smoke checks       | Login, tenant lookup, field, imports, manager dashboard, manual report confirmation pass                         | Staging pass           | Expanded staging smoke on 2026-07-02 passed login, Field visit/text note/browser recording/audio fallback/manual report, Admin template proxy/validation/confirm, Manager dashboard/export/task and expected Operations permission state. Production smoke must repeat after production services are created. |
| Data protection    | Raw audio/transcript retention policy verified                                                                   | Partial                | Cloudflare R2 bucket `vizitum-staging` configured with private access and CORS for the Vercel staging origin. Full audio/transcript lifecycle and restore drill still pending.                                                                      |

## Open Risks

| Risk                                                                                             | Severity | Owner         | Mitigation                                                                                                                                                                    | Launch Blocking |
| ------------------------------------------------------------------------------------------------ | -------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Production services are not created yet.                                                         | High     | Ihor Kiyanych | Replicate validated staging setup for production with separate DB, Redis, R2 bucket, Sentry environment, uptime monitor and secrets.                                          | Yes             |
| Restore drill has not been performed.                                                            | High     | Ihor Kiyanych | Restore a recent staging/production-like backup into a recovery database and complete `docs/runbooks/restore-drill-record-template.md`.                                       | Yes             |
| Production operations summary endpoint is not verified.                                          | Medium   | Ihor Kiyanych | Repeat the staging-verified operator token setup and `alerts:check` with production `OPERATIONS_SUMMARY_URL` after production services are created.                           | No              |
| Backup retention is unavailable on the current Render Free Tier database.                        | High     | Ihor Kiyanych | Upgrade production PostgreSQL to a paid instance type or choose a managed PostgreSQL provider/plan with automated backups, retention evidence and restore path before launch. | Yes             |
| Production smoke has not been run because production services do not exist yet.               | High     | Ihor Kiyanych | Repeat the accepted staging smoke path against production after production services are created. | Yes             |

## Go / No-Go

- [ ] Go: launch can proceed.
- [x] No-go: launch is blocked.

Decision owner: Ihor Kiyanych

Decision timestamp: 2026-07-01

Follow-up actions:

- Keep staging services active as the validated baseline.
- Defer paid PostgreSQL backup/restore setup until the final production-pilot gate.
- Create production services only after PostgreSQL backup capability, restore drill and production smoke checks are complete.
- Repeat operations summary token setup and `npm run alerts:check` for production after production services are created.
- Keep the staging product smoke path as the accepted baseline and repeat it against production after production services are created.
- Capture screenshots or provider links for Render, Vercel, UptimeRobot, Cloudflare R2 and Sentry evidence.
