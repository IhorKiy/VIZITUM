# Environment Variables

Consolidated reference of environment variables actually read by the code. Sources of truth: `grep -rE "process\.env\." src apps/web scripts`, `.env.example`, `src/modules/storage/storage.config.ts`, `src/modules/health/health.service.ts`. For production values and naming see `docs/runbooks/production-env-checklist.md`. Never put secret values in docs or commits. Update this document in the same change as adding/removing an env var.

## API service (`src/`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string (Prisma). Also checked by `/health/readiness`. |
| `SESSION_SECRET` | yes (readiness) | Checked by `/health/readiness` as a critical var. Session tokens themselves are random and hashed, so this is a deployment guard, not a signing key. |
| `PORT` / `HOST` | no | API listen port/host; defaults `4000` / `0.0.0.0`. |
| `NODE_ENV` | no | `production` enables Secure cookies. |
| `OPENAI_API_KEY` | for AI flows | OpenAI auth for transcription/extraction. Manual report confirmation must keep working without it. |
| `OPENAI_TRANSCRIPTION_MODEL` / `OPENAI_EXTRACTION_MODEL` | no | Model overrides for AI jobs (defaults in `src/modules/ai`). |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes (storage flows) | S3-compatible storage (Cloudflare R2 in staging). Missing values throw at first storage use. |
| `S3_REGION` | no | Default `auto`. |
| `S3_FORCE_PATH_STYLE` | no | Boolean, default `true`. |
| `PLATFORM_OPERATIONS_TOKEN_SHA256` | recommended | SHA-256 hash of the platform operations bearer token (preferred over plaintext). Grants only `platform.operations.read` (for `GET /operations/summary`); it cannot manage tenants (that needs a `platform_owner` session — see [permissions.md](permissions.md)). |
| `PLATFORM_OPERATIONS_TOKEN` | fallback | Plaintext operations token; used only when the SHA256 var is unset. Same scope as above. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | no | Error reporting for 5xx responses; disabled when DSN is empty. |

## Cleanup worker (`src/worker.ts`)

Same env as the API (it boots the same Nest application context: `DATABASE_URL`, `S3_*`, Sentry vars), plus:

| Variable | Required | Purpose |
| --- | --- | --- |
| `WORKER_TASK` | no | Task selector: `cleanup` (default) or `provision` (advances queued platform provisioning jobs). |

## Web service (`apps/web`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `API_BASE_URL` | yes in deploys | Backend base URL **including `/api`** (default `http://127.0.0.1:4000/api`), used server-side in `apps/web/lib/api-client.ts`. |
| `ENABLE_DEMO_FALLBACK` / `NEXT_PUBLIC_ENABLE_DEMO_FALLBACK` | no | Enable demo data fallback (`apps/web/lib/demo-mode.ts`); keep disabled in production. |

## Scripts

| Variable | Used by | Purpose |
| --- | --- | --- |
| `OPERATIONS_SUMMARY_URL` | `scripts/production-alerts-check.mjs` (`npm run alerts:check`) | Full URL of `/api/operations/summary`. |
| `OPERATIONS_SUMMARY_BEARER_TOKEN` | `production-alerts-check.mjs` | Bearer token for the summary endpoint. |
| `DEMO_TENANT_SLUG`, `DEMO_TENANT_NAME`, `DEMO_ROLE_PASSWORD`, `DATABASE_URL` | `scripts/seed-demo-roles.mjs` (`npm run seed:demo-roles`) | Local demo tenant/user seed. `DEMO_ROLE_PASSWORD` is required and has no default; `DATABASE_URL` must point to localhost/127.0.0.1/::1. |
| `SEED_TENANT_SLUG`, `SEED_TENANT_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_ROLE_CODES`, `SEED_SMOKE_DATA`, `SEED_CONFIRM_SMOKE_REPORT` | `scripts/seed-staging-admin.mjs` (`npm run seed:staging-admin`) | Staging tenant/admin provisioning. |
| `PLATFORM_OWNER_EMAIL`, `PLATFORM_OWNER_NAME`, `PLATFORM_OWNER_PASSWORD` | `scripts/seed-platform-owner.mjs` (`npm run seed:platform-owner`) | Upserts the first `PlatformUser` (platform-owner login). `PLATFORM_OWNER_NAME` defaults to `Vizitum Platform Owner`. |
| `API_READINESS_URL`, `DATABASE_URL` | `scripts/restore-drill-check.sh` (`npm run restore:drill:check`) | Restore drill validation. |

## Present in `.env.example` but not read by code

- `REDIS_URL` — Redis is provisioned in `docker-compose` and reserved for BullMQ per the LLD, but no backend code currently reads it.
- `SESSION_COOKIE_NAME` — the cookie name is hardcoded as `vizitum_session` in `src/modules/auth/auth.constants.ts`.
- `APP_BASE_URL` — not consumed by `src/` or `apps/web` today.
- `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` — consumed by `docker-compose` for the local database container, not by the app.
