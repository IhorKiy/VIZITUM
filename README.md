# VIZITUM

VIZITUM is a tenant-aware field operations product (`Vizitum Team Pilot` MVP). It moves small and medium field teams from Excel/Sheets/Telegram into a single workflow: import users, locations, contacts, products and plans; plan field visits; capture text or voice notes; generate or manually confirm structured visit reports; create follow-up tasks; and give managers a review dashboard.

## Repository layout

Two npm workspaces in one repo:

- `src/` — NestJS API (root workspace). Feature modules under `src/modules/`, cleanup worker in `src/worker.ts`.
- `apps/web/` — Next.js frontend. All screens live under the tenant slug: `apps/web/app/[tenantSlug]/...`.
- `prisma/` — PostgreSQL schema and migrations (Prisma).
- `docs/` — product, design, reference docs and operations runbooks.
- `tests/` — plain `node --test` behavior tests.

## Quickstart

```sh
npm install
cp .env.example .env        # fill in local values
npm run db:up               # local Postgres + Redis via docker-compose
npm run prisma:migrate:dev
npm run dev                 # API on :4000 (prefix /api)
npm run web:dev             # web on :3000 (run from repo root)
```

Checks: `npm run lint`, `npm run test`, `npm run build`, `npm run web:typecheck`, `npm run web:build`.

## Documentation

- [AGENTS.md](AGENTS.md) — start here: product summary, documentation map, current state, roadmap and working rules.
- [CLAUDE.md](CLAUDE.md) — day-to-day commands and code architecture notes.
- [docs/reference/](docs/reference/module-map.md) — implemented-state reference: [module map](docs/reference/module-map.md), [API reference](docs/reference/api-reference.md), [data model](docs/reference/data-model.md), [permissions](docs/reference/permissions.md), [environment variables](docs/reference/environment.md).
- `docs/runbooks/` — deployment, alerts, backup/restore and staging evidence.

## Key invariants

- **Tenant isolation**: tenant id always comes from the server-side request context, never from client input.
- **Manual report confirmation** must always work when AI transcription/extraction is slow, weak or unavailable.
- **Permission-aware navigation**: users can hold multiple roles; screens appear based on effective permissions.
