# Production Environment Variable Checklist

Use this checklist when creating production services from the validated staging baseline. It is intentionally value-free: do not paste secrets into this file.

## Naming Plan

Use production-specific names so staging and production cannot accidentally share state.

| Resource | Staging baseline | Production recommendation |
| --- | --- | --- |
| API service | `vizitum-api-staging` | `vizitum-api-production` or `vizitum-api-prod` |
| Web service | `vizitum-web` staging deployment | `vizitum-web-production` or production Vercel environment |
| Cleanup worker | `vizitum-cleanup-staging` | `vizitum-cleanup-production` |
| PostgreSQL | `vizitum-staging-db` | `vizitum-production-db` with backups enabled |
| Redis | `vizitum-staging-redis` | `vizitum-production-redis` |
| R2 bucket | `vizitum-staging` | `vizitum-production` |
| Sentry environment | `staging` | `production` |
| Uptime monitor | staging readiness monitor | production readiness monitor |

## Copy From Staging Only As Pattern

These values can use the same format as staging but must point to production resources:

- service build commands;
- service start commands;
- region choice;
- R2 endpoint account format;
- S3 force-path-style behavior;
- Sentry project setup pattern;
- UptimeRobot readiness monitor configuration;
- CORS structure.

Do not reuse staging secrets, database URLs, Redis URLs, buckets or tokens in production.

## API Service

| Variable | Production value source | Required | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | Production PostgreSQL provider | Yes | Must point to production DB with backup/export/restore evidence. |
| `REDIS_URL` | Production Redis provider | Yes | Must not point to staging Redis. |
| `TRUST_PROXY_HOPS` | Measured, not derived — see below | Yes | Number of proxies in front of the API. The service refuses to start without it. Do not copy a number from another environment or from this repository: staging measured `3` because Cloudflare fronts Render, while reasoning from the app's own topology alone suggests `2`. |
| `SESSION_SECRET` | Generate new secret | Yes | Long random production-only value. Rotate if exposed. |
| `SESSION_COOKIE_NAME` | Product decision | Yes | Usually `vizitum_session`; keep stable unless there is a reason to isolate. |
| `OPENAI_API_KEY` | OpenAI project/secret manager | Yes | Use a production-controlled key/project. |
| `S3_ENDPOINT` | Cloudflare R2 production account/bucket setup | Yes | R2 endpoint for the account. |
| `S3_REGION` | Cloudflare R2 config | Yes | Usually `auto` for R2. |
| `S3_BUCKET` | Cloudflare R2 production bucket | Yes | Recommended: `vizitum-production`. |
| `S3_ACCESS_KEY_ID` | R2 production API token | Yes | Scope to the production bucket where possible. |
| `S3_SECRET_ACCESS_KEY` | R2 production API token | Yes | Secret. Do not paste in docs/chat. |
| `S3_FORCE_PATH_STYLE` | R2 config | Yes | Usually `true`. |
| `APP_BASE_URL` | Production web URL | Yes | The origin users actually browse — currently `https://www.vizitum.com`. Never the deployment's own `*.vercel.app` alias: invite emails are built from this value and outlive any later domain change. |
| `API_BASE_URL` | Production API URL | Yes | Example shape: `https://api.<domain>/api`. |
| `PLATFORM_OPERATIONS_TOKEN_SHA256` | Hash of generated operator token | Yes | Preferred for production operations summary checks. Also the credential that unlocks the `trust proxy` diagnostic on `GET /health/readiness` — with neither this nor the plaintext fallback set, that block never appears and `TRUST_PROXY_HOPS` cannot be verified against a live request. |
| `PLATFORM_OPERATIONS_TOKEN` | Do not use for production | No | Plaintext fallback is staging-only. |
| `SENTRY_DSN` | Sentry API project | Yes | API/backend DSN. |
| `SENTRY_ENVIRONMENT` | Literal environment name | Yes | Must be `production`. |
| `SENTRY_RELEASE` | Git SHA or release version | Yes | Use the deployed commit SHA. |


### Measuring `TRUST_PROXY_HOPS`

Both ways of getting this wrong are silent, and neither shows up as an error:
too low and every caller resolves to an infrastructure address, so all traffic
shares one rate-limit bucket and the `ipHash` on every session is identical;
too high and the value is client-controlled via `X-Forwarded-For`.

Set any value, deploy, then ask the API what it actually resolved — from a
machine whose public address you know, and with no `X-Forwarded-For` of your
own (anyone can inflate their own count by sending the header):

```sh
curl -s -H "authorization: Bearer <platform-operator-token>" \
  https://<api-host>/api/health/readiness | jq .checks.authHardening
```

```json
{
  "trustProxyHops": 2,
  "proxyResolution": { "clientAddress": "162.158.103.144", "forwardedHopCount": 3 }
}
```

If `clientAddress` is not your own address, set `TRUST_PROXY_HOPS` to
`forwardedHopCount` and redeploy — Express counts hops inward from the socket
and each forwarded entry is one hop. Repeat until `clientAddress` matches.

The reading above is a real staging result: the resolved address was
Cloudflare's, not the caller's, because the chain is three long and the
setting said two.

Afterwards, sign in through the web app once. The measurement is taken on a
direct call to the API, and real traffic arrives through the web layer; if the
count is too high for that path the symptom is unmistakable — `429` on login.

## Cleanup Worker

Use the same production values as the API for shared backend dependencies (not `TRUST_PROXY_HOPS` — the worker serves no HTTP, so it never reads `request.ip` and has no boot gate on it):

- `DATABASE_URL`
- `REDIS_URL`
- `OPENAI_API_KEY`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

Worker-specific checks:

- scheduled command is `npm run worker:cleanup:prod`;
- schedule is at least hourly for pilot;
- non-zero exit sends an alert;
- logs are searchable for `worker_cleanup_completed` and `worker_task_failed`.

## Web Service

| Variable | Production value source | Required | Notes |
| --- | --- | --- | --- |
| `API_BASE_URL` | Production API URL | Yes | Must point to production API, not staging. |
| `ENABLE_DEMO_FALLBACK` | Leave unset or `false` | No | Production must not show demo data for API/auth failures. |
| `NEXT_PUBLIC_ENABLE_DEMO_FALLBACK` | Leave unset or `false` | No | Do not enable in production. |
| `SENTRY_DSN` | Sentry web project | Yes | Frontend DSN. |
| `SENTRY_ENVIRONMENT` | Literal environment name | Yes | Must be `production`. |
| `SENTRY_RELEASE` | Git SHA or release version | Yes | Use the deployed commit SHA. |

`APP_BASE_URL` is deliberately absent here: only the API reads it, to build absolute invite links. Setting it on the web service has no effect and makes the API's value look already handled when it drifts.

The public origin the web service answers on is a hosting-level setting, not an env var. Point the production domain at this deployment and keep `apps/web/lib/site.ts` naming the same origin — it is what the marketing pages advertise as canonical and what `apps/web/lib/canonical-host.ts` redirects the Vercel alias to.

## Generated Secrets

Generate new production-only values for:

- `SESSION_SECRET`;
- platform operations raw token, then store only its SHA-256 hash as `PLATFORM_OPERATIONS_TOKEN_SHA256`;
- R2 access key and secret access key;
- database password or connection string;
- Redis password or connection string.

Suggested local command for a raw operations token:

```sh
openssl rand -base64 48
```

Suggested local command for SHA-256 hash:

```sh
printf '%s' '<raw-token>' | shasum -a 256
```

Store the raw token only in a password manager or provider secret store. Store the hash in API env.

## Pre-Production Verification

Before marking production env ready:

- API readiness returns `status=ready`;
- API readiness reports database `ok`;
- API readiness reports no missing critical env vars;
- production PostgreSQL is a paid/managed instance with backup/export/restore evidence attached;
- `SENTRY_ENVIRONMENT=production` appears in Sentry events;
- `SENTRY_RELEASE` equals the deployed commit SHA;
- production web does not use demo fallback;
- production API and web use production URLs only;
- production DB backups are enabled;
- R2 bucket is production-specific and private;
- CORS allows only the production web origin and any approved preview/staging origins;
- Uptime monitor checks production `/api/health/readiness`;
- `npm run alerts:check` passes with production `API_READINESS_URL`, `WEB_URL` and, when configured, `OPERATIONS_SUMMARY_URL`.

## Evidence To Capture

Capture screenshots or provider links for:

- API env var names present, with values hidden;
- web env var names present, with values hidden;
- cleanup worker env var names present, with values hidden;
- PostgreSQL backups and retention;
- Redis availability alert;
- R2 bucket and CORS;
- Sentry production environment/release;
- Uptime monitor status;
- `npm run alerts:check` output.

Do not store raw secret values in screenshots, markdown, tickets or chat.
