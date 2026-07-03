# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repository also has an [AGENTS.md](AGENTS.md) with the full product/roadmap orientation for any coding agent (start there for product context, documentation map and current roadmap). This file focuses on day-to-day commands and code architecture.

## Commands

Backend (NestJS, root workspace):

```sh
npm run dev                 # tsx watch src/main.ts
npm run build                # tsc -p tsconfig.json (runs prisma:generate first via prebuild)
npm run start                # node dist/main.js
npm run lint                  # eslint src prisma.config.ts
npm run format / format:check # prettier over src, apps/web, prisma.config.ts, etc.
npm run test                  # node --import tsx --test "tests/**/*.test.ts"
```

Run a single test file:

```sh
node --import tsx --test tests/auth-tenant-isolation.test.ts
```

Database (Prisma + local Postgres via docker-compose):

```sh
npm run db:up / db:down / db:logs
npm run prisma:migrate:dev
npm run prisma:migrate:deploy
npm run prisma:studio
```

Frontend (Next.js app, `apps/web`, run from repo root):

```sh
npm run web:dev
npm run web:build
npm run web:typecheck
```

Worker and ops:

```sh
npm run worker:cleanup         # local cleanup worker (tsx)
npm run worker:cleanup:prod    # compiled worker (node dist/worker.js)
npm run alerts:check           # scripts/production-alerts-check.mjs, needs OPERATIONS_SUMMARY_URL
npm run restore:drill:check
npm run seed:staging-admin
```

## Architecture

**Two workspaces in one repo**: root is the NestJS API (`src/`), `apps/web` is a separate npm workspace holding the Next.js frontend. They are built/run independently (`npm run build` vs `npm run web:build`) but share the same repo and docs.

**Implemented-state reference docs** live in `docs/reference/`: [module-map.md](docs/reference/module-map.md) (modules, frontend routes), [api-reference.md](docs/reference/api-reference.md) (all endpoints with permissions), plus [data-model.md](docs/reference/data-model.md), [permissions.md](docs/reference/permissions.md) and [environment.md](docs/reference/environment.md). Check these before re-deriving how something works from code, and update them in the same change when you touch controllers, schema, permissions or env vars.

**Backend module layout** (`src/modules/*`): each feature is a self-contained Nest module (`*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.types.ts`). Key modules: `tenancy`, `auth`, `users`, `roles`, `settings`, `visits`, `tasks`, `locations`, `products`, `routes`, `imports`, `ai`, `storage`, `audit`, `operations`, `platform`, `health`, `prisma`.

**Tenancy is the load-bearing concern.** `src/modules/tenancy/request-context.ts` carries the resolved tenant through a request; `tenancy.service.ts` resolves it. Every module that touches tenant-owned data must read tenant id from this request context, never from a request body/param supplied by the client. This is the single most important invariant in the backend — see the "Agent Working Rules" section of [AGENTS.md](AGENTS.md) for the reasoning.

**Frontend routing mirrors tenancy**: `apps/web/app/[tenantSlug]/...` — every screen is nested under the tenant slug, then split by role area: `admin/`, `manager/`, `field/`, `operations/`, `invites/`, `login/`.

**AI processing** (`src/modules/ai`) drives transcription/extraction of visit notes into structured reports, but manual report confirmation must always remain a working fallback path when AI is slow, weak or unavailable — this is a hard product requirement, not an implementation detail.

**Data layer**: PostgreSQL via Prisma (`prisma/schema.prisma`, migrations in `prisma/migrations`). `src/modules/prisma` wraps the Prisma client for DI into services.

**Storage**: `src/modules/storage` is an S3-compatible abstraction, currently pointed at Cloudflare R2 in staging — used for uploaded/recorded audio and CSV import files.

**Imports**: `src/modules/imports` handles CSV/XLSX ingestion (users, locations, contacts, products, visit/task plans) with a validate-preview-then-confirm flow; see `tests/import-*.test.ts` for the expected parsing/validation behavior.

**Tests**: plain Node test runner (`node --test`) with `tsx` for TS, files under `tests/*.test.ts`, one behavior per file (e.g. `tests/auth-tenant-isolation.test.ts`, `tests/ai-extraction-schemas.test.ts`). No separate test framework/config to reason about. Treat them as executable specification: [executable-spec.md](docs/reference/executable-spec.md) maps each test to the product/platform contract it pins — read the matching test before changing covered behavior.
