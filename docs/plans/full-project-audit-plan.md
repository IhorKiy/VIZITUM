# Full-Project Audit — Plan and Checklist

Status: not started · Opened: 2026-08-05 · Scope: NestJS API (`src/`), Next.js web (`apps/web`), Prisma schema and migrations, `scripts/`, tests, CI, reference docs and runbooks

## Purpose

Produce a **complete, evidence-backed inventory of defects and debt across the entire codebase**, so that decisions about what to fix before the production pilot are made from a full picture instead of from whatever happened to be noticed last.

This is deliberately not a review of a diff. `/code-review` and `/simplify` operate on `main...HEAD` plus uncommitted changes; they answer "is what I just wrote ready to merge?". Everything merged before today has never been looked at as a whole. That is what this document covers.

The audit is **done** when every checkbox below is either ticked or explicitly struck with a recorded reason, and every finding has landed in a backlog section of `docs/vizitum-action-plan.md`. A finished audit that lives only in this file has failed.

### What the codebase looks like right now

Measured 2026-08-05, for sizing and for detecting drift when this is re-run:

| | count |
|---|---|
| Backend modules (`src/modules/*`) | 24 |
| Backend controllers | 28 |
| Backend `*.service.ts` lines | ~20 800 |
| `src/**/*.ts` files | 207 |
| `apps/web/**/*.{ts,tsx}` files | 230 |
| Frontend `page.tsx` routes | 50 |
| Test files (`tests/*.test.ts`) | 173 |
| Playwright specs (`apps/web/e2e/*.spec.ts`) | 12 |
| Total lines, `src` + `apps/web` | ~80 600 |

That total counts `.ts`/`.tsx` only. Three things in scope sit outside it and are easy to forget for exactly that reason: `apps/web/app/globals.css` (7094 lines), `apps/web/public/sw.js` + `offline.html` (191 + 515) and the message dictionaries `apps/web/messages/{en,uk}.json` (1824 each). Each has its own checkbox in Pass 3.

### Known hotspots (size × churn)

Start here. Large code that also moves constantly is where defects and debt concentrate.

Churn is over the **repository's whole history** — first commit 2026-06-26, 356 commits. That is roughly six weeks, not the six-month window a mature repo's churn table would use, so read these counts as "how much this file has moved since the project began", and re-measure the window rather than the numbers when this table is refreshed.

Measured with `git log --follow --oneline -- '<file>' | wc -l`. The `--follow` matters: some of these files have been renamed (`manager/tasks/page.tsx` counts 27 with it, 1 without), so a plain `git log -- <file>` re-measurement will silently undercount and make the table look fabricated. Quote bracketed paths or use `:(literal)` so git doesn't treat `[tenantSlug]` as a glob.

| file | lines | commits (all history) |
|---|---|---|
| `apps/web/app/globals.css` | 7094 | 108 |
| `apps/web/messages/en.json` / `uk.json` | 1824 each | 90 each |
| `apps/web/lib/api-client.ts` | 2475 | 88 |
| `src/modules/visits/visits.service.ts` | 2218 | 35 |
| `apps/web/lib/navigation.ts` | 529 | 32 |
| `apps/web/app/(workspace)/[tenantSlug]/manager/tasks/page.tsx` | 1094 | 27 |
| `src/modules/auth/auth.service.ts` | 936 | 26 |
| `src/modules/imports/imports.service.ts` | 2683 | 21 |
| `apps/web/components/field-visit-report-form.tsx` | 2060 | 20 |

The two files at the top move constantly but are not where correctness defects live — `globals.css` is a stylesheet and the dictionaries are data. They are listed because their churn is otherwise unexplained, and because their *size* is a real S4 question (dead selectors, orphaned message keys). The code hotspots start at `api-client.ts`.

The four largest files — `imports.service.ts`, `api-client.ts`, `visits.service.ts`, `field-visit-report-form.tsx` — are ~9 400 lines between them, roughly 12% of the codebase in 4 files out of 437.

## Rules

These are non-negotiable. They exist because the usual failure mode of a big audit is a 200-item list of mixed-severity guesses that nobody can act on.

1. **The audit reads; it does not fix.** Record findings, do not repair them in the same pass. Fixes are separate branches and separate PRs, prioritized after the audit is complete. The one exception is the stop-the-line rule (#9).
2. **No finding without a concrete failure path.** Every finding names `file:line` and states inputs or state → wrong outcome. "This looks fragile", "this could be cleaner", "consider refactoring" are not findings and must not be recorded. If you cannot say what breaks, you have not finished investigating.
3. **Verify before recording.** Read the surrounding code and confirm the defect is reachable in practice — not guarded upstream, not dead code, not already handled by a caller. A plausible-but-wrong finding costs more than a missed one, because it burns trust in the whole list.
4. **Check the test first.** There are 173 test files and `docs/reference/executable-spec.md` maps each to the contract it pins. If a test already covers the behavior you think is broken, then either your finding is wrong or the test is — determine which and say so in the finding.
5. **Check the reference docs before re-deriving.** `docs/reference/` (`module-map`, `api-reference`, `data-model`, `permissions`, `environment`, `executable-spec`, `feature-spec-gates`) is implemented-state documentation. Use it as the map; where it disagrees with the code, that disagreement is itself an S4 finding.
6. **One module = one pass = one findings block.** Never audit "the backend" or "the frontend" in a single sitting. The unit of work is a module or a zone, sized so it fits in one focused pass.
7. **Do not re-audit closed security work.** `docs/security-remediation-plan.md` (waves 1–3 + the DTO migration, complete as of 2026-08-03) covers rate limiting, Turnstile, platform-owner hardening, security headers, CSRF, session TTL, upload caps, argon2 tuning and request-body validation. Read it before Pass 1 and skip what it closed. Its accepted risks are decisions, not findings — do not re-litigate them.
8. **Severity is assigned at record time**, from the fixed scale below. Anything touching tenant isolation is S1 by default; argue it down explicitly if you believe otherwise.
9. **Stop-the-line.** A *confirmed* S1 — cross-tenant data exposure, authentication or authorization bypass, or a data-loss path — suspends the audit. Fix it immediately as its own PR, then resume. Do not batch S1s.
10. **Record what was not checked.** Every pass ends by writing down what it deliberately skipped and why. A silent gap reads as "all clear" to whoever reads this next, which is worse than an open TODO.
11. **Findings land in the action plan.** `docs/vizitum-action-plan.md` already carries per-area backlogs (§5 Backend, §6 Auth, §7 Tenant/Platform, §8 Field Ops, §9 Imports, §10 AI, §11 Storage, §12 Observability, §13 Frontend). Each finding is added there under the matching section. This file tracks *coverage*; the action plan tracks *work*.

### Severity scale

| | meaning |
|---|---|
| **S1** | Cross-tenant data exposure, auth/authz bypass, data loss, or credential leak. Stop the line. |
| **S2** | Wrong data shown to the right tenant, permission gap inside a tenant, unrecoverable user dead-end, or a production-breaking performance cliff. |
| **S3** | Incorrect edge-case behavior, missing validation with bounded blast radius, N+1 on a hot path, missing error handling. |
| **S4** | Maintainability: duplication, dead code, oversized units, drifted documentation, missing test coverage. |

### Finding record format

```
### [S2] Manager visit list ignores representative scoping
- Where: src/modules/visits/visits.service.ts:412
- Failure: a team_manager calling GET /visits without repId receives visits for
  every representative in the tenant, not only their own team's.
- Evidence: findMany filters on tenantId only; no managerId/team join. No test
  in tests/ covers manager scoping for this endpoint.
- Filed: action-plan §8
```

## Method

Seven passes, in order. Passes 0 and 1 are global; 2–4 are the bulk and run module by module; 5–6 close the loop. Do not start Pass 2 before Pass 0 is green or explicitly waived — unresolved automated failures make every manual finding ambiguous.

---

## Pass 0 — Automated baseline

Free, objective signal. Everything here is machine-checkable, so no human judgment is spent on it.

> If this pass runs in a worktree slot rather than the repo root checkout: fresh worktrees have no `node_modules` of their own — run `npm ci && npx prisma generate` in the worktree first, or the results are not trustworthy. Do not run `npm ci` inside `apps/web`. Postgres and Redis are shared across all checkouts: bring them up with `npm run db:up` **from the repo root checkout only** — running it from a worktree starts a second container that fights over port 5432 and turns every database-backed result below into noise.

- [ ] `npm ci && npx prisma generate` in the checkout running the audit (mandatory in a fresh worktree slot)
- [ ] `npm run prisma:validate` — schema parses (first thing CI runs; a broken schema makes everything after it meaningless)
- [ ] `npm run lint` — zero warnings (`--max-warnings 0`)
- [ ] `npm run format:check` — Prettier clean (CI runs this separately from lint)
- [ ] `npm run web:typecheck` — clean
- [ ] `npm run build` — backend compiles
- [ ] `npm run web:build` — frontend builds; confirm `/` and `/en` still render as `○` (prerendered)
- [ ] `npm run test` — all 173 test files pass; record any skipped/quarantined test
- [ ] `npm run web:i18n:check` — no Cyrillic literals outside `messages/`
- [ ] `npm run audit:check` — no unreviewed high/critical advisories
- [ ] `npm run web:e2e` — Playwright suite (needs Postgres up and `npx playwright install chromium`). Two traps, both of which produce fabricated findings: the ports are **not** per-worktree (web 3100 / API 4100, fixed in `apps/web/playwright.config.ts`) and `reuseExistingServer` is on outside CI, so a suite left running in another worktree silently serves *its* code to your specs — check nothing holds 3100/4100 first, or set `E2E_WEB_PORT`/`E2E_API_PORT`. And the harness boots the API with `RATE_LIMIT_DISABLED=true`, so a green run is no evidence at all about rate limiting; that lives in `tests/auth-rate-limit.test.ts`
- [ ] Migration ↔ schema drift, on a scratch database — **not** `migrate status`, which only compares the `_prisma_migrations` table against the migrations directory and says nothing about `schema.prisma`. Point `DATABASE_URL` at a throwaway database, `npx prisma migrate deploy` (this doubles as Pass 4's "replays cleanly on an empty database"), then `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` — exit 0 means no drift, 2 means the schema has moved without a migration. Prisma 7 has no `--shadow-database-url` flag, so `--from-migrations` is not the route here
- [ ] Record which failures are pre-existing vs. introduced, and what these tools structurally *cannot* catch (that list is the scope of Passes 1–4)

---

## Pass 1 — Cross-cutting axes

Questions that cut across every module and are cheaper to ask once globally than 24 times.

### Tenant isolation (the load-bearing invariant)

- [ ] Enumerate every place a tenant id is obtained; confirm each reads from `src/modules/tenancy/request-context.ts` and never from a request body, param, query or header
- [ ] Grep for `tenantId` arriving from client input across all 28 controllers and their DTOs
- [ ] Confirm every Prisma query on a tenant-owned model filters by tenant **in the query**, not by filtering results in JS afterwards
- [ ] Confirm raw SQL / `$queryRaw` usage (if any) carries the tenant predicate
- [ ] Check tenant resolution for suspended/archived tenants still blocks on every path (a regression of this class is already recorded in the security plan)
- [ ] Verify cross-tenant behavior for shared/global tables (`PlatformOperationEvent`, storage objects, AI jobs)

### Authorization beyond tenancy

- [ ] Every endpoint declares a permission; cross-check the full list against `docs/reference/permissions.md`
- [ ] Identify endpoints where tenancy passes but **ownership** must also hold: a field rep reading another rep's visits, a manager reading another team's data, a user editing another user's account
- [ ] Zone nav gating uses zone-appropriate permissions (a permission shared across roles can leak a whole zone — this has happened before)
- [ ] Platform-owner-only surfaces are unreachable from any `[tenantSlug]` route

### Input, output and errors

- [ ] Every endpoint body is DTO-validated (the DTO migration is complete — verify no endpoint was missed)
- [ ] Backend length caps match the frontend `INPUT_LIMITS` map in `apps/web/lib/input-limits.ts`
- [ ] No error response leaks stack traces, SQL, internal paths or upstream provider messages
- [ ] No `catch {}` that silently swallows a failure the user needs to know about
- [ ] File uploads: type, size and ownership enforced server-side, not only in the browser

### Data access performance

- [ ] N+1 sweep: loops issuing per-item queries, especially in `visits`, `imports`, `locations`, `routes`
- [ ] Unbounded `findMany` with no pagination or `take` on endpoints whose row count grows with tenant age
- [ ] Missing indexes for the filters actually used (compare `prisma/schema.prisma` indexes against `where` clauses in services)
- [ ] Multi-row invariants wrapped in transactions; idempotent operations race-safe

### Secrets and configuration

- [ ] No credentials, tokens or keys committed in `src/`, `apps/web/`, `prisma/`, `scripts/`
- [ ] Every env var read in code is documented in `docs/reference/environment.md`
- [ ] Fail-closed behavior when a required env var is missing in production

### Skipped in this pass, and why

_(fill in — rule #10)_

---

## Pass 2 — Backend, module by module

**The standard module pass.** Ask all ten of these for each module, then tick it:

1. Tenant id from request context only — never from client input
2. Every endpoint declares a permission matching `permissions.md`
3. Every query filters by tenant at the database level
4. Ownership checks beyond tenancy where the data is user- or team-scoped
5. Input DTO-validated; caps consistent with the frontend
6. Errors: correct status codes, no internal detail leaked, no silent catch
7. Queries: no N+1, no unbounded reads, indexes match filters
8. Transactions and race safety on multi-step and idempotent operations
9. Audit events emitted for state changes that matter operationally
10. `api-reference.md` / `permissions.md` / `data-model.md` match reality

The 24 modules below account for all of `src/modules/*`. They are not all of `src/`: the shared layer and the bootstrap are audited first, because several Pass 1 questions cannot be answered without reading them.

### Tier A — decides who sees what (audit first)

- [ ] `src/common/*` (21 files, ~1550 lines) — **not a module, and the one part of `src/` no module checkbox covers.** `api-error.filter.ts` is where Pass 1's "no error response leaks internal detail" is actually decided; `strict-validation-pipe.ts` is the DTO gate every controller opts into; `input-limits.ts` holds the backend caps Pass 1 compares against the frontend map; `trust-proxy.ts` and `rate-limit.ts` decide per-IP keying; `secret-box.ts`, `cookie-token.ts` and `session-lifecycle.ts` carry session and credential handling; `pagination.ts` caps every list; `access-log.middleware.ts` and `json-logger.service.ts` decide what Pass 6 finds in the logs
- [ ] `src/main.ts` + `src/app.module.ts` (79 + 56) — bootstrap: global prefix, middleware order, CSRF, body limit, `trust proxy` hop count, filter and provider wiring. Small, and load-bearing for everything above it
- [ ] `tenancy` (185 lines) — resolution, request context, `GET /tenants/:slug/locale`
- [ ] `auth` (936 + 663 + 290) — login, password reset, auth audit
- [ ] `platform` (1349 + 525 + 446 + 446) — platform auth, MFA, tenant superadmin, tenant users, purge
- [ ] `roles` — role/permission definitions and assignment
- [ ] `rate-limit` — keying, Redis counters, bypass paths

### Tier B — tenant data, high volume or high churn

- [ ] `visits` (2218) — **hotspot**: largest churn among backend services
- [ ] `imports` (2683) — **hotspot**: largest file in the backend; validate→preview→confirm flow
- [ ] `locations` (1172 + 273)
- [ ] `users` (1103)
- [ ] `tasks` (941)
- [ ] `routes` (679 + 828 templates)
- [ ] `location-insights` (323 + 226 + 211) — summary, assortment, potential
- [ ] `products` (389 + 242)
- [ ] `chains` (351)
- [ ] `announcements` (567)
- [ ] `settings` (728) — admin + field settings

### Tier C — supporting

- [ ] `ai` (1114) — plus: **manual report confirmation must remain a working fallback** (hard product requirement)
- [ ] `storage` (437) — presigned URLs, ownership, cleanup
- [ ] `email` (177)
- [ ] `audit` — event coverage and retention
- [ ] `operations` — summary endpoint, alerting inputs
- [ ] `health` (198)
- [ ] `pilot-review` (304)
- [ ] `prisma` — client wrapper, connection handling
- [ ] `worker` (`src/worker.ts`) — cleanup + purge tasks, crash safety, re-runnability

### Skipped in this pass, and why

_(fill in)_

---

## Pass 3 — Frontend, zone by zone

**The standard screen pass**, drawn from the conventions in `CLAUDE.md`:

1. No hardcoded UI literals; both `en` and `uk` present, `uk` a real translation
2. Every free-text input sets `maxLength` from `INPUT_LIMITS`
3. Every Server Action submit uses `PendingSubmitButton` with a specific `pendingLabel`
4. Back navigation via `BackLink` + `resolveBackTarget`, never a hardcoded destination; `from` carried through redirects
5. Portals gate on `useIsMounted`, not hand-rolled `useState`+`useEffect`
6. Server Actions do not close over plain helpers; shared logic via a `"use server"` module
7. No authorization decision made from client-supplied tenant slug
8. Loading, error and empty states all exist and are reachable
9. Panel/modal twins both updated (`location-potential-*`, `location-assortment-*`, `location-contacts-panel`)
10. Dates/numbers via next-intl formatters, honoring tenant timezone

### Shared foundations (audit before the screens)

- [ ] `apps/web/lib/api-client.ts` (2475 lines, 88 commits) — **top hotspot of the whole project**: error handling, cookie/session forwarding, response typing
- [ ] `apps/web/lib/navigation.ts` (32 commits) + `back-navigation.ts` — allowlist and zone checks
- [ ] `apps/web/lib/offline-drafts.ts`, `report-outbox.ts`, `field-db.ts`, `route-snapshot.ts` — offline layer; read `docs/plans/offline-field-drafts-plan-prompt.md` first for known gaps
- [ ] `apps/web/public/sw.js` (191) + `offline.html` (515) — the field zone's offline shell. Plain JS outside the module graph, so it is invisible to `web:typecheck`, `lint` and the line counts above. Neither file can import from `apps/web/lib`, so both restate shared constants as string literals — `offline.html` the IndexedDB database and store names, `sw.js` its `FIELD_ZONE_PATH` — and a rename on the TS side that misses them breaks the shell silently, with nothing red anywhere. `tests/web-app-manifest.test.ts` pins some of that agreement; check what it does *not* cover. Read `sw.js`'s own header first: the cold-start iOS gap recorded there is a known limitation, not a finding
- [ ] `apps/web/messages/{en,uk}.json` (1824 lines each, 90 commits each) — keys present in one dictionary and not the other, orphaned keys no component reads, `uk` entries that are stubs rather than translations
- [ ] `apps/web/lib/content-security-policy.ts`, `canonical-host.ts`, `backend-cookies.ts` — plus `proxy.ts`, whose `matcher` decides which pages get a CSP at all
- [ ] `apps/web/components/field-visit-report-form.tsx` (2060 lines) — largest component
- [ ] `apps/web/components/app-shell.tsx` (23 commits)
- [ ] `apps/web/app/globals.css` (7094 lines, 108 commits — highest churn in the repo) — dead selectors, duplicated rules

### Zones (50 routes)

- [ ] `(public)` — 4 routes: landings + sign-in; confirm both landings stay prerendered and the i18n-provider pinning still holds
- [ ] `[tenantSlug]/page.tsx` (the workspace entry itself), `login`, `password/forgot`, `password/reset`, `invites/accept`, `choose-zone`, `no-access`, `account` — 8 routes
- [ ] `[tenantSlug]/admin/*` — 11 routes; `admin/locations/page.tsx` is 1699 lines
- [ ] `[tenantSlug]/manager/*` — 9 routes; `manager/tasks/page.tsx` is 1094 lines, 27 commits
- [ ] `[tenantSlug]/field/*` — 14 routes; highest real-world usage, offline paths
- [ ] `[tenantSlug]/operations` — 1 route
- [ ] `platform/*` — 3 routes; renders in `en` by design
- [ ] Accessibility sweep: labels, focus order, `aria-busy`/`aria-label` on icon-only controls
- [ ] Mobile viewport sweep of the field zone (the primary device for this role)

### Skipped in this pass, and why

_(fill in)_

---

## Pass 4 — Data layer

- [ ] Every tenant-owned model carries `tenantId` and the indexes to filter on it
- [ ] `onDelete` behavior is deliberate on every relation, not defaulted
- [ ] Nullable columns that the code assumes are non-null
- [ ] Enums with retired values still referenced in code
- [ ] Migrations: none edited after being applied; sequence replays cleanly on an empty database
- [ ] Production drift check — `prisma migrate status` against the production schema (this has drifted before)
- [ ] Orphan-row classes reachable by current code paths
- [ ] `data-model.md` matches `schema.prisma`

### Skipped in this pass, and why

_(fill in)_

---

## Pass 5 — Tests and documentation

- [ ] Map the 173 test files **and the 12 Playwright specs** against `docs/reference/executable-spec.md` — every test mapped, every mapping still true (the spec's "Web end-to-end contracts" section covers the e2e half)
- [ ] Identify contracts with **no** test: list them as S4 findings (tenant isolation gaps here are S2)
- [ ] Tests that assert nothing meaningful, or pass regardless of the behavior under test
- [ ] `docs/reference/api-reference.md` — every endpoint present, permissions correct, no stale entries
- [ ] `docs/reference/module-map.md` — all 24 modules and 50 routes listed
- [ ] `docs/reference/permissions.md`, `environment.md`, `feature-spec-gates.md` — current
- [ ] `AGENTS.md` "Current State" and `docs/vizitum-action-plan.md` §3/§4 reflect reality
- [ ] `AGENTS.md` "Documentation Map" lists every file under `docs/plans/` — `dto-migration-tiers-4-6-plan-prompt.md`, `error-monitoring-sentry-plan-prompt.md`, `imports-dto-migration-note.md` and `visits-dto-migration-note.md` were unlisted when this plan was written, so an agent reading only the map never learns they exist
- [ ] Plan documents in `docs/plans/` that describe work already finished — mark them closed

### Skipped in this pass, and why

_(fill in)_

---

## Pass 6 — Operations and delivery

- [ ] Runbooks in `docs/runbooks/` still match the deployed topology (web on Vercel; API, workers, DB, Redis on Render)
- [ ] Alerting: `npm run alerts:check` covers the failures that would actually page someone
- [ ] Backup/restore drill record is current (`npm run restore:drill:check`)
- [ ] Worker scheduling: what invokes cleanup/purge in production, and what happens if it stops
- [ ] Log hygiene: no PII, tokens or full request bodies written to logs
- [ ] CI covers everything Pass 0 runs locally
- [ ] Dependency freshness beyond advisories: unmaintained or pinned-behind packages

### Skipped in this pass, and why

_(fill in)_

---

## Progress

Update after each pass. `Findings` counts only recorded, verified findings.

| Pass | Status | Findings (S1/S2/S3/S4) | Date | Notes |
|---|---|---|---|---|
| 0 — Automated baseline | not started | — | | |
| 1 — Cross-cutting axes | not started | — | | |
| 2 — Backend modules | not started | — | | |
| 3 — Frontend zones | not started | — | | |
| 4 — Data layer | not started | — | | |
| 5 — Tests and docs | not started | — | | |
| 6 — Operations | not started | — | | |

## Findings

Recorded in the format above, newest first. Every entry must also be filed into the matching backlog section of `docs/vizitum-action-plan.md` — the `Filed:` line is not optional.

_(none yet)_
