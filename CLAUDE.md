# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repository also has an [AGENTS.md](AGENTS.md) with the full product/roadmap orientation for any coding agent (start there for product context, documentation map and current roadmap). This file focuses on day-to-day commands and code architecture.

## Commands

Backend (NestJS, root workspace):

```sh
npm run dev                 # node --watch --require ts-node/register src/main.ts
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

`npm run dev` and the local workers run through `ts-node`, not `tsx`: `tsx` (esbuild) never emits the `design:paramtypes` metadata NestJS's DI relies on, so every constructor-injected dependency silently resolves to `undefined` at runtime (routes still register, but every handler throws). Tests are unaffected since they instantiate services directly with `new`, bypassing Nest DI. `tsx` remains fine for the test runner and for anything that doesn't boot a full Nest app.

Database (Prisma + local Postgres via docker-compose):

```sh
npm run db:up / db:down / db:logs
npm run prisma:migrate:dev
npm run prisma:migrate:deploy
npm run prisma:studio
npm run dev:bootstrap  # db:up + prisma:migrate:deploy + seed:platform-owner in one shot
```

Frontend (Next.js app, `apps/web`, run from repo root):

```sh
npm run web:dev
npm run web:build
npm run web:typecheck
npm run web:i18n:check        # fails on Cyrillic literals outside apps/web/messages/
```

Worker and ops:

```sh
npm run worker:cleanup         # local cleanup worker (ts-node)
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

**Frontend i18n (next-intl, tenant-driven)**: the UI locale comes from the tenant's `language` setting (resolved per request in `apps/web/i18n/request.ts` via the public `GET /tenants/:slug/locale` endpoint), never from the URL or browser. Every new user-visible string — including placeholders, `aria-label`s, `title`s and pending/toast texts — goes through the message dictionaries `apps/web/messages/{en,uk}.json` (`en` is canonical; `uk` must be a real translation, not a stub). Never hardcode UI literals in `apps/web/app/**`, `components/` or `lib/`; `npm run web:i18n:check` (also in CI) fails on Cyrillic literals outside `messages/`. Dates/numbers go through the next-intl formatters (`useFormatter`/`getFormatter` + `lib/format.ts`), which honor the tenant timezone. `platform/*` and root pages render in `en` by design.

**AI processing** (`src/modules/ai`) drives transcription/extraction of visit notes into structured reports, but manual report confirmation must always remain a working fallback path when AI is slow, weak or unavailable — this is a hard product requirement, not an implementation detail.

**Data layer**: PostgreSQL via Prisma (`prisma/schema.prisma`, migrations in `prisma/migrations`). `src/modules/prisma` wraps the Prisma client for DI into services.

**Storage**: `src/modules/storage` is an S3-compatible abstraction, currently pointed at Cloudflare R2 in staging — used for uploaded/recorded audio and CSV import files.

**Imports**: `src/modules/imports` handles CSV/XLSX ingestion (users, locations, contacts, products, visit/task plans) with a validate-preview-then-confirm flow; see `tests/import-*.test.ts` for the expected parsing/validation behavior.

**Tests**: plain Node test runner (`node --test`) with `tsx` for TS, files under `tests/*.test.ts`, one behavior per file (e.g. `tests/auth-tenant-isolation.test.ts`, `tests/ai-extraction-schemas.test.ts`). No separate test framework/config to reason about. Treat them as executable specification: [executable-spec.md](docs/reference/executable-spec.md) maps each test to the product/platform contract it pins — read the matching test before changing covered behavior.

## Worktree slots

Any worktree — the repo root or anything under `.claude/worktrees/` — may currently be sitting on a placeholder rather than a real task branch: either a generic reusable slot branch (currently `wt-1`..`wt-4` exist as such slots; check `git worktree list` for the live set) or plain `main` with nothing started yet. Don't assume the branch a session lands on is the right base for a new task just because it's checked out.

Before writing any code for a new task, in whichever worktree the session is running in: confirm the current branch is actually free to build on (`git status --short` clean, and no commits beyond what's already merged into `main` — check `gh pr view` if unsure rather than assuming) or is plain `main`. If it's not free — real unmerged or uncommitted work sits there — stop and ask; another task may already be in progress in that worktree. If it is free, sync (`git checkout main && git pull --ff-only`) and create a properly named branch (`fix/...` / `feat/...`) off latest `main` for the task, instead of committing onto a `wt-N` placeholder or directly onto `main`. Once the task's PR merges, delete the branch — the worktree is then free again for reuse.

### Running dev servers in worktree slots

Each `wt-N` slot has its own untracked `.env` with a fixed port scheme so parallel sessions don't collide: the API runs on `400N` (`PORT` in `.env`, picked up by `npm run dev` automatically) and the web app on `300N`. Next.js does **not** read `PORT` from env files, so start the frontend as `PORT=300N npm run web:dev`. `APP_BASE_URL`/`API_BASE_URL` in `.env` and `apps/web/.env.local` are pre-set to match the slot's ports, and `SESSION_COOKIE_NAME` is per-slot (browsers share localhost cookies across ports). The repo root checkout keeps 3000/4000. If a slot's `.env` is missing, copy it from the root checkout and apply this scheme rather than inventing ports.

The preview harness (`.claude/launch.json`) assigns ports itself: `autoPort` injects a `PORT` env var that overrides `.env` (the configured port when free, otherwise a random free one). If the port it assigns the API differs from `API_BASE_URL` in `apps/web/.env.local`, update that file to the assigned port before starting the web preview.

Postgres and Redis are shared by all worktrees. Run `npm run db:up` **only from the repo root checkout** — running it from a worktree starts a second Postgres container that fights over port 5432 — and run `prisma:migrate:dev` in only one worktree at a time; parallel schema migrations onto the shared database break each other. Fresh worktrees have no `node_modules` of their own (Node silently resolves the root checkout's instead): run `npm ci && npx prisma generate` in the worktree before trusting its dev server.
