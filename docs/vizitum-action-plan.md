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

- [ ] Add structured JSON logging.
- [ ] Add Sentry configuration.
- [ ] Add job ID/request ID correlation.
- [ ] Add basic worker failure visibility.
- [ ] Add backup/restore runbook.
- [ ] Perform restore drill before production pilot.

## 13. Frontend Backlog

- [ ] Create Next.js frontend shell.
- [ ] Add tenant-aware routing.
- [ ] Add role-based navigation.
- [ ] Add mobile-first field flow shell.
- [ ] Add Company Admin onboarding/import shell.
- [ ] Add Team Manager dashboard shell.

## 14. Release Readiness

- [ ] Tenant isolation tests exist in CI.
- [ ] Import failure cannot partially corrupt applied data.
- [ ] Failed transcription/AI does not block manual report.
- [ ] Production-critical alerts configured.
- [ ] Company-level DPA or AI processing addendum flow documented.
- [ ] First-recording in-app notice implemented.
