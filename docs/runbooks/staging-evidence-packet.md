# Staging Evidence Packet

Use this packet to collect evidence for the current staging baseline before creating production services. Screenshots or provider links can be pasted into the Evidence column.

## Snapshot

- Environment: staging
- Tenant slug: `vizitum-staging`
- API URL: `https://vizitum-api-staging.onrender.com`
- API readiness URL: `https://vizitum-api-staging.onrender.com/api/health/readiness`
- Web URL: `https://vizitum-web.vercel.app`
- R2 bucket: `vizitum-staging`
- Uptime monitor: UptimeRobot readiness monitor
- Incident channel: `kiyanichenko@ukr.net`
- Smoke visit id: `cmr34awsr000b1sejj2ncbq0k`
- Smoke report id: `cmr34rbkb000d1scj5kht6f80`

## Provider Evidence

| Area                   | Expected Evidence                                                                             | Current Status | Evidence                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render API service     | Service exists, latest deploy succeeded, public URL opens, env vars configured                | Pass           | Render overview screenshot provided on 2026-07-02 shows `vizitum-api-staging` as `Deployed` in Frankfurt.                                                                                                                          |
| Render Postgres        | Database exists, migrations applied, readiness database check is `ok`                         | Staging pass   | Render overview screenshot provided on 2026-07-02 shows `vizitum-staging-db` as `Available`, PostgreSQL 18, Frankfurt.                                                                                                             |
| Render Redis/Key Value | Redis exists and `REDIS_URL` is configured on API/worker                                      | Staging pass   | Render overview screenshot provided on 2026-07-02 shows `vizitum-staging-redis` as `Available`, Valkey 8, Frankfurt.                                                                                                               |
| Render cleanup cron    | Cron command is `npm run worker:cleanup:prod`, latest run completed successfully              | Pass           | Render cron log screenshot provided on 2026-07-02 shows `worker_cleanup_completed` and `Cron job run finished successfully` at 09:39.                                                                                              |
| Vercel web             | Deployment succeeded, web URL returns HTTP 200, env vars verified                             | Pass           | Vercel deployments screenshot provided on 2026-07-02 shows production deployments `07ed07d` and `0172006` on `main` with status `Ready`.                                                                                           |
| Cloudflare R2          | Bucket `vizitum-staging` exists, private access, CORS configured for Vercel origin            | Pass           | R2 overview screenshot provided on 2026-07-02 shows bucket `vizitum-staging`, 0 objects, 0 B storage and current-period usage. CORS was configured during staging setup; add CORS screenshot if stricter audit evidence is needed. |
| Sentry                 | API project exists, DSN configured, staging release/environment visible                       | Partial        | TODO: add Sentry project/release screenshot/link                                                                                                                                                                                   |
| UptimeRobot            | Readiness monitor exists and status is Up                                                     | Pass           | TODO: add monitor screenshot/link                                                                                                                                                                                                  |
| Alerts endpoint check  | `npm run alerts:check` passed for API readiness and web URL                                   | Pass           | TODO: paste command output or terminal screenshot                                                                                                                                                                                  |
| Product smoke          | Login, tenant lookup, field, imports, manager dashboard and manual report confirmation passed | Staging pass   | Smoke visit `cmr34awsr000b1sejj2ncbq0k`; smoke report `cmr34rbkb000d1scj5kht6f80`. Repeat smoke with `docs/runbooks/expanded-staging-product-smoke.md` after the newly wired self-serve actions deploy.                            |
| Staging UX review      | Pilot-blocking UX issues are listed after smoke pass                                          | Pass           | Product UI blockers are implemented; see `docs/runbooks/staging-ux-review.md` for the required re-smoke scope.                                                                                                                     |

## Known Gaps

| Gap                                    | Why It Is Deferred                                                                            | Production Impact                                                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL backup/export/PITR evidence | Render Free Tier shows backups/export/PITR unavailable                                        | Must be resolved before production pilot                                                                                                                                |
| Restore drill                          | Requires a backup/export-capable PostgreSQL plan or provider                                  | Must pass before production pilot                                                                                                                                       |
| Operations summary endpoint check      | Platform operator token env value is not configured yet                                       | Token path exists; configure `PLATFORM_OPERATIONS_TOKEN_SHA256` or staging `PLATFORM_OPERATIONS_TOKEN`, then rerun `npm run alerts:check` with `OPERATIONS_SUMMARY_URL` |
| Full production alert rules            | Production services do not exist yet                                                          | Configure after production services are created                                                                                                                         |
| Expanded self-serve product smoke      | Newly wired Field, Admin imports and Manager actions were added after the first staging smoke | Must pass before self-serve pilot. Use `docs/runbooks/expanded-staging-product-smoke.md`.                                                                               |

## Next Evidence Actions

1. Add Render screenshots/links for API, Postgres, Redis and cleanup cron.
2. Add Vercel deployment and environment screenshots/links.
3. Add Cloudflare R2 bucket and CORS screenshots/links.
4. Add Sentry project/release evidence.
5. Add UptimeRobot monitor screenshot/link.
6. Paste the `npm run alerts:check` output.
7. Rerun expanded product smoke after the latest frontend/backend changes deploy using `docs/runbooks/expanded-staging-product-smoke.md`.
8. Decide assisted vs self-serve pilot scope from `docs/runbooks/staging-ux-review.md`.
