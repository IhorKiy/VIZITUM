# Production Alerts Runbook

This runbook defines the minimum production-critical alerts required before the Team Pilot launch. It covers the API, frontend, workers, database, Redis, storage cleanup and AI/import processing paths.

## Scope

- Frontend: Next.js web app.
- API: NestJS service with `/api/health`.
- Workers: background import, AI and cleanup jobs.
- Database: managed PostgreSQL used by API and workers.
- Queue/cache: managed Redis/BullMQ.
- Error tracking: Sentry.
- Logs: structured JSON service logs.

## Alert Channels

- Primary channel: incident chat channel for the pilot team.
- Secondary channel: email notification to the operational owner.
- Escalation owner: production pilot technical owner.
- Business owner notification is required only for tenant-visible impact, data integrity risk or restore decisions.

## Required Alert Rules

| Signal | Source | Severity | Trigger | First Response |
| --- | --- | --- | --- | --- |
| API health failing | Render/service health check or uptime monitor on `/api/health` | Critical | 2 consecutive failed checks or 5xx response for 2 minutes | Check service logs, database connectivity and recent deploys. |
| API 5xx error rate | Sentry or structured logs where `message=request_failed` and `statusCode>=500` | Critical | More than 5% 5xx over 5 minutes, or at least 10 5xx in 5 minutes during pilot traffic | Triage top error by `requestId`, `errorCode`, path and release. |
| Repeated tenant resolution failures | Structured logs / Sentry errors with tenant resolution failure code | Warning | 5 failures for the same host/slug in 10 minutes | Verify tenant slug, tenant status, DNS/host mapping and session cookies. |
| Database connectivity failure | `/api/health`, PostgreSQL provider metrics, API logs | Critical | Health check cannot run `SELECT 1`, connection pool exhaustion, or provider outage alert | Check managed DB status, connection limits and last migration/deploy. |
| Redis/queue unavailable | Worker logs or provider metrics | Critical | Worker cannot connect to Redis for 2 minutes or queue depth stops draining for 10 minutes | Check Redis provider status and worker service health. |
| Import job failures | Structured logs, job dashboard or import job status | Warning | 3 failed import jobs in 15 minutes, or one repeated failure for the same tenant/template | Inspect import row issues and recent template changes; confirm no partial apply occurred. |
| AI transcription/extraction failures | Structured logs where `message=ai_job_status` and `status=failed` | Warning | 3 failed AI jobs in 15 minutes, or provider/auth errors for 5 minutes | Check OpenAI credentials/provider status and confirm manual report flow remains available. |
| Temporary storage cleanup failure | Structured logs where cleanup result contains failed deletion or expired object backlog grows | Warning | Cleanup fails once in production, or expired temporary object backlog grows across 2 runs | Check R2/S3 credentials, bucket policy and object registry state. |
| Frontend runtime errors | Sentry frontend project | Warning | New issue affecting at least 2 users or any error on login/field/report flows | Triage by release, route and browser; rollback if core pilot flow is blocked. |
| Backup/restore protection | Backup provider alert and manual drill record | Critical | Automated backup disabled, PITR unavailable when expected, or latest backup older than policy | Re-enable backups or escalate to provider before further production changes. |

## Sentry Configuration

Create separate Sentry projects or environments for:

- `vizitum-api`;
- `vizitum-web`;
- `vizitum-worker` if workers run as a separate service.

Required environment variables:

```sh
SENTRY_DSN="..."
SENTRY_ENVIRONMENT="production"
SENTRY_RELEASE="<git-sha-or-release-version>"
```

Sentry alerts must include:

- new production issue in API/worker/frontend;
- API issue count above the 5xx threshold;
- frontend login, field flow or report confirmation route errors;
- release regression after deploy.

Never send raw notes, transcripts, audio contents or confirmed report free text to Sentry.

## Structured Log Queries

The JSON logger emits stable fields that should be searchable in the log provider.

API failures:

```text
message="request_failed" level="error"
```

AI job failures:

```text
message="ai_job_status" status="failed"
```

HTTP access latency and status:

```text
message="http_request"
```

Important correlation fields:

- `requestId`;
- `jobId`;
- `tenantId`;
- `visitId`;
- `errorCode`;
- `statusCode`;
- `path`.

## Health Check

Configure the production uptime check against:

```text
GET https://<api-domain>/api/health
```

Expected healthy response:

```json
{
  "status": "ok",
  "database": "ok"
}
```

The health endpoint checks database connectivity. If it fails, treat the incident as API and database-impacting until proven otherwise.

## Incident Response Checklist

1. Open an incident record with timestamp, alert source and affected environment.
2. Confirm whether the issue is tenant-visible.
3. Capture `requestId`, `jobId`, `tenantId`, release and service name.
4. Check recent deploys, environment variable changes and provider status pages.
5. For write/data issues, stop or pause the affected workflow before attempting repair.
6. Confirm whether manual fallback still works for report confirmation and imports.
7. Record mitigation, owner and follow-up action.

## Pilot Readiness Verification

Before launch, record evidence that:

- Sentry receives a test API error in `production` or production-like staging;
- Sentry receives a test frontend error from the deployed web app;
- `/api/health` uptime monitor alerts on a forced failure or synthetic failing check;
- log queries return `http_request`, `request_failed` and `ai_job_status` records;
- PostgreSQL backup alerts are enabled;
- Redis/provider alerts are enabled;
- operational owner receives primary and secondary notifications;
- restore drill is scheduled or completed according to `docs/runbooks/backup-restore.md`.

