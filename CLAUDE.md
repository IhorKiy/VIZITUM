# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repository also has an [AGENTS.md](AGENTS.md) with the full product/roadmap orientation for any coding agent (start there for product context, documentation map and current roadmap). This file focuses on day-to-day commands and code architecture.

## Commands

Backend (NestJS, root workspace):

```sh
npm run dev                 # node --watch --require ts-node/register src/main.ts
npm run build                # tsc -p tsconfig.json (runs prisma:generate first via prebuild)
npm run start                # node dist/main.js
npm run lint                  # eslint src apps/web prisma.config.ts --max-warnings 0
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
npm run web:e2e               # Playwright e2e (apps/web/e2e); boots API+web on 4100/3100
```

`web:e2e` needs the local Postgres up and a one-time `npx playwright install chromium`; it seeds the platform owner itself (global setup) and starts both servers on E2E-only ports, so it can run next to dev servers and worktree slots. Override ports with `E2E_API_PORT`/`E2E_WEB_PORT` if 4100/3100 are taken.

`apps/web/next-env.d.ts` is generated, gitignored and absent from a fresh checkout — don't add it back. Next rewrites it on every run to point at the dist dir of the command that ran (`next dev` → `.next/dev/types/*`, `next build` → `.next/types/*`), so tracking it meant whichever ran last left the tree dirty and `format:check` flagged a file nobody edited. `web:typecheck` runs `next typegen` first so it regenerates the file and the route types before `tsc` sees them; any of dev, build or typecheck restores it if it goes missing.

Worker and ops:

```sh
npm run worker:cleanup         # local cleanup worker (ts-node)
npm run worker:cleanup:prod    # compiled worker (node dist/worker.js)
npm run audit:check            # fails on any high/critical advisory not on the reviewed list (runs in CI)
npm run auth:trail             # reads the sign-in trail; counts only, no addresses (--days N)
npm run alerts:check           # scripts/production-alerts-check.mjs, needs OPERATIONS_SUMMARY_URL
npm run restore:drill:check
npm run seed:staging-admin
```

## Architecture

**Two workspaces in one repo**: root is the NestJS API (`src/`), `apps/web` is a separate npm workspace holding the Next.js frontend. They are built/run independently (`npm run build` vs `npm run web:build`) but share the same repo and docs.

**Implemented-state reference docs** live in `docs/reference/`: [module-map.md](docs/reference/module-map.md) (modules, frontend routes), [api-reference.md](docs/reference/api-reference.md) (all endpoints with permissions), plus [data-model.md](docs/reference/data-model.md), [permissions.md](docs/reference/permissions.md) and [environment.md](docs/reference/environment.md). Check these before re-deriving how something works from code, and update them in the same change when you touch controllers, schema, permissions or env vars.

**Backend module layout** (`src/modules/*`): each feature is a self-contained Nest module (`*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.types.ts`). Key modules: `tenancy`, `auth`, `users`, `roles`, `settings`, `visits`, `tasks`, `locations`, `products`, `routes`, `imports`, `ai`, `storage`, `email`, `audit`, `operations`, `platform`, `health`, `prisma`.

**Tenancy is the load-bearing concern.** `src/modules/tenancy/request-context.ts` carries the resolved tenant through a request; `tenancy.service.ts` resolves it. Every module that touches tenant-owned data must read tenant id from this request context, never from a request body/param supplied by the client. This is the single most important invariant in the backend — see the "Agent Working Rules" section of [AGENTS.md](AGENTS.md) for the reasoning.

**Frontend routing mirrors tenancy**: `apps/web/app/(workspace)/[tenantSlug]/...` — every screen is nested under the tenant slug, then split by role area: `admin/`, `manager/`, `field/`, `operations/`, `invites/`, `login/`.

**Two root layouts**, as route groups whose names never appear in a URL. `app/(public)/` holds the signed-out pages (`/`, `/en`, `/sign-in`, `/en/sign-in`) under a root layout that reads nothing request-scoped, which is the only reason the two landings can be prerendered — next-intl's `getLocale()`/`getMessages()`/`getTimeZone()` reach `headers()` via `i18n/request.ts`, and one such read above a route makes every route under it a per-request render. `app/(workspace)/` holds `[tenantSlug]/**` and `platform/**` under the layout that resolves the tenant locale and mounts `NextIntlClientProvider`. Two things follow: the public group has **no** i18n provider, so a client component added there that calls `useTranslations` (`PendingSubmitButton` does, unconditionally) throws at render unless its page pins its own provider — both entry screens pin one carrying `common` alone; and moving between the groups is a full page load, not a client transition. When adding a page, put it in the group that matches what it needs, and check the build output still shows `○` for `/` and `/en` (`apps/web/e2e/public-entry.spec.ts` pins that all four public pages render at all).

**Frontend i18n (next-intl, tenant-driven)**: the UI locale comes from the tenant's `language` setting (resolved per request in `apps/web/i18n/request.ts` via the public `GET /tenants/:slug/locale` endpoint), never from the URL or browser. Every new user-visible string — including placeholders, `aria-label`s, `title`s and pending/toast texts — goes through the message dictionaries `apps/web/messages/{en,uk}.json` (`en` is canonical; `uk` must be a real translation, not a stub). Never hardcode UI literals in `apps/web/app/**`, `components/` or `lib/`; `npm run web:i18n:check` (also in CI) fails on Cyrillic literals outside `messages/`. Dates/numbers go through the next-intl formatters (`useFormatter`/`getFormatter` + `lib/format.ts`), which honor the tenant timezone. `platform/*` pages render in `en` by design; the marketing landing (`app/(public)/page.tsx` at `/` in `uk`, `app/(public)/en/page.tsx` at `/en` in `en`) is the one exception to the request-scoped locale — it pins its dictionary via a direct import.

**Field-zone links are plain anchors, not `next/link`.** `apps/web/public/sw.js` gates its offline fallback on `event.request.mode === "navigate"`: an `<a href>` produces a document navigation and reaches that branch, while a `next/link` click produces a client-side RSC fetch which does not, so converting a field-zone link stops a rep with no signal getting the cached shell on that tap. Nothing else catches it — typecheck, lint and the unit suite are indifferent, and `apps/web/e2e/field-offline-shell.spec.ts` stays green because it exercises a *reload*, which is a navigation whatever the links are made of. The shared `BackLink` is the sharpest case, since it is on every screen. `tests/web-field-zone-anchors.test.ts` pins it as an allowlist rather than a ban: the planning and task rebuilds already introduced eight `<Link>` uses in this zone, each named there with what it costs, so a ninth has to be argued rather than waved through. Note this is a *different* mechanism from the full page load between the two route groups described above — that one is about root layouts, and a reader who finds it while looking for this will be misled.

**Frontend back navigation**: a screen's "return to the previous screen" affordance is always the shared `BackLink` (`apps/web/components/back-link.tsx`) — a round icon-only link (`.back-link`) placed at the top-left, above the screen header, never a "Back to X" button in the header `toolbar` (toolbars are for real actions). Pass the destination `href` plus a translated `label` (used as `aria-label`/`title`, since the control carries no visible text); use `inline` only when the caller already positions it inside its own layout (`.location-detail-sections`, `.visit-report-header`, `.page-header--compact`). The field menu's screens (announcements, routes, locations, products, help) use that last one: `<header className="page-header page-header--compact">` holding an `inline` `BackLink` and the `h1`, and nothing else — no eyebrow, no description line. Those screens are lists, and the stacked header spent most of a phone's first screenful restating the menu entry the reader just tapped.

*Where* it goes is resolved from the opener, not hardcoded — see `apps/web/lib/back-navigation.ts`. A screen reachable from more than one place (the location card opens from today's route, the locations list and the route editor; the visit report from the location card, the field history and a location's own visit history) cannot name one destination without stranding every other journey. So the linking screen appends its own tenant-relative location with `withBackOrigin(href, backOrigin(path, filters))`, and the target resolves it with `resolveBackTarget(tenantSlug, from, fallback)`, whose `fallback` is the hierarchical parent used for deep links. Include the list's filter/pagination params in `backOrigin` so returning restores the state the user left; carry `from` through `extraParams` and every server-action redirect so a save doesn't reset the back link. `from` is checked against the `RETURNABLE_SCREENS` allowlist in that module — an unlisted, off-site or cross-tenant value silently falls back — and that same table supplies the `common.back.*` label, so the control always announces where it actually lands. The origin must also sit in the same zone as the `fallback` (that zone is read off the fallback href, so no call site declares it): the allowlist itself is global, and without that check a crafted `?from=/field/tasks` would make a manager screen advertise a field destination. All back labels live under `common.back`; don't add per-screen ones. `tests/web-back-navigation.test.ts` pins the resolution and rejection rules.

**Frontend input length limits**: every free-text `<input>`/`<textarea>` in `apps/web` sets `maxLength` from the shared `INPUT_LIMITS` map in `apps/web/lib/input-limits.ts`. When adding a new text field, reuse an existing key or add a new one with a reasonable cap — never leave a text field unbounded or hardcode a one-off number. Limits that mirror backend validation (e.g. location-insights comments at 500, voice hint at 2000) must stay in sync with the backend constants.

**Frontend pending states**: any button that submits a Server Action is the shared `PendingSubmitButton` (`apps/web/components/pending-submit-button.tsx`), never a raw `<button type="submit">` — it disables itself for the duration and swaps its content for `PendingLabel` (spinner + `pendingLabel`). Give it a `pendingLabel` naming *this* wait ("Signing in...", "Creating your account...") rather than letting it fall back to the generic `common.saving`; pass `null` on icon-only buttons, where the spinner alone is the state; and on controls whose label is the reader's answer to "which one did I just tap?" (the zone chooser and switchers) pass the label back unchanged so only the spinner appears. While pending the button also carries `is-pending` (which restores its own colours over the `:disabled` palette — busy and unavailable must not look alike) and `aria-busy`, since the spinner is `aria-hidden` and the callers above keep their label deliberately, so `disabled` alone would announce "unavailable" rather than "working". `ConfirmActionButton` does the same through its own `useTransition`. A component that runs an action outside a `<form>` (its own `useTransition`/`useState`) renders `PendingLabel` by hand and passes `is-pending`/`aria-busy` itself, as the field menu's sign-out does for its pre-submit drafts clear. Note that these delete/remove controls come in panel and modal twins (`location-potential-*`, `location-assortment-*`, `location-contacts-panel`) — a change to one has to hit all of them.

**Frontend portal mounting**: every component that gates a `createPortal` call behind a "has this hydrated yet" flag (`document.body` doesn't exist during SSR) uses the shared `useIsMounted` hook (`apps/web/lib/use-is-mounted.ts`, via `useSyncExternalStore`) — never a hand-rolled `useState(false)` + `useEffect(() => setMounted(true), [])` pair. The hand-rolled version calls `setState` synchronously inside an effect, which trips `react-hooks/set-state-in-effect` (apps/web-scoped in `eslint.config.mjs`); `useSyncExternalStore`'s equivalent transition happens inside React's own internals, invisible to the linter, with no change to when a portaled dialog actually becomes interactive.

**AI processing** (`src/modules/ai`) drives transcription/extraction of visit notes into structured reports, but manual report confirmation must always remain a working fallback path when AI is slow, weak or unavailable — this is a hard product requirement, not an implementation detail.

**Data layer**: PostgreSQL via Prisma (`prisma/schema.prisma`, migrations in `prisma/migrations`). `src/modules/prisma` wraps the Prisma client for DI into services.

**Storage**: `src/modules/storage` is an S3-compatible abstraction, currently pointed at Cloudflare R2 in staging — used for uploaded/recorded audio and CSV import files.

**Imports**: `src/modules/imports` handles CSV/XLSX ingestion (users, locations, contacts, products, visit/task plans) with a validate-preview-then-confirm flow; see `tests/import-*.test.ts` for the expected parsing/validation behavior.

**Tests**: plain Node test runner (`node --test`) with `tsx` for TS, files under `tests/*.test.ts`, one behavior per file (e.g. `tests/auth-tenant-isolation.test.ts`, `tests/ai-extraction-schemas.test.ts`). No separate test framework/config to reason about. Treat them as executable specification: [executable-spec.md](docs/reference/executable-spec.md) maps each test to the product/platform contract it pins — read the matching test before changing covered behavior.

## Worktree slots

Any worktree — the repo root or anything under `.claude/worktrees/` — may currently be sitting on a placeholder rather than a real task branch: either a generic reusable slot branch (currently `wt-1`..`wt-4` exist as such slots; check `git worktree list` for the live set) or plain `main` with nothing started yet. Don't assume the branch a session lands on is the right base for a new task just because it's checked out.

Before writing any code for a new task, in whichever worktree the session is running in: confirm the current branch is actually free to build on (`git status --short` clean, and no commits beyond what's already merged into `main` — check `gh pr view` if unsure rather than assuming) or is plain `main`. If it's not free — real unmerged or uncommitted work sits there — stop and ask; another task may already be in progress in that worktree. If it is free, sync (`git checkout main && git pull --ff-only`) and create a properly named branch (`fix/...` / `feat/...`) off latest `main` for the task, instead of committing onto a `wt-N` placeholder or directly onto `main`. Once the task's PR merges, delete the branch — the worktree is then free again for reuse.

### Running dev servers in worktree slots

Each `wt-N` slot has its own untracked `.env` with a fixed port scheme so parallel sessions don't collide: the API runs on `400N` (`PORT` in `.env`, picked up by `npm run dev` automatically) and the web app on `300N`. Next.js does **not** read `PORT` from env files, so start the frontend as `PORT=300N npm run web:dev`. `APP_BASE_URL`/`API_BASE_URL` in `.env` and `apps/web/.env.local` are pre-set to match the slot's ports, and `SESSION_COOKIE_NAME` is per-slot (browsers share localhost cookies across ports) — set it to the **same** value in both `.env` and `apps/web/.env.local`: the API names the cookie it sets from its own copy, and `apps/web` reads its own copy to know which cookie to clear on logout (they run as separate processes, so one can't read the other's environment). The repo root checkout keeps 3000/4000. If a slot's `.env` is missing, copy it from the root checkout and apply this scheme rather than inventing ports.

The preview harness (`.claude/launch.json`) assigns ports itself: `autoPort` injects a `PORT` env var that overrides `.env` (the configured port when free, otherwise a random free one). If the port it assigns the API differs from `API_BASE_URL` in `apps/web/.env.local`, update that file to the assigned port before starting the web preview.

Postgres and Redis are shared by all worktrees. Run `npm run db:up` **only from the repo root checkout** — running it from a worktree starts a second Postgres container that fights over port 5432 — and run `prisma:migrate:dev` in only one worktree at a time; parallel schema migrations onto the shared database break each other. Fresh worktrees have no `node_modules` of their own (Node silently resolves the root checkout's instead): run `npm ci && npx prisma generate` in the worktree before trusting its dev server.
