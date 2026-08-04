# Final Production Pilot Execution

This checklist starts after paid PostgreSQL is available. It turns the validated staging baseline into a production pilot environment without storing secrets in git.

Do not mark launch readiness as `Go` until the backup evidence, restore drill, production alerts and production smoke checks all pass.

## Phase 1: Paid PostgreSQL Evidence

Capture provider evidence for the production PostgreSQL service:

- production database name or provider resource id, with credentials hidden;
- automated backups enabled;
- latest successful backup visible;
- retention period, minimum 7 days and preferably 14 days;
- export or restore workflow available;
- point-in-time recovery status, if the provider supports it;
- backup failure or stale-backup alert recipients.

Record the evidence in `docs/runbooks/production-launch-readiness-record.md`. Do not paste connection strings, passwords or database URLs.

## Phase 2: Restore Drill

Restore a recent backup into a staging or recovery database, never into production.
Use `docs/runbooks/restore-target-setup.md` to create the restored database target safely.

Required safety checks:

- target database is staging/recovery;
- production write traffic is untouched;
- restored credentials are separate from production credentials;
- object storage buckets are not overwritten;
- operator and reviewer are known.

Run the drill checks from a trusted operator machine:

```sh
DATABASE_URL="<restored-staging-or-recovery-database-url>" \
API_READINESS_URL="https://<staging-or-recovery-api>/api/health/readiness" \
npm run restore:drill:check
```

Then run or trigger cleanup worker verification against the restored environment:

```sh
npm run worker:cleanup:prod
```

Complete `docs/runbooks/restore-drill-record-template.md` with backup identity, restored database target, command results, manual read checks and findings.

## Phase 3: Production Services

Create production-specific resources. They must not reuse staging state.

| Resource | Production requirement |
| --- | --- |
| API | Separate production service, production `DATABASE_URL`, production Redis, production R2 bucket, `SENTRY_ENVIRONMENT=production` |
| Web | Production URL, production API URL, demo fallback unset or `false`, frontend Sentry production environment |
| Cleanup worker | Scheduled `npm run worker:cleanup:prod`, non-zero exit alert |
| PostgreSQL | Paid database with backup/restore evidence |
| Redis | Production instance with availability/error alerts |
| R2 | Production bucket, private access, production CORS |
| Sentry | API, web and worker production events with release tag |
| Uptime | External monitor for `/api/health/readiness` |

There is no provision worker: tenants are created directly `pilot`, so nothing needs to advance them. Disable any `worker:provision` cron left over from a previous deploy.

Use `docs/runbooks/production-env-checklist.md` before copying any setting. Generate new production-only secrets for session, platform operations token, database, Redis and R2 credentials.

On first production deploy, seed the platform owner with provider-managed environment variables:

```sh
npm run seed:platform-owner
```

Required env for that one-time seed:

- `PLATFORM_OWNER_EMAIL`;
- `PLATFORM_OWNER_PASSWORD` — **at most 128 characters**; a generated one longer
  than that is refused by the seed, because the login endpoint would read it as
  no password at all and the account could never sign in (see
  [environment.md](../reference/environment.md));
- optional `PLATFORM_OWNER_NAME`.

## Phase 4: Alerts and Endpoint Verification

Configure production alert rules before inviting pilot users:

- API readiness failure;
- API 5xx spike;
- frontend runtime errors on login, field and report flows;
- cleanup worker failure;
- PostgreSQL backup disabled or latest backup too old;
- PostgreSQL connection/storage pressure;
- Redis availability/errors;
- Sentry release regression.

Run the automated endpoint check:

```sh
API_READINESS_URL="https://<production-api>/api/health/readiness" \
WEB_URL="https://<production-web>" \
OPERATIONS_SUMMARY_URL="https://<production-api>/api/operations/summary" \
OPERATIONS_SUMMARY_BEARER_TOKEN="<platform-operator-token>" \
npm run alerts:check
```

Store only command output or provider/CI evidence. Keep the raw operations token out of docs and chat.

## Phase 5: Production Smoke

Repeat the accepted staging smoke path against production:

- platform owner login and tenant console load;
- tenant creation lands immediately on `pilot` (no provision worker to wait on);
- tenant admin login and tenant slug lookup;
- Field visit creation;
- browser voice recording or audio upload fallback;
- text notes;
- manual report confirmation when AI is weak or unavailable;
- Admin import template download, validation preview and confirm/apply;
- Manager dashboard metrics;
- Manager CSV export;
- Manager task assignment;
- operations summary endpoint returns aggregate counters.

Use `docs/runbooks/expanded-staging-product-smoke.md` as the detailed checklist, but record the result in `docs/runbooks/production-launch-readiness-record.md`.

## Phase 6: Go Decision

Move `docs/runbooks/production-launch-readiness-record.md` from `No-go` to `Go` only after:

- CI for the release SHA passes;
- production deploy is complete;
- backup evidence is attached;
- restore drill passes;
- production alerts are configured and verified;
- cleanup worker has successful runs;
- Sentry production environment/release evidence exists;
- production smoke checks pass;
- launch owner and reviewer sign off.

If any item is missing, keep the launch decision as `No-go` and record the owner and next action.
