# Vizitum Action Plan

This file tracks implementation progress for `Vizitum Team Pilot`.

Status legend:

- `[x]` done;
- `[~]` in progress;
- `[ ]` not started;
- `[!]` blocked or needs decision.

## 1. Product and Architecture Documentation

- [x] MVP product specification created: `docs/vizitum-mvp-product-spec-team-pilot.md`.
- [x] Role-based screen delivery plan created: `docs/role-based-screen-delivery-plan.md`.
- [x] User flows and hybrid tenancy model created: `docs/vizitum-user-flows-horizontal-partition.md`.
- [x] Recommended technical stack created: `docs/vizitum-technical-stack.md`.
- [x] High-level technical design created: `docs/vizitum-high-level-technical-design.md`.
- [x] HLD open questions resolved and converted into LLD decisions.
- [x] Raw audio/transcript retention decision finalized: audio, transcript and AI draft are temporary processing data only; after confirmation, only the confirmed report plus minimal processing metadata is retained.
- [x] Low-level technical design created: `docs/vizitum-low-level-technical-design.md`.

- [ ] **[audit F19, S4]** Fix three records that no longer describe the code. (a) `AGENTS.md`'s Documentation Map omits four files under `docs/plans/` — `dto-migration-tiers-4-6-plan-prompt.md`, `error-monitoring-sentry-plan-prompt.md`, `imports-dto-migration-note.md`, `visits-dto-migration-note.md` — so an agent reading only the map never learns the DTO decision notes exist. (b) `visits-dto-migration-note.md` still says "no code yet" although `visits.controller.ts` carries 11 validation pipes, one per gated body and the security plan records the work as shipped. (c) §7 below still claims a `provision` worker task that does not exist (`parseWorkerTask` accepts only `cleanup`/`purge`), contradicting `data-model.md`, which correctly calls provisioning legacy — check the other §5–§13 checkboxes for the same shape while fixing it. See `docs/plans/full-project-audit-plan.md` finding F19.

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
- [ ] **[audit F15, S4]** Extend the cross-workspace agreement test to the other four mirrored constants. `apps/web` cannot import from the backend, so `VISIT_DATE_BACKDATE_WINDOW_DAYS`, `VisitCancellationReason`, `resolveCookieName` and `PENDING_MEDIA_MAX_AGE_MS` each exist twice under a "keep in sync" comment with nothing enforcing it; only `INPUT_LIMITS` is pinned. All five agree today. `tests/input-limits.test.ts` is the pattern — it reads the web file as text and regex-parses it, for the reason stated in its own comment. Worst drift case is `resolveCookieName`: a diverged rule means the API sets one production cookie name while `apps/web` clears another, so logout leaves a live session. Also fix the stale pointer at `visits.service.ts:74` (names `field-db.ts`; the constant is in `offline-drafts.ts`). See `docs/plans/full-project-audit-plan.md` finding F15.
- [ ] **[audit F4, S3]** Bound the location-insights summary. `location-insights-summary.service.ts:41` reads every non-deleted location in the tenant with no `take` and returns the whole per-location array as `locations`, on an endpoint with no pagination parameter — the one `take`-less `findMany` in the backend whose row count grows with tenant age and is not otherwise bounded. The two lists derived from it are already `.slice(0, TOP_N)`-capped; the source array is not. Fine at pilot scale, unbounded by construction. See `docs/plans/full-project-audit-plan.md` finding F4.

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
- [ ] **[audit F7, S3]** Claim the password-reset token instead of updating it. `password-reset.service.ts:297-307` checks `usedAt` outside the transaction and `:352-356` spends the token with a plain `update({where:{id}})` that is not conditional on `usedAt` still being null — so two concurrent `POST /auth/password/reset` calls with the same token both commit and the last password wins. The window is unusually wide because argon2 hashing runs between the check and the transaction. Use the pattern `auth.service.ts:529` already uses for invite acceptance: `updateMany({where:{id, usedAt: null}})` and abort when zero rows are claimed. See `docs/plans/full-project-audit-plan.md` finding F7.

## 7. Tenant and Platform Backlog

- [x] Implement platform tenant creation service.
- [x] Implement tenant slug lookup.
- [x] Implement tenant status handling.
- [x] Implement tenant provisioning job record.
- [x] Seed initial roles/capabilities for `team` mode.
- [x] Add platform operation events.
- [x] Expose platform tenant HTTP API (`GET`/`POST /api/platform/tenants`, `GET /api/platform/tenants/:tenantId`) guarded by the platform bearer token (`platform.tenants.read`/`manage`).
- [x] Add platform-owner tenant console (`apps/web/app/platform/tenants`) with create form and registry list.
- [x] Add platform tenant creation behavior tests (`tests/platform-tenant-creation.test.ts`).
- [x] Add a session-based `platform_owner` identity (`PlatformUser`/`PlatformSession`, `POST /platform/auth/login`, console login/logout) and narrow the platform bearer token back to `platform.operations.read`.
- [x] Advance provisioning jobs beyond `queued`/`tenant_created` (`provision` worker task moves tenant `draft`→`ready`, job `queued`→`succeeded`).
- [x] Add tenant update/archive endpoints (`PATCH /api/platform/tenants/:tenantId`, `POST /api/platform/tenants/:tenantId/archive`) with console edit/archive actions.
- [x] Add platform-owner tenant user listing and invite creation from `/platform/tenants`, including first Company Admin invite flow and Company Admin suspend/reactivate actions with session revocation on suspend.
- [ ] **[audit F6, S3]** Decide, and write down, whether archiving a tenant needs the second factor purging it requires. `assertFreshSecondFactor` (`platform.service.ts:714`) has exactly one caller — `requestTenantPurge`. `archiveTenant` takes no `mfaCode`, yet it stops the tenant serving requests and revokes every user's session, so a stolen platform-owner session can take the whole customer base offline unchallenged. Archive is reversible and the precondition is a compromised owner session, so this is availability rather than data loss — but `docs/security-remediation-plan.md` records 1.3 as covering "destructive tenant operations" generically, which reads as broader than what shipped. See `docs/plans/full-project-audit-plan.md` finding F6.

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
- [ ] **[audit F18, S3]** Make deleting a product category safe. `product-categories.service.ts:185` deletes the dictionary row with no in-use check and no cascade, while `Product.category` is a free-text string with no FK — so every product keeps a category name that no longer exists, and since the filter's options come from `ProductCategory`, those products stop being filterable by their own category. The rename path in the same file already cascades via `product.updateMany` "to keep the catalog consistent", and the sibling `location-categories.deleteCategory` refuses an in-use delete. Pick either shape; doing neither is the gap. See `docs/plans/full-project-audit-plan.md` finding F18.
- [ ] **[audit F11, S3]** Map `P2002` in `locations` and `chains` — the two of five pre-checking services that don't. Both pre-check availability then write bare (`locations.service.ts:604`/`:162`/`:173`, `chains.service.ts:150`/`:176`/`:110`/`:120`), so a raced create — or an import confirming after someone took a validated code — returns a generic 500 instead of the 409 the pre-check exists to give, and rolls back the whole import with nothing naming the code. `products` and the two category services already do this correctly; `products.service.ts:100` states the rule verbatim. Fix together with F10 as one shared Prisma-constraint mapper — there are currently six local implementations and two services with none. Separately, note for anyone implementing **chain archiving**: `Chain`'s unique indexes are plain, not partial (unlike `Location`'s), so archiving would make this deterministic rather than a race. See `docs/plans/full-project-audit-plan.md` finding F11.
- [ ] **[audit F10, S3]** Map P2025 in `toSequenceConflictOrRethrow` (`routes.service.ts:521`). `reorderRouteItems` validates the permutation against a read taken outside its transaction, so a stop deleted in between makes `update({where:{id}})` raise P2025, which the mapper does not recognize and rethrows — the manager gets a 500 and Sentry records a server fault for a client-side race. The concurrent-*insert* variant of the same window is already handled gracefully as a 409 via the unique index; only the delete code is missing. Rolls back whole and the retry succeeds, so this is error handling rather than data safety. See `docs/plans/full-project-audit-plan.md` finding F10.

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
- [ ] **[audit F8, S2]** Make a large import applicable at all. `imports.service.ts:701` wraps the whole apply in `prisma.$transaction(fn)` with no options, so it inherits Prisma's 5 000 ms default, while every `apply*Import` is a per-row loop issuing 5–7 sequential queries. Nothing caps rows: `csvText` is bounded only by the 100 kB body limit, which at the sample pack's real 130-byte rows is ~790 locations ≈ 3 950 round trips needing <1.27 ms each. Confirm returns an opaque 500 (`P2028` → `INTERNAL_SERVER_ERROR`), rolls back cleanly and fails identically on retry, with no guidance to split the file — on the primary onboarding path. Fix is some combination of: raise `timeout`, batch the inserts (`createMany`, pre-resolved reference maps instead of per-row lookups), and cap rows with a real error message. Add a volume test — none of the nine `tests/import-*.test.ts` covers it. See `docs/plans/full-project-audit-plan.md` finding F8.

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
- [ ] **[audit F3, S3]** Decide the async AI pipeline's fate — it has no runner. `runTranscriptionJob`/`runExtractionJob` are called only from `tests/`; no controller and no `WORKER_TASK` mode invokes them, so a job created by `POST /visits/:visitId/ai/transcription-jobs` stays `queued` forever, `ai/extraction-jobs` always 400s `EXTRACTION_INPUT_INVALID`, and `ai/drafts/confirm` always 400s `AI_DRAFT_NOT_CONFIRMABLE`. No shipped journey hits this (the frontend uses the synchronous `ai/field-report-transcriptions`, and manual confirmation is independent), but `docs/reference/api-reference.md` documents all three as working. Either wire a runner or mark the three endpoints unimplemented in the reference. Queued rows are also outside `cleanupExpiredFailedAiJobs`, which filters on `status: "failed"`. See `docs/plans/full-project-audit-plan.md` finding F3.

## 11. Storage Backlog

- [x] Implement S3-compatible storage abstraction.
- [x] Configure Cloudflare R2 env handling.
- [x] Implement short-lived signed URL flow.
- [x] Implement storage object registry usage.
- [x] Implement cleanup worker for expired temporary objects.
- [ ] **[audit F9, S4]** Fix the stale comment in `src/modules/visits/visit-media-limits.ts:6-10`. It states the presigned PUT does not sign `Content-Length` and that the size cap is therefore only a claim — behaviour the security plan's item 3.2 closed. `storage.service.ts:80` always passes `contentLength` (`assertPresignableSize` throws rather than returning undefined), so `s3-storage.client.ts:206` always signs it, and that file's own comment says the opposite of this one. Understating a shipped control in the file that exists to explain it is how it gets removed later. See `docs/plans/full-project-audit-plan.md` finding F9.
- [ ] **[audit F2, S3]** Gate the S3 configuration at boot instead of at first upload. `storage.config.ts` checks only that `S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` are non-empty, and does it per request; a scheme-less endpoint therefore boots green, passes readiness and alerts, and 500s every audio/photo register call with `TypeError: Invalid URL`. Add them to `PRODUCTION_REQUIREMENTS` in `src/modules/auth/security-config.ts` and parse the endpoint there. See `docs/plans/full-project-audit-plan.md` finding F2.

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
- [ ] **[audit F20, S4]** Plan the three major-version upgrades: `cookie` 0.7.2 → 2.0.1, `ioredis` 5.11.1 → 6.0.0, `typescript` 6.0.3 → 7.0.2 (plus four patch/minor). No advisories are open, so nothing is urgent — but `audit:check` gates CI on advisory ids only, so drift accumulates invisibly until an advisory lands on the old line and the upgrade is no longer small. Do `cookie` first: it is imported by `src/common/cookie-token.ts` and parses an attacker-supplied header on the path every session and CSRF read goes through. See `docs/plans/full-project-audit-plan.md` finding F20.
- [ ] **[audit F12, S3]** Make an AI outage visible. `transcribeFieldReport` — the only AI path the product actually uses — catches provider failures and returns an empty form (correct, the manual fallback must hold), but logs at **info** level via `logger.log`, emits no `logJob`, and captures nothing to Sentry (`ai.service.ts:786`, `:823`). Meanwhile `/operations/summary`'s three AI metrics all count `AiJob` rows, which this path never writes — so the dashboard describes the pipeline from F3 that nothing runs and is blind to the live one. A total AI outage looks like a healthy quiet system until a pilot user complains. Log these at error level and give the summary a counter this path actually increments. See `docs/plans/full-project-audit-plan.md` finding F12.
- [ ] **[audit F5, S4]** Give soft-deletes an actor. No `deletedBy` column exists anywhere in `prisma/schema.prisma` (13 models carry `deletedAt`), and `locations`, `products` and `chains` emit no audit events — so archiving a location records when to the millisecond and who not at all. (Scope confirmed narrow: `TenantSetting` has `updatedByUserId`, `ImportJob` has `confirmedByUserId`, and a `Visit` carries its own authorship — those three modules need nothing.) `tasks.service.ts`'s `deleteTask` is the pattern to copy: it stamps `deletedAt` and writes a `task.deleted` audit event in one transaction. Recoverable, so this is forensics rather than data loss, but inconsistent with the care taken over auth, platform, task and user events. Decide alongside it whether `AuditService`'s free-form `entityType`/`eventType` strings should become a typed union — today nothing could have flagged the gap. See `docs/plans/full-project-audit-plan.md` finding F5.

## 13. Frontend Backlog

- [x] Create Next.js frontend shell.
- [x] Add tenant-aware routing.
- [x] Add role-based navigation.
- [x] Add tenant-aware login page connected to backend session login.
- [x] Add tenant invite acceptance page connected to backend invite flow.
- [x] Add mobile-first field flow shell.
- [x] Add Company Admin onboarding/import shell.
- [x] Add Company Admin onboarding checklist screen with live setup progress.
- [x] Add Company Admin users screen for list, invite, status update and role assignment.
- [x] Add Company Admin pilot review summary screen with success thresholds and copyable summary.
- [x] Add Team Manager dashboard shell.
- [x] Add shared server-side API client for Next.js frontend.
- [x] Connect field visits page to authenticated session and visits API with demo fallback.
- [x] Connect Field page new visit creation to backend visits endpoint.
- [x] Connect Field page text notes to backend visit notes endpoint.
- [x] Connect Field page voice note upload fallback to backend audio registration flow.
- [x] Add browser voice recording control to Field page audio upload flow.
- [x] Connect Field page manual report confirmation to backend reports endpoint.
- [x] Add Field page compact location cards and own task status update panel.
- [x] Add real location summaries to Task API and field/manager task lists.
- [x] Add Field AI draft state messaging, weak-output guidance and manual fallback copy.
- [x] Align Field and Manager report UI with first-pilot AI quality categories.
- [x] Add Field visit history with own-scope status/date filters.
- [x] Connect admin import templates page to imports API with demo fallback.
- [x] Connect admin CSV import validation and confirm flow to backend imports endpoints.
- [x] Show admin import row-level validation issues before confirmation.
- [x] Connect Team Manager dashboard to live route, visit and task metrics.
- [x] Connect Team Manager task assignment and dashboard CSV export controls.
- [x] Add Team Manager visits drilldown with status filters and tenant visit table.
- [x] Add Team Manager visit report detail view backed by reports read permissions.
- [x] Add Team Manager tasks drilldown with status/priority filters and status update controls.
- [x] Add Team Manager location coverage browser with read-only location filters and visit/task drilldown links.
- [x] Add Team Manager representative workload drilldown with operational route/visit/task summaries.
- [x] Connect Platform Operations page to operations summary API with demo fallback.
- [x] Disable demo fallback by default in production frontend.
- [x] Disable unavailable assisted-pilot action controls.
- [x] Filter tenant navigation by authenticated session permissions.
- [x] Define production-critical alerts before pilot launch.
- [ ] **[audit F17, S4]** Carry the back origin on the location card's task deep link. `field/locations/[locationId]/page.tsx:627` links to `/field/tasks#task-<id>` without `withBackOrigin`, and `field/tasks/page.tsx:342` hardcodes its `BackLink` to the field home — the only hardcoded `BackLink` in the zone. So a rep who opens a task from a location card is returned to the field home instead of the location. Both `/field/locations/[^/]+$` (label "location") and `/field/tasks$` are already in `RETURNABLE_SCREENS`, and the same file already uses `withBackOrigin` twice — nothing new is needed. See `docs/plans/full-project-audit-plan.md` finding F17.
- [ ] **[audit F16, S4]** Delete 27 dead class selectors from `apps/web/app/globals.css` (599 defined, 27 referenced nowhere in `apps/web`, `src`, `tests` or `public/offline.html`). They cluster by superseded feature: the AI draft UI (`ai-draft-state`, `needs-review`, `field-ai-guidance` — residue of F3's runnerless pipeline), the setup checklist (4), import screens (3), and two dead generations of tab UI (`tab-switcher*`, `segmented*`). **Do not sweep this file naively** — 9 further candidates are alive through interpolation (`assortment-status-badge--${tone}`, `filter-pill--${tone}`, `is-${announcement.state}`), and `processing` is unprovable either way. No duplicated rules: 921 blocks, 921 distinct selectors. See `docs/plans/full-project-audit-plan.md` finding F16.
- [ ] **[audit F21, S3]** Stop reflecting `?message=` on the admin users screen. `admin/users/page.tsx:369` renders `pageState.message` — read straight off the URL, unvalidated — as the body of its danger notice, so a crafted link shows arbitrary text inside the app's own error frame on the most privileged tenant screen. Not XSS (React escapes it; `body` is a plain string), so the payload is unlinkified text and the victim must be an already-authenticated admin. Seven Server Actions in the same file write the API's error into the URL because a redirect loses in-memory state; carry a code instead, the way `lib/login-error.ts` already does with four known reasons. Note this is **not** closed by fixing F14 through translating the message. See `docs/plans/full-project-audit-plan.md` finding F21.
- [ ] **[audit F14, S3]** Render API errors through a code map, not the raw `message`. 25 sites across `admin/*`, `field/*`, `manager/*` and `operations` render `someResult.message` verbatim — the backend's English — directly beneath a next-intl-translated heading, so a Ukrainian tenant reads "Authentication is required." under a Ukrainian title. `web:i18n:check` cannot catch this (it scans for Cyrillic literals; these are English runtime values). `ApiResult` already carries `code`, and `apps/web/lib/login-error.ts` is the pattern to copy — map code → translated key, with a shared fallback. **Start with `field-visit-report-form.tsx:1320`**: it handles a *refused* confirm with `setError(sendOutcome.message || t("saveFailedError"))`, so the translated string is already there and is used only when the English one is empty — the highest-stakes message in the product, on a phone, one `||` from correct. See `docs/plans/full-project-audit-plan.md` finding F14.
- [ ] **[audit F13, S3]** Give the two unguarded field-zone submit buttons a pending state. `today-route-drag-list.tsx:484` (swipe "mark visited") and `location-notes-modal.tsx:101` (icon-only save) are raw `<button type="submit">` with no `disabled`, no spinner and no label change, so a tap produces no feedback and a slow connection invites a second one. A sweep found 10 hand-rolled submit buttons in total and **none** carries the `is-pending`/`aria-busy` pair `CLAUDE.md` requires of self-managed transitions — the other eight at least disable and swap their label; seven of those are the platform console. See `docs/plans/full-project-audit-plan.md` finding F13.
- [ ] **[audit F1, S3]** Stop computing `phoneCountryOptions()` inside a client render. `create-tenant-modal.tsx:156` calls it during its own `"use client"` render, so `Intl.DisplayNames` runs against Node's CLDR at SSR and the browser's at hydration; they disagree (`FK` → "Falkland Islands" vs "Falkland Islands (Islas Malvinas)") and React discards and re-renders the subtree on every visit to `/platform/tenants`. The sibling `phone-country-form.tsx` already does it right — compute on the server, pass as props. See `docs/plans/full-project-audit-plan.md` finding F1.

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
- [~] Paid PostgreSQL has been started for the final production-pilot gate; capture backup/export/restore evidence before marking this complete.
- [ ] Configure production alert rules in Sentry, hosting, PostgreSQL and Redis providers.
- [x] Implement platform operator bearer token path for operations summary endpoint checks.
- [x] Configure staging platform operator token and rerun `npm run alerts:check` with `OPERATIONS_SUMMARY_URL`.
- [x] Run product smoke checks against staging: login, tenant lookup, field flow, imports, manager dashboard and manual report confirmation work.
- [x] Rerun expanded staging product smoke with `docs/runbooks/expanded-staging-product-smoke.md` after self-serve Field, Admin import and Manager actions deploy. 2026-07-02 recheck passed Field recording/audio fallback, Admin import and Manager flows; 2026-07-03 P0 role-screen and post-deploy recovery/history/resend/filter re-smoke passed Admin setup/users/review, Manager visits/tasks and Field location/tasks/AI draft messaging.
- [x] Enter final production-pilot gate after paid PostgreSQL became available.
- [~] Capture paid PostgreSQL backup/export/restore evidence in `docs/runbooks/production-postgresql-evidence-2026-07-04.md`.
- [x] Add restore target setup instructions in `docs/runbooks/restore-target-setup.md`.
- [ ] Perform restore drill into staging/recovery database and complete `docs/runbooks/restore-drill-2026-07-04-production-pilot.md`.
- [ ] Create production services after backup evidence and restore drill are complete, then repeat smoke checks.

## 16. Next Plan

### Final pre-production execution

- [x] Capture provider evidence links/screenshots for the current staging baseline: Render API, Render cron, Vercel web, UptimeRobot, Cloudflare R2 and Sentry. Sentry remains partial until an actual staging event/release is visible.
- [ ] Follow `docs/runbooks/final-production-pilot-execution.md` for the ordered final gate.
- [ ] Capture paid PostgreSQL backup policy, latest backup, retention and restore path evidence in `docs/runbooks/production-postgresql-evidence-2026-07-04.md`.
- [ ] Configure production-critical alert rules: Sentry, hosting/uptime, PostgreSQL and Redis provider notifications.
- [x] Platform operations summary token path is implemented and verified on staging with `OPERATIONS_SUMMARY_URL`.
- [x] Review the staging UX after smoke pass and list any pilot-blocking product issues.
- [x] Prepare production env var checklist from the validated staging values, with production-specific names and buckets.
- [x] Rerun expanded staging product smoke with `docs/runbooks/expanded-staging-product-smoke.md` for field visit creation, browser voice recording, import validation/confirm, manager CSV export and manager task assignment. Field recording/audio fallback, Admin import and Manager flows passed on staging.
- [x] Rerun P0 role-screen staging smoke for Admin setup/users/review, Manager visits/tasks and Field location/tasks/AI draft messaging. Completed on 2026-07-03.
- [x] Run internal dogfood on the accepted P0 screen set with realistic planned visit, text note/manual fallback and manager follow-up scenarios.
- [x] Re-smoke Manager task assignment after the task option/counting fix deploys.
- [x] Re-smoke cancelled-task filtering after deploy.
- [x] Re-smoke pending/disabled submit states, Field audio recovery links, Admin import recovery/history, Admin invite history/resend and Manager route/representative/assignee/date filters after deploy. Completed staging re-smoke on 2026-07-03; only the approved invite/resend mutation for `kiyanichenko81@gmail.com` was repeated.
- [x] Re-smoke P1 read-only/filter screens on staging: Field visit history status/date filters and empty state, Manager coverage filters/row links/empty state, Manager representative filters/row links/empty state, Admin settings read-only load, Admin locations read-only load/filter/empty state and Admin products empty state. Completed on 2026-07-04 with no demo fallback or browser console errors; Admin settings/location save mutations and Admin products toggle remain a controlled follow-up.

### Final gate before production pilot

- [~] Upgrade/select PostgreSQL with automated backups and export/restore support.
- [ ] Run restore drill into a recovery database and attach evidence to `docs/runbooks/restore-drill-record-template.md`.
- [ ] Create production services with separate DB, Redis, R2 bucket, Sentry environment and uptime monitor.
- [ ] Repeat smoke checks against production: login, tenant lookup, field flow, imports, manager dashboard and manual report confirmation.
- [ ] Update `docs/runbooks/production-launch-readiness-record.md` from No-go to Go only after backup evidence, restore drill and production smoke checks pass.

## 17. Product Development Roadmap After Staging Baseline

### Specification guardrails for Track B-E

- [x] Add executable specification map for `tests/` so thin implemented behavior is discoverable before new coding work.
- [x] Add feature specification gates for Track B-E to separate executable contracts, documented decisions, open product questions and deferred work.
- [x] Add draft spec files for onboarding datasets, report templates, AI quality and pilot readiness.
- [x] Resolve product-owner open questions in `docs/specs/onboarding-dataset-spec.md` before expanding onboarding dataset behavior.
- [x] Resolve product-owner open questions in `docs/specs/report-templates-spec.md` before changing report template fields or editable template settings.
- [x] Resolve product-owner open questions in `docs/specs/ai-quality-spec.md` before adding AI quality scoring, anonymized examples or weak-output criteria.
- [x] Resolve product-owner open questions in `docs/specs/pilot-readiness-spec.md` before changing pilot readiness metrics, support process or tenant-level pilot settings.

### Track A: Pilot usability polish

- [x] Create role-based screen delivery plan for Team Pilot MVP screens.
- [x] Add Company Admin onboarding checklist screen for setup progress and pilot readiness.
- [x] Add Field location cards and own task panel to the mobile-first Field workspace.
- [x] Add Field AI draft state and weak-output messaging while keeping manual fallback prominent.
- [x] Run a short internal dogfood cycle with realistic field scenarios: planned visit, text note/manual fallback and manager follow-up task. Audio fallback remains covered by the earlier staging smoke.
- [x] Capture friction points from the dogfood cycle in `docs/runbooks/staging-ux-review.md`.
- [x] Improve Manager dashboard task assignment options and open-task counting from dogfood findings.
- [x] Filter cancelled tasks out of Field actionable tasks and Manager attention queue.
- [x] Add pending/disabled submit states for high-risk Field and Manager forms.
- [x] Add pending/disabled submit states for Admin import validation/confirm forms.
- [x] Improve empty states and avoid demo-looking fallback for empty live Field and Manager lists.
- [x] Improve Admin users and Manager drilldown empty states, filter context and pending submit states.
- [x] Improve remaining loading/error copy on Field, Admin imports and Manager dashboard screens. Added recovery action links for Field audio, Admin import errors and Manager task creation notices; staging re-smoke is required after deploy.
- [x] Add clearer success states and recovery guidance for audio upload/transcription failures. Field audio success/error notices now keep manual fallback and retry paths visible.
- [x] Review mobile layout on common field-device widths before each pilot candidate build. Local mobile smoke at 390px confirmed no horizontal overflow on Field audio, Admin import and Manager task notices.

### Track B: Pilot data model completeness

- [x] Finalize the minimum customer onboarding dataset: users, locations, contacts, products/SKUs and initial route/task plan.
- [x] Add sample customer import packs for demo/pilot preparation without exposing real customer data.
- [x] Define the first pilot reporting templates for distribution, service and partner-account visit types. Resolved via `docs/specs/report-templates-spec.md` and implemented in `src/modules/ai/ai-extraction.schemas.ts` (verified against `tests/ai-extraction-schemas.test.ts`).
- [x] Review which report fields must be structured versus free-text before the first pilot. Decision recorded in `docs/specs/report-templates-spec.md` (structured common/template-specific fields vs. free-text summary/notes); Manager report detail view now also surfaces the actual created `Task` records (`createdTaskCount`/`createdTasks`) alongside the draft `tasksToCreate`, closing the one gap found against that spec's minimum field list. Follow-up code review (2026-07-04) found `POST /ai/drafts/confirm` returned a narrower, incompatible `report` shape missing these same fields; unified both endpoints on one `ReportResponse` type and a shared `src/modules/visits/report-response.util.ts` helper (also removing the duplicated `task.findMany` query that existed in three places).

### Track C: Manager and admin workflows

- [x] Add Company Admin users screen for user list, invite creation, suspend/reactivate and role assignment. Correctness audit (2026-07-04) found the backend had no guard against removing a tenant's last active `company_admin` or leaving a user with zero roles, which could lock a tenant out of admin functions via a direct API call; fixed in `src/modules/users/users.service.ts` (`assertOtherActiveCompanyAdminExists`, last-role check) and pinned by `tests/users-service.test.ts`. Suspend/reactivate, invite resend/expiry and role-assignment permission gating were verified solid, no changes needed there. Follow-up code review (2026-07-04) found the check-then-act guard had a race window between concurrent requests; `updateUser`/`removeRole` now run under a serializable `$transaction` to close it, pinned by an additional test.
- [x] Add initial manager visit/task drilldowns with visit status filters and task status/priority filters.
- [x] Add pending/disabled controls to Admin user lifecycle actions and clear filtered-empty recovery on Manager visits/tasks.
- [x] Add manager route, representative/assignee and date range filters to visits/tasks drilldowns. Correctness audit (2026-07-04) found route/status/priority/date filter wiring solid end to end (no enum or field-mapping defects); one open product question surfaced, not a bug: a caller with only own-scope read permission who passes another user's `assignedToUserId`/`representativeUserId` silently gets their own results instead of a 403 — worth a decision on whether that should error instead.
- [x] Add admin review screens for import history and applied row counts. Implemented tenant-scoped import history on Admin imports; staging re-smoke is required after deploy. Correctness audit (2026-07-04) confirmed tenant isolation and all-or-nothing applied-row-count accuracy are solid; the only gap is test granularity (no dedicated test asserts cross-tenant import-history isolation the way `tests/auth-tenant-isolation.test.ts` does for other modules) — left as a minor follow-up, not a defect.
- [x] Expand user lifecycle controls with pending invite history, resend invite and invite expiry visibility. Implemented tenant-scoped invite history and fresh-token resend flow; staging re-smoke is required after deploy.
- [x] Add tenant-level settings for company name and time zone. Implemented via `src/modules/settings`; `docs/specs/pilot-readiness-spec.md` scopes first-pilot tenant settings to company name, time zone and products-applicable only — default route visibility and allowed report types are explicitly deferred past the first pilot, not a remaining gap. Correctness audit (2026-07-04) found the module had zero automated tests despite the implementation being solid (real IANA time zone validation, correct permission gating to `company_admin` only, correct persistence); added `tests/settings-service.test.ts` to close that executable-spec gap.

### Track D: AI reporting quality

- [~] Collect anonymized staging examples for each supported report type. Fixture format and synthetic anonymized starter examples exist in `tests/fixtures/ai-eval/` (one per template, anonymization pinned by `tests/ai-extraction-evaluation.test.ts`); real staging examples still need to be collected and anonymized per `docs/specs/ai-quality-spec.md` retention rules.
- [x] Evaluate AI extraction outputs against expected structured fields. Evaluation harness in `src/modules/ai/ai-extraction-evaluation.ts`: field-level scoring against answer keys from approved report-template fields, 80% pilot accuracy threshold from `docs/specs/ai-quality-spec.md`.
- [x] Add confidence/error states that let the field user confirm manually when AI output is weak. Weak-output criteria are now encoded server-side in `src/modules/ai/ai-draft-quality.ts` (missing required fields, empty summary, invalid result status, confidence < 0.6) and returned as `draftQuality` on successful extraction jobs; Field UI already shows the approved categorical states with manual fallback kept available. Follow-up code review (2026-07-04) found `draftQuality` only existed in the one-time job-run response with no way to read it again; added a `draftQuality` column to `AiJob` (migration `20260704115118_ai_job_draft_quality`) so it's persisted and returned on any later read of the same job.
- [x] Keep the manual report path as the reliable fallback for every pilot flow. Pinned by `tests/manual-report-after-ai-failure.test.ts`; weak-output classification never blocks manual confirmation.

### Track E: Commercial and pilot readiness

- [x] Add pilot review summary screen with usage metrics, threshold statuses and copyable review text.
- [x] Prepare pilot demo script based on the accepted staging smoke path: `docs/runbooks/pilot-demo-script.md`.
- [x] Create a one-page pilot onboarding checklist for a customer admin: `docs/runbooks/pilot-onboarding-checklist.md`.
- [x] Define pilot success metrics: visits completed, reports confirmed, manager follow-up tasks, import success rate, active Field Representative coverage and manager review usage. Implemented via `src/modules/pilot-review` (`GET /pilot-review/summary`) against the exact thresholds in `docs/specs/pilot-readiness-spec.md`; `admin/review/page.tsx` renders it and `POST /pilot-review/dashboard-views` (called from `/manager` and `/admin/review`) measures manager review usage.
- [x] Prepare support process for pilot week: incident contact, response window and issue triage labels: `docs/runbooks/pilot-support-process.md`.

### Field offline resilience

Not part of the original Track A-F list — added after field reps reported that 2-3 of roughly 15 daily locations have no usable connectivity (pharmacy basements, malls, villages), which made "offline" a working condition rather than a feature request. Full plan, current status and remaining gaps live in `docs/plans/offline-field-drafts-plan-prompt.md`; the shipped shape is documented in `docs/reference/module-map.md` and the contracts in `docs/reference/executable-spec.md`.

- [x] Phase 1 - nothing a rep produces offline is lost (PRs #140, #141, #143, hardened by #146). Three IndexedDB stores behind one shared connection (`apps/web/lib/field-db.ts`): typed report drafts, recorded/photographed bytes that never reached storage, and the send queue. A failed upload no longer throws the recording away, and a retry re-signs the same storage object instead of registering a second one - only a real ruling about the object counts as "gone", never a request that got no answer at all (`apps/web/lib/storage-retry.ts`).
- [x] Phase 2 - a confirmed report sends itself later (PRs #144, #145). `Report.clientRequestId` (`@@unique([tenantId, clientRequestId])`) makes `POST /visits/:visitId/reports/confirm` safe to repeat when the device could not hear the answer; the client-side outbox, its flush loop and the classification of what a failed send means live in `apps/web/lib/report-outbox*.ts` and `report-send-outcome.ts`. No Background Sync - iOS Safari does not implement it - so sending happens on app-open, tab-visible, the `online` event and a manual "send now".
- [x] Phase 3 (backend) - starting a visit is safe to retry (PRs #147, #151, #152, #155). `Visit.clientVisitId` is a device-minted id that doubles as a resolvable one, so a URL built with no signal keeps working after sync. The design work was the route-slot conflict rule: `Visit.routeItemId` is unique across every status, so a deferred start can arrive to find the stop taken - a replay returns the same visit, the rep's own still-open visit on that stop is adopted, a closed one is not (that would attach a fresh report to a finished visit) and a colleague's never is.
- [x] Storage cleanup defect found while investigating the above (PR #148): `temporary_audio`/`temporary_transcript` objects were never actually deleted from R2 by any code path, because the sweep required a status the field-report flow never set and the two writers that did set it excluded themselves from the sweep's own filter in the same update.
- [x] Phase 3 (frontend) - a visit can be started, worked on and cancelled with no signal at all (PRs #154, #156, both merged). `StartVisitControl` mints the client id and queues the create; `PendingVisitReport` renders a working report screen for a visit only the device knows about; `visit-start-outbox-flush.ts` rekeys the draft, pending media and any queued confirm onto the real id once it lands. Cancelling is two different operations for two different situations: a real visit's cancel now clears what was queued for it before the request goes out, and a start that never reached the server is a purely local delete with no request and no reason collected (`apps/web/lib/abandon-visit-start.ts`).
- [x] Cached route shell and a minimal service worker, so the field zone's pages themselves load with zero connectivity and not just the data on them (shipped, plus `apps/web/app/manifest.ts` and brand icons as a follow-up - the plan doc's "Also shipped" entry records the five deliberate scope calls). `apps/web/lib/route-snapshot.ts` holds today's rendered stops with pre-resolved display text; `apps/web/public/sw.js` serves `offline.html` for a failed field navigation and cache-first-serves `/_next/static/`. Deliberately no API response caching, since the on-device snapshot is the data cache and two caching layers with different invalidation is how offline apps rot.
- [~] Verify the whole story on a real phone (iOS Safari, airplane mode). **Partly run** - `docs/runbooks/field-offline-iphone-test.md` is the record (iOS 18.7.9, Home Screen install, 2026-08-03): T1-T5 and T7 ran, T6 and T8-T12 did not. Everything built to keep work *safe* held on the device - the queues survived app kills, an offline start self-healed in one attempt with its offline `startedAt` preserved, and the draft rekey's forwarding address was observed working 17ms after the start resolved. Deliberately still open rather than ticked: two of what it covered failed, and the runbook's own "Recording the result" step says not to tick a line reading "verify the whole story" off a partial run with open failures. Remaining scenarios need a person with the phone; run them screen-first per the runbook's method note.
- [ ] Close or consciously accept the reachability finding that pass produced: **no navigation completes without a network on iOS**, so starting a visit, continuing one and saving a report all land on the offline shell instead of their screen. The data layer is unaffected (nothing was lost or duplicated in five scenarios) - a rep who keeps a screen open can work it, but one who arrives with the app closed cannot reach the work at all. The related cold-start failure (T2b) is **withdrawn rather than fixable**: WebKit fails the launch navigation before the service worker is consulted, so nothing in this repo reaches it, and the claim has been removed from the plan doc, module map and `sw.js`. The emulated coverage could not have caught either - `field-offline-shell.spec.ts` drives an already-loaded context, which is exactly the state that works. This, not the storage layer, is what now gates calling the offline story release-ready.

### Efforts completed outside the Track A-F list

Each of these ran as its own multi-PR effort with its own plan document and is
listed in `AGENTS.md`'s documentation map. They are recorded here because this
file is the roadmap source of truth, and a tracker that omits finished work
reads as though it were still outstanding.

- [x] Internationalize the web frontend with next-intl, tenant-driven locale (`docs/plans/i18n-next-intl-plan-prompt.md`). `apps/web/messages/{en,uk}.json` with a real Ukrainian translation, locale resolved per request from the tenant's `language`, and `npm run web:i18n:check` in CI failing on Cyrillic literals outside `messages/`. Tenant language is editable from the platform console (`platform/tenants/language-form.tsx`) and accepted by the tenant settings PATCH; there is deliberately no tenant-admin-facing selector, which the plan's own item 6 allowed for ("and/or").
- [x] Two-stage tenant deletion - archive, retention window, background purge (`docs/plans/tenant-purge-plan-prompt.md`). `src/modules/platform/tenant-purge.service.ts` plus `POST /platform/tenants/:tenantId/purge`, which additionally requires a fresh authenticator code (PR #189).
- [x] Tenant Superadmin role and delegated admin management (`docs/plans/tenant-superadmin-plan-prompt.md`). `tenant_superadmin` in `RoleCode` and the permission matrix, with its own platform-owner-facing controller.
- [x] Class-validator DTO migration, all six tiers (`docs/plans/dto-migration-tiers-4-6-plan-prompt.md`, plus the two design notes beside it). Closed by PRs #228-#230; `api-reference.md` carries the route-by-route table. The track's own follow-up list is what surfaced the `GET /routes` team-scope bug fixed since.
- [x] Error monitoring gaps closed (`docs/plans/error-monitoring-sentry-plan-prompt.md`): the web frontend reports (`apps/web/lib/error-reporting.ts`, `components/error-monitor.tsx`), the worker reports its failures, and backend stack frames now carry `filename`/`lineno` instead of raw lines.
- [x] Security remediation waves 1-3 (`docs/security-remediation-plan.md`, status line dated 2026-08-03).

### Track F: Final production-pilot gate

- [~] Select or upgrade PostgreSQL with automated backups, export and restore support.
- [ ] Run restore drill into a recovery database and attach evidence to `docs/runbooks/restore-drill-record-template.md`.
- [ ] Create production services with separate database, Redis, R2 bucket, Sentry environment and uptime monitor.
- [ ] Repeat expanded smoke checks against production.
- [ ] Move `docs/runbooks/production-launch-readiness-record.md` from No-go to Go only after backup evidence, restore drill and production smoke checks pass.
