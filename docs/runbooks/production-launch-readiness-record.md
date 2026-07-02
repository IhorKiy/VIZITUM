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

| Area               | Required Evidence                                                                                                | Status | Link/Notes |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| CI                 | Latest `main` checks pass                                                                                        | Pending | Not verified during staging ops setup. Local `npm run build` and `npm test` passed while preparing Render fixes. |
| Deployment         | `docs/runbooks/production-deployment.md` completed                                                               | Staging pass | Render staging API deployed, Vercel staging web deployed, Render cleanup cron deployed. Production deployment not created yet. |
| API readiness      | `/api/health/readiness` returns ready                                                                            | Pass | `https://vizitum-api-staging.onrender.com/api/health/readiness` returned `status=ready`, `database=ok`, and no missing critical environment variables. |
| Alerts             | `docs/runbooks/production-alerts.md` readiness verification and `npm run alerts:check` completed                 | Staging pass | UptimeRobot readiness monitor created with status Up. `npm run alerts:check` passed for API readiness and web URL; operations summary check skipped because operator token is not configured. |
| Restore drill      | `docs/runbooks/restore-drill-record-template.md` completed                                                       | Pending | Restore drill not performed yet. |
| Backups            | Automated backups and retention confirmed                                                                        | Blocked | Staging Render Postgres exists, but Render Recovery page shows Point-in-Time Recovery and exports/backups require a paid instance type; backups are unavailable on the current Free Tier. |
| Sentry             | API, web and worker release tags visible                                                                         | Partial | Sentry API project created and `SENTRY_DSN`, `SENTRY_ENVIRONMENT=staging`, `SENTRY_RELEASE=staging-initial` configured. Web/worker release tag evidence still needs screenshots or links. |
| Cleanup worker     | Latest scheduled cleanup run succeeded                                                                           | Pass | Render cron job `vizitum-cleanup-staging` completed successfully and logged `worker_cleanup_completed` with zero failed storage objects. |
| Operations summary | `/api/operations/summary` returns aggregate counters and the web operations page renders for an operator account | Pending | Not verified. `alerts:check` skipped operations summary because `OPERATIONS_SUMMARY_URL` and bearer token were not configured. |
| Smoke checks       | Login, tenant lookup, field, imports, manager dashboard, manual report confirmation pass                         | Partial | Staging tenant `vizitum-staging` and active admin user were seeded; login now works. Field, imports, manager dashboard and manual report confirmation smoke checks still need to be completed. |
| Data protection    | Raw audio/transcript retention policy verified                                                                   | Partial | Cloudflare R2 bucket `vizitum-staging` configured with private access and CORS for the Vercel staging origin. Full audio/transcript lifecycle and restore drill still pending. |

## Open Risks

| Risk | Severity | Owner | Mitigation | Launch Blocking |
| ---- | -------- | ----- | ---------- | --------------- |
| Production services are not created yet. | High | Ihor Kiyanych | Replicate validated staging setup for production with separate DB, Redis, R2 bucket, Sentry environment, uptime monitor and secrets. | Yes |
| Restore drill has not been performed. | High | Ihor Kiyanych | Restore a recent staging/production-like backup into a recovery database and complete `docs/runbooks/restore-drill-record-template.md`. | Yes |
| Operations summary endpoint is not verified. | Medium | Ihor Kiyanych | Configure platform operator token and run `alerts:check` with `OPERATIONS_SUMMARY_URL` and `OPERATIONS_SUMMARY_BEARER_TOKEN`. | No |
| Backup retention is unavailable on the current Render Free Tier database. | High | Ihor Kiyanych | Upgrade production PostgreSQL to a paid instance type or choose a managed PostgreSQL provider/plan with automated backups, retention evidence and restore path before launch. | Yes |
| Full product smoke checks are only partially complete. | High | Ihor Kiyanych | Complete field, imports, manager dashboard and manual report confirmation smoke checks against staging. | Yes |

## Go / No-Go

- [ ] Go: launch can proceed.
- [x] No-go: launch is blocked.

Decision owner: Ihor Kiyanych

Decision timestamp: 2026-07-01

Follow-up actions:

- Keep staging services active as the validated baseline.
- Create production services only after PostgreSQL backup capability, restore drill and smoke checks are complete.
- Configure operations summary token and rerun `npm run alerts:check` with operations summary enabled.
- Capture screenshots or provider links for Render, Vercel, UptimeRobot, Cloudflare R2 and Sentry evidence.
