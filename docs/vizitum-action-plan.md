# Vizitum Action Plan

This file tracks implementation progress for `Vizitum Team Pilot`.

Status legend:

- `[x]` done;
- `[~]` in progress;
- `[ ]` not started;
- `[!]` blocked or needs decision.

## 1. Product and Architecture Documentation

- [x] MVP product specification created: `docs/vizitum-mvp-product-spec-team-pilot.md`.
- [x] User flows and hybrid tenancy model created: `docs/vizitum-user-flows-horizontal-partition.md`.
- [x] Recommended technical stack created: `docs/vizitum-technical-stack.md`.
- [x] High-level technical design created: `docs/vizitum-high-level-technical-design.md`.
- [x] HLD open questions resolved and converted into LLD decisions.
- [x] Raw audio/transcript retention decision finalized: audio, transcript and AI draft are temporary processing data only; after confirmation, only the confirmed report plus minimal processing metadata is retained.
- [x] Low-level technical design created: `docs/vizitum-low-level-technical-design.md`.

## 2. Prisma and Database Foundation

- [x] Initial Prisma schema created: `prisma/schema.prisma`.
- [x] Prisma 7 config added: `prisma.config.ts`.
- [x] Prisma dependencies added: `prisma` and `@prisma/client`.
- [x] `@prisma/client` placed in runtime dependencies.
- [x] Local env template added: `.env.example`.
- [x] Local `.env` created for development and ignored by git.
- [x] Prisma validation script added.
- [x] Prisma generate script added.
- [x] Prisma schema validated successfully.
- [x] Prisma client generated successfully.
- [x] Local Postgres and Redis Docker setup added.
- [x] Docker fallback scripts added for environments without Docker Compose.
- [x] Local Postgres and Redis containers started and reported healthy.
- [x] Initial Prisma migration created and applied: `prisma/migrations/20260629101041_init/migration.sql`.

## 3. Current Working State

- [x] Migration files reviewed.
- [x] Foundation files committed.
- [~] Use this action plan as the running progress tracker.

## 4. Immediate Next Steps

- [x] Review initial migration SQL for table names, enum names, indexes and relation constraints.
- [x] Commit documentation, Prisma schema, config, Docker scripts and initial migration.
- [x] Create backend skeleton.
- [x] Add `PrismaService`.
- [x] Add health endpoint.
- [x] Add request ID middleware/interceptor.
- [x] Add tenant resolver foundation.
- [x] Add request context object.
- [x] Add permission constants and role-permission matrix in code.

## 5. Backend Foundation Backlog

- [x] Configure TypeScript backend project structure.
- [x] Configure linting and formatting.
- [x] Add NestJS app shell.
- [x] Add modules from LLD:
  - [x] `platform`;
  - [x] `auth`;
  - [x] `tenancy`;
  - [x] `users`;
  - [x] `roles`;
  - [x] `locations`;
  - [x] `products`;
  - [x] `routes`;
  - [x] `visits`;
  - [x] `tasks`;
  - [x] `imports`;
  - [x] `ai`;
  - [x] `storage`;
  - [x] `audit`;
  - [x] `operations`.
- [x] Add global API error format:
  - [x] `code`;
  - [x] `message`;
  - [x] optional `details`;
  - [x] optional `fieldErrors`;
  - [x] `requestId`.
- [x] Add standard paginated response contract.

## 6. Auth and Authorization Backlog

- [x] Implement session model usage.
- [x] Implement secure HTTP-only session cookie.
- [x] Implement login endpoint.
- [x] Implement logout/revoke endpoint.
- [x] Implement invite accept flow.
- [x] Implement CSRF protection for cookie-based write requests.
- [x] Implement permission guard.
- [x] Implement role switcher support.
- [x] Add tenant isolation tests for auth/session flows.

## 7. Tenant and Platform Backlog

- [x] Implement platform tenant creation service.
- [x] Implement tenant slug lookup.
- [x] Implement tenant status handling.
- [x] Implement tenant provisioning job record.
- [x] Seed initial roles/capabilities for `team` mode.
- [x] Add platform operation events.

## 8. Field Operations Backlog

- [x] Implement admin users list/invite/update/role endpoints.
- [x] Implement locations CRUD.
- [x] Implement contacts CRUD.
- [x] Implement location assignments.
- [x] Implement products/SKU CRUD.
- [x] Implement route plans.
- [x] Implement route items.
- [x] Implement visit creation.
- [x] Implement manual text report flow.
- [x] Implement task creation and updates.

## 9. Imports Backlog

- [x] Create downloadable import templates:
  - [x] users;
  - [x] locations;
  - [x] contacts;
  - [x] products;
  - [x] initial visit/task plan.
- [x] Implement `.xlsx` parser for approved templates.
- [x] Implement `.csv` fallback parser.
- [x] Implement import validation preview.
- [x] Implement row issue storage.
- [x] Implement all-or-nothing confirm/apply flow.

## 10. AI Reporting Backlog

- [x] Represent AI extraction schemas as JSON Schema or Zod schemas:
  - [x] `distribution`;
  - [x] `service`;
  - [x] `partner_account`.
- [x] Implement temporary audio upload registration.
- [x] Implement transcription job.
- [x] Implement extraction job.
- [x] Implement AI draft confirmation endpoint.
- [x] Implement cleanup of temporary audio/transcript/draft after confirmation.
- [x] Implement 24-hour retry-window cleanup for failed processing.

## 11. Storage Backlog

- [x] Implement S3-compatible storage abstraction.
- [x] Configure Cloudflare R2 env handling.
- [x] Implement short-lived signed URL flow.
- [x] Implement storage object registry usage.
- [x] Implement cleanup worker for expired temporary objects.

## 12. Observability and Operations Backlog

- [x] Add structured JSON logging.
- [x] Add Sentry configuration.
- [x] Add job ID/request ID correlation.
- [x] Add basic worker failure visibility.
- [x] Add production readiness endpoint for alert and restore-drill checks.
- [x] Add platform operations summary endpoint.
- [x] Add scheduled cleanup worker entrypoint.
- [x] Add production deployment runbook for API, web and cleanup worker.
- [x] Add production launch readiness record template.
- [x] Add backup/restore runbook.
- [x] Add production-critical alerts runbook and readiness checklist.
- [x] Add step-by-step production ops setup guide.
- [x] Add restore drill record template.
- [x] Add automated restore drill command checks.
- [x] Add restore drill wrapper check to CI.
- [x] Add production alerts endpoint verification command.
- [x] Configure staging API, web, PostgreSQL, Redis, R2, cleanup worker and uptime monitor.
- [x] Run staging `npm run alerts:check` for API readiness and web URL.
- [ ] Configure production alert rules in Sentry, hosting, PostgreSQL and Redis providers.
- [ ] Perform restore drill before production pilot.

## 13. Frontend Backlog

- [x] Create Next.js frontend shell.
- [x] Add tenant-aware routing.
- [x] Add role-based navigation.
- [x] Add tenant-aware login page connected to backend session login.
- [x] Add tenant invite acceptance page connected to backend invite flow.
- [x] Add mobile-first field flow shell.
- [x] Add Company Admin onboarding/import shell.
- [x] Add Team Manager dashboard shell.
- [x] Add shared server-side API client for Next.js frontend.
- [x] Connect field visits page to authenticated session and visits API with demo fallback.
- [x] Connect Field page new visit creation to backend visits endpoint.
- [x] Connect Field page text notes to backend visit notes endpoint.
- [x] Connect Field page voice note upload fallback to backend audio registration flow.
- [x] Add browser voice recording control to Field page audio upload flow.
- [x] Connect Field page manual report confirmation to backend reports endpoint.
- [x] Connect admin import templates page to imports API with demo fallback.
- [x] Connect admin CSV import validation and confirm flow to backend imports endpoints.
- [x] Show admin import row-level validation issues before confirmation.
- [x] Connect Team Manager dashboard to live route, visit and task metrics.
- [x] Connect Team Manager task assignment and dashboard CSV export controls.
- [x] Connect Platform Operations page to operations summary API with demo fallback.
- [x] Disable demo fallback by default in production frontend.
- [x] Disable unavailable assisted-pilot action controls.
- [x] Filter tenant navigation by authenticated session permissions.
- [x] Define production-critical alerts before pilot launch.

## 14. Release Readiness

- [x] Tenant isolation tests exist in CI.
- [x] Import failure cannot partially corrupt applied data.
- [x] Failed transcription/AI does not block manual report.
- [ ] Production-critical alerts configured.
- [x] Company-level DPA or AI processing addendum flow documented.
- [x] First-recording in-app notice implemented.

## 15. Remaining Ops Steps Before Production Pilot

- [x] Keep staging API, web, PostgreSQL, Redis, R2, cleanup worker and UptimeRobot monitor as the validated baseline.
- [~] Capture provider evidence links/screenshots for Render, Vercel, UptimeRobot, Cloudflare R2 and Sentry in the staging evidence packet.
- [!] Choose a PostgreSQL plan/provider with automated backups because Render Free Tier shows backups/export/PITR unavailable.
- [ ] Configure production alert rules in Sentry, hosting, PostgreSQL and Redis providers.
- [x] Implement platform operator bearer token path for operations summary endpoint checks.
- [ ] Configure platform operator token and rerun `npm run alerts:check` with `OPERATIONS_SUMMARY_URL`.
- [x] Run product smoke checks against staging: login, tenant lookup, field flow, imports, manager dashboard and manual report confirmation work.
- [x] Rerun expanded staging product smoke with `docs/runbooks/expanded-staging-product-smoke.md` after self-serve Field, Admin import and Manager actions deploy. 2026-07-02 recheck passed Field recording/audio fallback, Admin import and Manager flows.
- [ ] Defer paid PostgreSQL backup/restore setup until the final production-pilot gate.
- [ ] Perform restore drill into staging/recovery database and complete `docs/runbooks/restore-drill-record-template.md` after selecting a paid PostgreSQL plan/provider.
- [ ] Create production services only after backup evidence, restore drill and smoke checks are complete.

## 16. Next Plan

### Now, without paid infrastructure

- [~] Capture provider evidence links/screenshots for the current staging baseline: Render API, Render cron, Vercel web, UptimeRobot, Cloudflare R2 and Sentry.
- [ ] Configure production-critical alert rules where free tiers allow it: Sentry, UptimeRobot and hosting provider notifications.
- [~] Platform operations summary is useful but not launch-blocking for the pilot; token path is implemented, env configuration and `OPERATIONS_SUMMARY_URL` verification remain open.
- [x] Review the staging UX after smoke pass and list any pilot-blocking product issues.
- [x] Prepare production env var checklist from the validated staging values, with production-specific names and buckets.
- [x] Rerun expanded staging product smoke with `docs/runbooks/expanded-staging-product-smoke.md` for field visit creation, browser voice recording, import validation/confirm, manager CSV export and manager task assignment. Field recording/audio fallback, Admin import and Manager flows passed on staging.

### Final gate before production pilot

- [ ] Upgrade/select PostgreSQL with automated backups and export/restore support.
- [ ] Run restore drill into a recovery database and attach evidence to `docs/runbooks/restore-drill-record-template.md`.
- [ ] Create production services with separate DB, Redis, R2 bucket, Sentry environment and uptime monitor.
- [ ] Repeat smoke checks against production: login, tenant lookup, field flow, imports, manager dashboard and manual report confirmation.
- [ ] Update `docs/runbooks/production-launch-readiness-record.md` from No-go to Go only after backup evidence, restore drill and production smoke checks pass.
