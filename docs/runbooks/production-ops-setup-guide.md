# Production Ops Setup Guide

Цей документ пояснює, як з нуля підключити production/staging ops для першого Vizitum Team Pilot: hosting, Sentry, PostgreSQL backups/alerts, Redis alerts і restore drill.

Він написаний як практичний маршрут для власника продукту або технічного оператора, який ще не планував ці кроки.

## Recommended Minimum Setup

Для першого pilot не варто будувати надто складну інфраструктуру. Достатньо керованих сервісів з простими alert rules і зрозумілим restore path.

Рекомендована стартова схема:

| Area | Recommendation | Why |
| --- | --- | --- |
| Web hosting | Vercel або Render static/web service | Простий deploy Next.js, preview/staging URL-и, базові deployment logs |
| API hosting | Render web service | Добре підходить для NestJS API, health checks, env vars, logs |
| Cleanup worker | Render cron job або scheduled worker | Можна запускати `npm run worker:cleanup:prod` за розкладом |
| PostgreSQL | Neon, Supabase, Render Postgres або Railway Postgres | Managed backups, простий staging/recovery database |
| Redis | Upstash Redis або Render/Railway Redis | Managed Redis без власного адміністрування |
| Error tracking | Sentry | Frontend/backend/worker errors, release tags, alert routing |
| Uptime monitor | Hosting health check або Better Stack/UptimeRobot | Простий зовнішній check для `/api/health/readiness` |
| Incident channel | Slack/Telegram/email group | Одне місце, куди приходять production-critical alerts |

Найпростіший варіант для pilot: Render для API, worker, Postgres і Redis; Vercel для web; Sentry для errors; UptimeRobot або Better Stack для readiness monitor.

Якщо хочеться менше провайдерів, можна тримати web/API/worker/Postgres/Redis у Render. Якщо хочеться найкращий Next.js hosting, web краще винести на Vercel.

## Setup Order

Рекомендований порядок важливий: спочатку середовища і secrets, потім observability, потім backups, потім drill.

1. Створити production і staging середовища.
2. Підключити managed PostgreSQL і Redis.
3. Налаштувати API, web і cleanup worker deploy.
4. Додати Sentry для API, web і worker.
5. Увімкнути uptime/readiness monitor.
6. Увімкнути PostgreSQL backup alerts.
7. Увімкнути Redis/provider alerts.
8. Запустити `npm run alerts:check`.
9. Виконати restore drill на staging/recovery DB.
10. Заповнити `docs/runbooks/production-launch-readiness-record.md`.

Use `docs/runbooks/production-env-checklist.md` when converting validated staging settings into production environment variables.
Once paid PostgreSQL is available, use `docs/runbooks/final-production-pilot-execution.md` as the ordered final gate from backup evidence through Go/No-Go.

## Environments

Мінімально потрібні два середовища:

| Environment | Purpose | Data |
| --- | --- | --- |
| `staging` | Перевірка deploy, alerts і restore drill | Production-like або anonymized data |
| `production` | Реальний pilot tenant | Тільки реальні pilot data |

Не запускайте restore drill напряму в production database. Drill має йти тільки в staging або recovery database.

## Hosting Setup

### API Service

Створіть API service з такими командами:

```sh
npm ci && npm run prisma:generate && npm run build
npm start
```

Required environment:

- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET`
- `SESSION_COOKIE_NAME`
- `OPENAI_API_KEY`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE`
- `APP_BASE_URL`
- `API_BASE_URL`
- `PLATFORM_OPERATIONS_TOKEN_SHA256`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

Health check:

```text
GET https://<api-domain>/api/health/readiness
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

### Web Service

Build/start:

```sh
npm ci && npm run web:build
npm run web:start
```

Required environment:

- `APP_BASE_URL`
- `API_BASE_URL`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

Production recommendation:

- leave `ENABLE_DEMO_FALLBACK` unset or set to `false`;
- never set `NEXT_PUBLIC_ENABLE_DEMO_FALLBACK=true` in production.

### Cleanup Worker

Run this as scheduled job, at least hourly for pilot:

```sh
npm ci && npm run prisma:generate && npm run build
npm run worker:cleanup:prod
```

Alert on non-zero exit. Also check logs for:

```text
message="worker_cleanup_completed"
message="worker_task_failed"
```

## Sentry Setup

Create projects or environments for:

- `vizitum-api`
- `vizitum-web`
- `vizitum-worker`

Minimum Sentry alert rules:

| Rule | Severity | Recommendation |
| --- | --- | --- |
| New production issue in API | Critical | Notify incident channel immediately |
| New production issue in worker | Warning/Critical | Critical if cleanup or AI/import jobs are blocked |
| New production issue in web | Warning | Critical if login/field/report flow is blocked |
| API issue count spike | Critical | Alert if issue count crosses pilot threshold in 5 minutes |
| Release regression | Critical | Alert after new deploy if issue rate increases |

Required tags/environment:

- `environment=production`
- `release=<git-sha-or-release-version>`
- service name where possible: `api`, `web`, `worker`

## Platform Operations Token

The operations summary endpoint is intentionally machine-readable for readiness checks, but it must not use a broad user session token.

Recommended setup:

1. Generate a long random token in a password manager or provider secret tool.
2. Store only its SHA-256 hash in API env:

```sh
PLATFORM_OPERATIONS_TOKEN_SHA256="<sha256-token-hash>"
```

3. Keep the raw token only in the secure operator secret store.
4. Use it only for:

```text
Authorization: Bearer <platform-operator-token>
```

Staging-only shortcut:

```sh
PLATFORM_OPERATIONS_TOKEN="<raw-token>"
```

Do not use the plaintext fallback for production if the provider supports hashed secret setup.

Data safety recommendation:

- do not send raw voice notes, transcripts, report free text, customer contacts or commercial notes to Sentry;
- prefer IDs, route names, status codes and error codes.

Evidence to save:

- screenshot or link showing Sentry project/environment;
- screenshot or link showing alert rule recipients;
- one test event in staging or production-like environment;
- release tag visible for the deployed SHA.

## Hosting and Uptime Alerts

Minimum alerts:

| Alert | Trigger | Severity |
| --- | --- | --- |
| API readiness failing | 2 failed checks or 5xx for 2 minutes | Critical |
| API service down/restart loop | Provider service unavailable | Critical |
| Web app unavailable | 2 failed checks or 5xx for 2 minutes | Warning/Critical |
| Cleanup worker failed | Scheduled job exits non-zero | Warning |
| Deploy failed | Build or deploy failed | Warning |

Readiness URL:

```text
https://<api-domain>/api/health/readiness
```

Recommendation: use an external uptime monitor even if the hosting provider has its own health checks. Hosting checks can tell whether the container is alive; external checks tell whether users can reach it.

## PostgreSQL Setup

Minimum database requirements:

- automated daily backups enabled;
- at least 7 days retention, 14 days preferred;
- point-in-time recovery enabled if provider supports it;
- manual snapshot before risky migrations;
- clear restore path into staging/recovery database.

Minimum PostgreSQL alerts:

| Alert | Trigger | Severity |
| --- | --- | --- |
| Backup disabled | Any production backup policy disabled | Critical |
| Latest backup too old | Older than expected backup interval | Critical |
| PITR disabled when expected | PITR unavailable or disabled | Critical |
| Connection exhaustion | Pool near limit or connection failures | Critical |
| Storage near limit | Above 80 percent | Warning |
| Provider outage | Provider status or DB unavailable | Critical |

Evidence to save:

- screenshot/link showing backup policy;
- screenshot/link showing latest successful backup;
- screenshot/link showing retention period;
- screenshot/link showing alert rules/recipients;
- restore target database name or URL host for drill.

## Redis Setup

Minimum Redis alerts:

| Alert | Trigger | Severity |
| --- | --- | --- |
| Redis unavailable | Provider reports downtime or connection failures | Critical |
| High error rate | Connection/auth errors for 2-5 minutes | Critical |
| Memory near limit | Above 80 percent | Warning |
| Evictions | Any unexpected eviction in pilot | Warning |
| Queue not draining | Queue depth does not decrease for 10 minutes | Warning/Critical |

For pilot, provider-level availability alerts are enough if there is no full queue dashboard yet. If queue metrics are added later, promote queue depth and failed job counts to first-class alerts.

Evidence to save:

- Redis provider URL/name;
- screenshot/link showing availability alert;
- screenshot/link showing recipient/channel;
- recent successful worker run.

## Alert Recipient Recommendation

Minimum routing:

| Channel | Purpose |
| --- | --- |
| Incident chat | Critical alerts, deployment failures, service down |
| Email | Secondary copy for operational owner |
| Sentry project notifications | Engineering/debug context |

For pilot, one human owner must be explicitly responsible for acknowledging alerts. Do not leave alerts going only to a generic inbox.

## Automated Endpoint Verification

After deploy and alert setup, run:

```sh
API_READINESS_URL="https://<api-domain>/api/health/readiness" \
WEB_URL="https://<web-domain>" \
OPERATIONS_SUMMARY_URL="https://<api-domain>/api/operations/summary" \
OPERATIONS_SUMMARY_BEARER_TOKEN="<platform-operator-token>" \
npm run alerts:check
```

If you do not yet have a platform operator token, run at least:

```sh
API_READINESS_URL="https://<api-domain>/api/health/readiness" \
WEB_URL="https://<web-domain>" \
npm run alerts:check
```

Save the command output or CI/job link as evidence.

## Restore Drill

Goal: prove that a recent backup can be restored into a safe environment and the app can start against it.

Required inputs:

- source backup id or restore timestamp;
- staging/recovery database URL;
- confirmation that target is not production;
- staging API URL if API is deployed against restored DB;
- operator name and timestamp.

Recommended drill steps:

1. Pick a recent production-like backup.
2. Restore it into a new staging/recovery database.
3. Point staging API to that restored `DATABASE_URL`.
4. Run:

```sh
DATABASE_URL="<restored-staging-database-url>" \
API_READINESS_URL="https://<staging-api>/api/health/readiness" \
npm run restore:drill:check
```

5. Verify key data manually:

- tenant registry loads;
- users and roles exist;
- locations and visits are readable;
- tasks are readable;
- import job metadata is readable;
- AI job metadata is readable;
- confirmed reports still work without requiring raw temporary audio/transcript payloads.

6. Run or trigger cleanup worker against staging/recovery and confirm it exits cleanly.
7. Fill `docs/runbooks/restore-drill-record-template.md`.

Do not mark restore drill complete from command output alone. The record needs backup identity, restored DB target, date, operator and verification notes.

## What To Send Back For Completion

Щоб я міг допомогти закрити production ops пункти в plan, мені потрібні не secrets, а evidence.

Send these values or screenshots/links:

| Item | Needed |
| --- | --- |
| Web URL | Public production or staging web URL |
| API readiness URL | `https://<api-domain>/api/health/readiness` |
| Hosting provider | Render/Vercel/Fly/Railway/etc. |
| Sentry evidence | Projects/environments, alert rules, one test event |
| PostgreSQL evidence | Backups enabled, latest backup, retention, alerts |
| Redis evidence | Availability/error alerts and recipients |
| Alert recipient | Incident chat/email owner |
| `npm run alerts:check` output | Command output or CI/job link |
| Restore drill record | Filled restore drill template |
| Restored DB proof | Confirmation target was staging/recovery, not production |

Do not paste production secrets into chat. For `DATABASE_URL`, `OPENAI_API_KEY`, S3 keys or session secrets, use provider env vars or a secure secret manager.

## Decision Checklist

Before pilot, answer these:

- Who receives critical alerts?
- Who can acknowledge an alert?
- Who can approve production restore?
- Where is the latest backup visible?
- How many days of backup retention are guaranteed?
- Can we restore into staging without touching production?
- Does `/api/health/readiness` fail loudly when database or env vars are broken?
- Does production frontend avoid demo fallback?
- Is there a completed restore drill record?

If any answer is unclear, keep the launch readiness item open.
