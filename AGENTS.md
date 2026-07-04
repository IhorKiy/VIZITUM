# VIZITUM Agent Orientation

This file is the starting point for any coding agent working in this repository. It summarizes what VIZITUM is, where the product and delivery documentation lives, and what the current roadmap is.

## Project Summary

VIZITUM is a tenant-aware field operations product for the `Vizitum Team Pilot` MVP. The first product mode is `Team`: one tenant workspace, one or more Company Admins, one or more Team Managers with full tenant operational view, Field Representatives, simple routes, tasks, manager dashboard and pilot review.

The MVP is intended to move small and medium field teams from Excel, Google Sheets, Telegram or Viber into a single workflow:

- import users, locations, contacts, products/SKUs and initial visit/task plans;
- plan or create field visits;
- capture text or browser-recorded/uploaded audio notes;
- generate or manually confirm structured visit reports;
- create follow-up tasks;
- let managers review visits, tasks, coverage and pilot outcomes.

## Architecture Snapshot

- Backend: NestJS API in `src/`.
- Frontend: Next.js app in `apps/web/`.
- Database: PostgreSQL via Prisma in `prisma/`.
- Jobs/workers: cleanup worker entrypoint in `src/worker.ts`.
- Auth: tenant-aware backend sessions and invite links.
- Tenant model: shared DB for MVP; every tenant-owned query must use tenant context.
- Storage: S3-compatible abstraction, currently configured for Cloudflare R2 in staging.
- Observability: structured JSON logs, Sentry configuration, readiness and operations summary endpoints.

## Start Here

Read these documents first, in this order:

1. `docs/vizitum-action-plan.md` - main progress tracker and current roadmap.
2. `docs/reference/executable-spec.md` - tests mapped to implemented behavioral contracts.
3. `docs/reference/feature-spec-gates.md` - rules for when Track B-E work requires product-owner clarification.
4. `docs/role-based-screen-delivery-plan.md` - role-based screen delivery plan and P0/P1 screen sequence.
5. `docs/vizitum-mvp-product-spec-team-pilot.md` - product scope, roles, user stories, MVP screens and definition of done.
6. `docs/vizitum-low-level-technical-design.md` - tenant isolation, permissions, APIs, data model and operational design.
7. `docs/runbooks/staging-evidence-packet.md` - current staging evidence and known gaps.
8. `docs/runbooks/expanded-staging-product-smoke.md` - staging product smoke checklist.
9. `docs/runbooks/production-launch-readiness-record.md` - launch gate record.

## Documentation Map

Implemented-state reference (first stop for "how does X currently work" — reflects the code, unlike the design docs below which record design intent):

- `docs/reference/module-map.md` - backend modules, frontend routes and shared libs.
- `docs/reference/api-reference.md` - auth model, error envelope and all HTTP endpoints with permissions.
- `docs/reference/data-model.md` - implemented Prisma models and retention rules.
- `docs/reference/permissions.md` - role-permission matrix as enforced.
- `docs/reference/environment.md` - environment variables actually read by the code.
- `docs/reference/executable-spec.md` - behavior tests mapped to product/platform contracts.
- `docs/reference/feature-spec-gates.md` - Track B-E readiness gates and clarification rules.

Product and roadmap:

- `docs/vizitum-action-plan.md`
- `docs/role-based-screen-delivery-plan.md`
- `docs/vizitum-mvp-product-spec-team-pilot.md`
- `docs/vizitum-user-flows-horizontal-partition.md`
- `docs/ukraine-go-to-market-plan.md`
- `docs/pilot-ai-processing-addendum-flow.md`
- `docs/specs/onboarding-dataset-spec.md`
- `docs/specs/report-templates-spec.md`
- `docs/specs/ai-quality-spec.md`
- `docs/specs/pilot-readiness-spec.md`

Technical design:

- `docs/vizitum-high-level-technical-design.md`
- `docs/vizitum-low-level-technical-design.md`
- `docs/vizitum-technical-stack.md`

Operations and readiness:

- `docs/runbooks/production-deployment.md`
- `docs/runbooks/production-env-checklist.md`
- `docs/runbooks/production-ops-setup-guide.md`
- `docs/runbooks/production-alerts.md`
- `docs/runbooks/backup-restore.md`
- `docs/runbooks/restore-drill-record-template.md`
- `docs/runbooks/production-launch-readiness-record.md`
- `docs/runbooks/staging-evidence-packet.md`
- `docs/runbooks/staging-ux-review.md`
- `docs/runbooks/expanded-staging-product-smoke.md`
- `docs/runbooks/pilot-demo-script.md`
- `docs/runbooks/pilot-onboarding-checklist.md`
- `docs/runbooks/pilot-support-process.md`

## Current State

Staging baseline is validated. The following product flows have been implemented and smoked on staging:

- Field visit creation.
- Browser voice recording and audio upload fallback.
- Text/audio notes.
- Manual report confirmation.
- Admin CSV import template download, validation preview, row issues and confirm/apply.
- Manager dashboard, CSV export and task assignment.
- Permission-aware tenant navigation.
- Platform operations summary token path and `alerts:check` with `OPERATIONS_SUMMARY_URL`.

Provider evidence is recorded for Render, Vercel, Cloudflare R2, UptimeRobot and Sentry. Sentry is still partial until an actual staging event/release is visible.

Paid PostgreSQL backup/export/PITR and restore drill are intentionally deferred until the final production-pilot gate, not the current development phase.

## Roadmap

Current roadmap source of truth:

- `docs/vizitum-action-plan.md`
- `docs/role-based-screen-delivery-plan.md`

Near-term product track without paid infrastructure:

1. Use `docs/reference/feature-spec-gates.md` before implementing remaining Track B-E items.
2. Build remaining pilot data, report-template, AI-quality and pilot-readiness work from the matching `docs/specs/*` file.
3. Preserve executable behavior contracts listed in `docs/reference/executable-spec.md`.
4. Improve AI draft/error states while preserving manual report fallback.

Final gate before first production pilot:

1. Select or upgrade PostgreSQL with automated backups, export and restore support.
2. Run restore drill into a recovery database and attach evidence.
3. Create production services with separate database, Redis, R2 bucket, Sentry environment and uptime monitor.
4. Repeat expanded smoke checks against production.
5. Move production launch readiness from No-go to Go only after backup evidence, restore drill and production smoke pass.

## Important Commands

Use these from the repository root:

```sh
npm run format:check
npm run lint
npm run build
npm run test
npm run web:typecheck
npm run web:build
npm run alerts:check
npm run restore:drill:check
```

Local development:

```sh
npm run db:up
npm run prisma:migrate:dev
npm run dev
npm run web:dev
```

## Agent Working Rules

- Do not paste secrets into documentation or commits. `.env`, `.env.operations-staging` and provider tokens must stay local/ignored.
- Do not treat paid PostgreSQL backup setup as a current blocker; it is a final production-pilot gate.
- Preserve tenant isolation: never trust `tenantId` from request bodies and ensure tenant-owned data access uses request context.
- Keep navigation permission-aware. Users can have multiple roles, and screens should appear based on effective permissions.
- Team Manager full tenant view means operational read access, not Company Admin rights.
- Manual report confirmation must remain available whenever AI transcription/extraction is weak, delayed or unavailable.
- Treat `tests/` as executable specification. When changing behavior covered by `docs/reference/executable-spec.md`, read and update the matching tests.
- For Track B-E work, read `docs/reference/feature-spec-gates.md` and the matching `docs/specs/*` file. If a required behavior is still listed as an open product question, ask the product owner before coding.
- When adding a P0 screen, update `docs/role-based-screen-delivery-plan.md` and add/adjust the relevant smoke step in `docs/runbooks/expanded-staging-product-smoke.md`.
- When changing a controller, the Prisma schema, permissions or env vars, update the matching `docs/reference/*` document in the same change.
- Before committing, run the smallest relevant checks for the change. For docs-only changes, at least run `git diff --check`.
