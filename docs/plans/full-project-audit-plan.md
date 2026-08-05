# Full-Project Audit — Plan and Checklist

Status: Pass 0 and Pass 2 done · Pass 1 mostly done · Passes 4, 5 and 6 done except one item each (production drift check, enumerating untested contracts, restore drill) · Pass 3 foundations done, all screen bodies outstanding · 20 findings, 0 S1 (2026-08-05) — the Progress table is the record; this line compresses it · Opened: 2026-08-05 · Scope: NestJS API (`src/`), Next.js web (`apps/web`), Prisma schema and migrations, `scripts/`, tests, CI, reference docs and runbooks

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

- [x] `npm ci && npx prisma generate` in the checkout running the audit (mandatory in a fresh worktree slot)
- [x] `npm run prisma:validate` — schema parses (first thing CI runs; a broken schema makes everything after it meaningless)
- [x] `npm run lint` — zero warnings (`--max-warnings 0`)
- [x] `npm run format:check` — Prettier clean (CI runs this separately from lint)
- [x] `npm run web:typecheck` — clean
- [x] `npm run build` — backend compiles
- [x] `npm run web:build` — frontend builds; confirm `/` and `/en` still render as `○` (prerendered)
- [x] `npm run test` — all 173 test files pass; record any skipped/quarantined test
- [x] `npm run web:i18n:check` — no Cyrillic literals outside `messages/`
- [x] `npm run audit:check` — no unreviewed high/critical advisories
- [x] `npm run web:e2e` — Playwright suite (needs Postgres up and `npx playwright install chromium`). Two traps, both of which produce fabricated findings: the ports are **not** per-worktree (web 3100 / API 4100, fixed in `apps/web/playwright.config.ts`) and `reuseExistingServer` is on outside CI, so a suite left running in another worktree silently serves *its* code to your specs — check nothing holds 3100/4100 first, or set `E2E_WEB_PORT`/`E2E_API_PORT`. And the harness boots the API with `RATE_LIMIT_DISABLED=true`, so a green run is no evidence at all about rate limiting; that lives in `tests/auth-rate-limit.test.ts`
- [x] Migration ↔ schema drift, on a scratch database — **not** `migrate status`, which only compares the `_prisma_migrations` table against the migrations directory and says nothing about `schema.prisma`. Point `DATABASE_URL` at a throwaway database, `npx prisma migrate deploy` (this doubles as Pass 4's "replays cleanly on an empty database"), then `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` — exit 0 means no drift, 2 means the schema has moved without a migration. Prisma 7 has no `--shadow-database-url` flag, so `--from-migrations` is not the route here
- [x] Record which failures are pre-existing vs. introduced, and what these tools structurally *cannot* catch (that list is the scope of Passes 1–4)

### Result, run 2026-08-05

**Every check is green. Nothing failed, so the pre-existing/introduced split is empty.** Run in the `audit-plan-analysis-5e564f` worktree, which sits on `main` at `b836cf3`; `npm ci` + `npx prisma generate` were the first things done in it. Postgres and Redis were already up from the root checkout (41h), and 3100/4100 were confirmed free before the e2e run, so `reuseExistingServer` had nothing stale to attach to.

| check | result |
|---|---|
| `prisma:validate` | valid |
| `lint` | clean, 0 warnings |
| `format:check` | clean |
| `web:typecheck` | clean |
| `build` | clean |
| `web:build` | clean; `/` and `/en` both `○` |
| `test` | 1396 tests / 287 suites, **0 fail, 0 skipped, 0 todo** across 173 files |
| `web:i18n:check` | clean |
| `audit:check` | 0 accepted advisories, nothing unreviewed |
| `web:e2e` | 36 passed / 12 specs |
| migration ↔ schema drift | replayed all migrations onto an empty scratch DB, then `migrate diff --exit-code` → **0, no difference** |

Two counts in this document were re-measured and both hold: 173 test files, 12 Playwright specs.

**Two findings came out of the e2e run's logs rather than out of a failing assertion** — F1 and F2 below. Both are invisible to every checkbox above, which is the point worth carrying into Passes 1–4: a green suite is evidence about assertions, not about what the app logged while satisfying them. Read the `[WebServer]` output, not just the pass count.

**What these tools structurally cannot catch** — the scope of Passes 1–4:

- **Tenant isolation.** No check here reads a `where` clause. A query missing its `tenantId` predicate compiles, lints, formats and typechecks; it fails only against data belonging to two tenants at once, which no test fixture here builds by default.
- **Authorization correctness.** `lint` and `tsc` see a `@RequirePermissions(...)` decorator as a well-typed call. Whether it names the *right* permission, or whether a second ownership check is needed beyond it, is unreachable from static analysis.
- **Whether a test asserts anything.** 1396 passing tests is a count of assertions that ran, not of contracts covered. Pass 5's job.
- **Runtime-only configuration.** F2 is precisely this: `S3_ENDPOINT` is typed `string` and every check is green, because nothing parses it until a request does.
- **N+1 and unbounded reads.** A loop of awaited queries is valid TypeScript. Row counts grow with tenant age, and no fixture here is old.
- **Documentation drift.** `docs/reference/*` is prose; nothing compiles it against the code it describes.
- **Anything about rate limiting, from the e2e run specifically.** The harness boots the API with `RATE_LIMIT_DISABLED=true`. That evidence lives only in `tests/auth-rate-limit.test.ts`.

### Note for the next run: this worktree needed an `.env`

`apps/web/playwright.config.ts` boots the API with `cwd: REPO_ROOT` resolved from its own location — i.e. the *worktree* root, not the repo root checkout — and the API reads `DATABASE_URL` and the rest from the `.env` there. A named worktree (as opposed to a `wt-N` slot) has none, so `web:e2e` cannot start the API until one is copied in. `.env` and `apps/web/.env.local` were copied from the root checkout; both are gitignored, and Playwright sets `PORT` itself, so the root checkout's ports in them are irrelevant. `npx prisma generate` has the same problem one step earlier: `prisma.config.ts` resolves `DATABASE_URL` through `dotenv/config` and fails outright without it.

---

## Pass 1 — Cross-cutting axes

Questions that cut across every module and are cheaper to ask once globally than 24 times.

### Tenant isolation (the load-bearing invariant)

- [x] Enumerate every place a tenant id is obtained; confirm each reads from `src/modules/tenancy/request-context.ts` and never from a request body, param, query or header
- [x] Grep for `tenantId` arriving from client input across all 28 controllers and their DTOs
- [x] Confirm every Prisma query on a tenant-owned model filters by tenant **in the query**, not by filtering results in JS afterwards
- [x] Confirm raw SQL / `$queryRaw` usage (if any) carries the tenant predicate
- [x] ~~Check tenant resolution for suspended/archived tenants still blocks on every path~~ — closed by the security plan (`tenant-serving-status.ts`, read by both `resolveTenant` and `PermissionGuard`), pinned by `tests/tenant-suspension-revokes-access.test.ts`. Re-read the guard to confirm the call is still there; not re-litigated, per rule #7
- [ ] Verify cross-tenant behavior for shared/global tables (`PlatformOperationEvent`, storage objects, AI jobs) — **partial**, see Skipped

### Authorization beyond tenancy

- [x] Every endpoint declares a permission; cross-check the full list against `docs/reference/permissions.md`
- [ ] Identify endpoints where tenancy passes but **ownership** must also hold — **partial**, see Skipped
- [x] Zone nav gating uses zone-appropriate permissions (a permission shared across roles can leak a whole zone — this has happened before)
- [ ] Platform-owner-only surfaces are unreachable from any `[tenantSlug]` route — **not done**, see Skipped

### Input, output and errors

- [x] Every endpoint body is DTO-validated (the DTO migration is complete — verify no endpoint was missed)
- [x] Backend length caps match the frontend `INPUT_LIMITS` map in `apps/web/lib/input-limits.ts`
- [x] No error response leaks stack traces, SQL, internal paths or upstream provider messages
- [x] No `catch {}` that silently swallows a failure the user needs to know about
- [x] File uploads: type, size and ownership enforced server-side, not only in the browser — closed in Pass 2 (`visits`): ownership via `assertCanRead/WriteStorageObject`, content-type normalized at registration, and the size cap **is** signed into the presigned PUT despite a stale comment saying otherwise → **F9**

### Data access performance

- [x] N+1 sweep: loops issuing per-item queries, especially in `visits`, `imports`, `locations`, `routes`
- [x] Unbounded `findMany` with no pagination or `take` on endpoints whose row count grows with tenant age
- [ ] Missing indexes for the filters actually used — **not done**, deferred to Pass 4, see Skipped
- [ ] Multi-row invariants wrapped in transactions; idempotent operations race-safe — **not done**, see Skipped

### Secrets and configuration

- [x] No credentials, tokens or keys committed in `src/`, `apps/web/`, `prisma/`, `scripts/`
- [x] Every env var read in code is documented in `docs/reference/environment.md`
- [x] Fail-closed behavior when a required env var is missing in production — **this is where F2 came from**

### Result, run 2026-08-05

**The load-bearing invariant holds.** Tenant isolation was checked mechanically rather than by reading, and it survives every mechanical check:

- **No `tenantId` reaches a query from client input.** No DTO in `src/` declares a `tenantId` field (`grep` over all `*.dto.ts`: the single hit is a comment). The only controllers taking one from a `@Param` are `platform.controller.ts`, `platform-tenant-users.controller.ts` and `platform-tenant-superadmin.controller.ts`, which are the platform-owner console operating *across* tenants by design and are permission-gated as such. Every other tenant id originates in `PermissionGuard`, from `session.tenantId` — a server-side row, never a header or body.
- **393 Prisma calls run against the 35 tenant-owned models** (of 39 models total). A crude "no `tenantId` in the argument block" filter flags 123; narrowing to the only shape that can actually be dangerous — a `where` keyed on an identifier the *caller* supplied, with no tenant predicate — leaves 24, and all 24 were read and cleared. The dominant safe pattern is uniform across the codebase: fetch tenant-scoped, then act on the fetched row's id (`findFirst({where:{id, tenantId}})` → `update({where:{id: entity.id}})`). The two that look worst on paper — `getRoutePlanResponse` and `getRouteTemplateResponse`, both bare `findUniqueOrThrow({where:{id}})` — are `private` and every one of their eight call sites passes an id that a tenant-scoped finder plus `assertCanManageRouteForRepresentative` has already cleared.
- **Raw SQL carries the predicate and is parameterized.** Four sites: two are `SELECT 1` health probes. The two real ones (`visits.service.ts:265` and `:303`) build `conditions[0]` as an unconditional `"tenantId" = ${context.tenantId}`, and `scopeConditions` copies that array before the period filters are appended, so the history-boundary query carries it too. Everything is `Prisma.sql`-interpolated (bound parameters); there is no `queryRawUnsafe`/`executeRawUnsafe` anywhere in `src/` or `scripts/`.

**Authorization: every endpoint declares a permission, with 18 deliberate exceptions.** Of 139 HTTP handlers across the 28 controllers, 121 carry `@RequirePermissions` or `@RequireAnyPermissions`. The 18 that do not are exactly the pre-authentication and public surfaces: the six `/auth/*` routes, the three `/auth/password/*` routes, `/health` and `/health/readiness`, the five `/platform/auth/*` routes, and `GET /tenants/:slug/{locale,branding}`. **The reason this matters beyond the count**: `PermissionGuard.canActivate` returns `true` at its first branch when a route declares no permission, and on that path it never assigns `request.context`. A handler on such a route that read the context would get `undefined` — and `where: {tenantId: undefined}` is not an empty result set in Prisma, it is *no filter at all*. None of the 18 reads it (verified: no `request.context` or `getRequestContext` in any of those five files), and the shared `getRequestContext` helper throws rather than returning `undefined`, so the hazard is currently unreachable from both ends. It is worth stating explicitly because nothing enforces it — a permission decorator deleted from an existing route would open it silently.

Zone nav gating is pinned by `tests/zone-permission-mirror.test.ts`, which asserts both sides agree on the zone set and that each zone's backend permission list equals the union of that zone's nav `requiredPermissions` — the exact leak shape recorded in the earlier zone-nav finding.

**Input, output and errors: clean.** `ApiErrorFilter` maps any non-`HttpException` to a flat `{code: "INTERNAL_SERVER_ERROR", message: "Internal server error.", requestId}` — the stack goes to the logger and to Sentry, never to the response. No construction anywhere passes an upstream error's message into an exception (`grep` for `Exception(...error.message)` and friends: no hits), so provider text cannot escape. No `catch {}` in `src/` or `apps/web`. Backend/frontend length-cap parity is pinned key-for-key by `tests/input-limits.test.ts`.

**Secrets and configuration.** No API-key, AWS-key or PEM pattern appears anywhere in `src/`, `apps/web/`, `prisma/` or `scripts/`. Every environment variable read in code — 60 of them, collected across `process.env.X`, the `env.X` parameter form used by `security-config.ts`, and the `normalizeRequiredEnv("X")` helper form used by `storage.config.ts` — is documented in `environment.md`. (The first extraction caught only the literal `process.env.X` form and appeared to show 22 documented-but-unread vars; that was the grep's gap, not the doc's, and is recorded here because the same mistake is easy to repeat.) Fail-closed behavior is where **F2** came from: the pattern exists and is well-built in `security-config.ts`, and storage is simply not on its list.

**Performance.** The N+1 sweep (awaited Prisma call inside a loop) returns 12 sites, and none is a defect: they are cleanup/purge sweeps where per-row work is inherent, role-assignment loops bounded by the role count, and route-item reorder loops bounded by the stops in one route. `storage.service.ts:212` looks like an N+1 and is the opposite — deliberate id-cursor batch paging with `take: CLEANUP_BATCH_SIZE`, commented as such. 36 `findMany` calls carry no `take`; all but one are bounded by nature (a fixed key list, an `{in: [...]}` batch whose size the caller already bounded, or a single location's children). The exception is **F4**.

### Skipped in this pass, and why

Rule #10. Five items are **not** covered by the result above, and a reader should not treat this pass as answering them:

- **Ownership beyond tenancy — partial.** Verified where it was in the path of something else: `assertCanManageRouteForRepresentative` on the route plan/template finders, and the AI service's `context.userId !== visit.representativeUserId` checks on all four AI entry points. **Not** enumerated across all 139 handlers. This is the axis most likely to still hold a real finding, since it is invisible to every mechanical check used above — a query can be perfectly tenant-scoped and still hand a rep another rep's visit. It is question 4 of the Pass 2 module checklist, so it will be answered module by module rather than re-attempted globally.
- **Platform-owner surfaces unreachable from `[tenantSlug]` — not done.** Needs the frontend route inspection of Pass 3, not a backend grep; the backend half (platform routes require `platform_owner` permissions no tenant role holds) follows from `role-permission-domain-disjointness.test.ts`, but the frontend half is untested here.
- **Cross-tenant behavior for shared/global tables — partial.** `AiJob` and `StorageObject` both carry `tenantId` and were inside the 393-call sweep. `PlatformOperationEvent` was not examined, and the deliberately cross-tenant aggregates in `operations.service.ts` (which count rows across every tenant for the platform summary) were confirmed to be intentional but not audited for what they expose.
- ~~**File uploads — partial.**~~ **Closed in Pass 2 (`visits`).** Ownership is enforced server-side, content-type is normalized and refused at registration, and the size cap is genuinely signed into the presigned PUT — `assertPresignableSize` throws rather than returning undefined, so no path produces an unsigned `Content-Length`. The reason this was left partial was a stale comment claiming the opposite, which is now **F9**.
- **Indexes vs. actual `where` clauses — not done**, deferred to Pass 4 with the schema. **Race safety — since answered for Tier A**: Pass 2 surveyed every single-use credential and multi-step claim in the tier and found the conditional-`updateMany`-then-abort pattern applied consistently in five places and missing in one (**F7**). Still open for Tiers B and C, where the bulk multi-row operations (`imports`, `routes`, `visits`) live.

One thing deliberately **not** re-litigated: everything closed by `docs/security-remediation-plan.md`, per rule #7. The suspended-tenant check was re-read only far enough to confirm `PermissionGuard` still calls `canTenantServeRequests`.

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
- [x] `src/main.ts` + `src/app.module.ts` (79 + 56) — bootstrap: global prefix, middleware order, CSRF, body limit, `trust proxy` hop count, filter and provider wiring. Small, and load-bearing for everything above it
- [x] `tenancy` (185 lines) — resolution, request context, `GET /tenants/:slug/locale`
- [ ] `auth` (936 + 663 + 290) — login, password reset, auth audit — **credential paths only** (login, role/zone switch, invite acceptance, reset-token spending → **F7**); invite creation/expiry, the forgot-password per-account cap and the authenticated password change are unread
- [x] `platform` (1349 + 525 + 446 + 446) — platform auth, MFA, tenant superadmin, tenant users, purge → **F6**
- [ ] `roles` — role/permission definitions and assignment — not read directly; rests on `role-permission-domain-disjointness.test.ts` and `zone-permission-mirror.test.ts`
- [x] `rate-limit` — keying, Redis counters, bypass paths

### Tier A result, run 2026-08-05

Tier A is **substantially** done: `tenancy`, `rate-limit`, the bootstrap and the whole of `platform` are closed; `src/common/*` and `auth` are covered on their load-bearing paths but not exhaustively; `roles` rests on its existing tests. Three findings, **F5**, **F6** and **F7**. Ticks above are left unchecked for anything not fully read — what *was* established:

- **Bootstrap (`main.ts`, `app.module.ts`) — closed.** Express is created and configured *before* `NestFactory` receives it, which is what makes `case sensitive routing`, `strict routing` and `trust proxy` take effect at all (Express reads routing flags once, when it lazily builds the router, and `NestFactory.create` already triggers that). `assertSecurityConfiguration` runs before Nest builds anything. Middleware order is requestId → accessLog → CSRF, body limits are explicit rather than inherited, `x-powered-by` off, helmet with CSP deliberately disabled (the API serves JSON to the Next layer, never documents). `RateLimitModule` is imported first because it registers the `APP_GUARD`.
- **`tenancy` — closed.** 185 lines, both public endpoints read. `resolveTenant` is called from exactly two places (login and password reset), both passing the body's normalized slug as `path` so the host fallback only fires when no slug was sent — and on this deployment that fallback resolves the API's own hostname, which matches no tenant and 404s. Safe by accident rather than by design, but safe. `getPublicTenantLocale`/`getPublicTenantBranding` are deliberately unauthenticated and deliberately *not* status-gated (a suspended tenant's login page still renders its branding, per the comment); they expose slug, workspace name, colour scheme, locale and a 900-second presigned logo URL, and are covered by the 300/min global throttle like every other route. Tenant-existence enumeration is inherent to rendering a pre-auth login page and is not recorded as a finding.
- **`rate-limit` — closed.** `ApiThrottlerGuard` is registered as a global `APP_GUARD` with a 300/min catch-all, so every route including the two public tenancy endpoints is bounded; per-route policies tighten login (30), platform login (10), platform re-auth (5), invite accept (20), password change (10) and password reset (15). The per-account control is a *growing delay* rather than a lockout, explicitly so that knowing an address cannot be used to strand its owner. Redis-backed with documented in-memory fallback for dev/test. The separate `src/common/rate-limit.ts` is a second, deliberately process-local limiter for password reset, documented as such.
- **`src/common/*` — load-bearing files read, not all 21.** Read: `api-error.filter.ts` (in Pass 1), `strict-validation-pipe.ts`, `pagination.ts`, `access-log.middleware.ts`, `json-logger.service.ts`, `session-lifecycle.ts`, `rate-limit.ts`, `cookie-token.ts`. `pagination.ts` caps `pageSize` at 100 and normalizes `page` to ≥1. The logger writes structured fields only — the access log carries method, path, status, duration and user-agent, never a body or a header beyond UA — and every `@Query()` in the codebase is a list filter (page, status, dates, ids, and a location `search` on name/code/address), so nothing secret rides the query string into the logs. **Not read**: `secret-box.ts`, `trust-proxy.ts` (both closed and pinned by the security plan and `tests/trust-proxy-resolution.test.ts`), `sentry.service.ts`, `prisma-retry.ts`, `request-origin.ts`, `normalize.ts`, `person-name.ts`, `phone.ts`, `cookie-naming.ts`, `request-id.middleware.ts`, `input-limits.ts` (pinned by `tests/input-limits.test.ts`).
- **`auth` — the session and guard halves are closed.** `SessionService` hashes the token before storage, hashes the user-agent and IP rather than keeping them, rotates the token on any privilege change (role/zone switch) and revokes every *other* session on password change while keeping the caller's. The idle-timeout question that Pass 1 raised is answered: `findActiveSessionByToken` both checks `isSessionActive(session, SESSION_IDLE_TIMEOUT_HOURS)` and calls `touchSession`, exactly as the platform twin in `PermissionGuard` does — the control is symmetric across both session domains, which is the asymmetry class the security plan's own follow-ups kept finding. **Not read**: the bulk of `auth.service.ts` (936 lines) beyond login's tenant resolution, and `password-reset.service.ts` (663) beyond its resolver.
- **Ownership beyond tenancy — the axis Pass 1 deferred, now answered for the two surfaces that matter most.** `visits` and `tasks` both resolve scope in one shared place and force it: `resolveVisitRepresentativeFilter` gives a `visits.read_team` holder the requested representative and everyone else `context.userId`, throwing when neither permission is present; `buildTaskWhere` mirrors it. Per-row reads have the matching twins (`assertCanReadVisit`, `assertCanReadReport`), and all four AI entry points check `context.userId !== visit.representativeUserId` directly. Note for anyone re-reading this: a Team Manager legitimately sees the **whole tenant**, not a sub-team — `visits.read_team` is tenant-wide by product design (`AGENTS.md`: "Team Manager full tenant view means operational read access"), so "manager reading another team's data" is not a finding here, it is the specification.
- **`platform` — the destructive path is closed; `platform.service.ts` now read, with one finding.** `purgeEligibleTenants` selects only `archived` tenants and claims each one with a conditional `updateMany` on `{status: "archived", purgeStartedAt: null}` — an atomic point of no return that a concurrent unarchive or a second worker loses cleanly (zero rows matched → `skipped`), with rows that carry `purgeStartedAt` always re-selected so a crashed purge resumes. `archiveTenant` is transactional, idempotent, race-safe (conditional `updateMany` on `status != archived`) and emits a `tenant.archived` `PlatformOperationEvent` — but takes no second factor, which is **F6**. Two things were checked and cleared: `formatSuperadminSummary` picks response fields explicitly rather than spreading a `User`, so `passwordHash` never reaches the console; and `PlatformTenant.databaseKey`, which *is* spread into the tenant list, holds the constant `"shared-primary"` (a placement label, not a credential). `listTenants` is cross-tenant by design and avoids N+1 by aggregating with `groupBy`.

  **The second factor (`platform-mfa` + `platform-auth`, 971 lines) is now read too, and is the strongest code in Tier A — no finding.** Every single-use credential in it is claimed with a conditional `updateMany` that aborts on zero rows: the challenge (`{consumedAt: null}`, and it checks `purpose`, so an enrolment challenge cannot be replayed as a login one), the TOTP step (`{totpLastUsedStep: {lt: step}}`), the recovery code (`{totpRecoveryCodeHashes: {has: hash}}`). Challenge tokens are `randomBytes`, stored hashed, TTL-bounded, and `createChallenge` invalidates any outstanding challenge for that user first, so a second password entry cannot leave an earlier half-authenticated token alive. Recovery codes come from `randomInt` over a deliberately unambiguous 31-character alphabet and are compared with `timingSafeEqual` behind a length check. `login` equalizes timing with a dummy argon2 verify on the unknown/inactive branch, runs captcha before any database work, caps the password length (with a comment recording that the one path which *sets* a platform password refuses to exceed the same cap — otherwise a seeded owner past it would be locked out permanently with nobody above them to fix it), and issues a *challenge* rather than a session. `verifyMfa` re-loads the user through `loadActivePlatformUser` after claiming the challenge, so an account suspended between the two steps gets no session, and a wrong code earns the same backoff and audit event a wrong password does.

  One defence-in-depth gap noted and deliberately **not** recorded as a finding, because it is unreachable: `confirmEnrollment` (`platform-mfa.service.ts:222`) writes the new secret with a plain `update({where:{id}})`, unconditional on `totpConfirmedAt` still being null, so it would overwrite an existing second factor. Reaching it needs a live unconsumed `enrollment`-purpose challenge, and those are minted only by `login` and only when `isEnrolled` is false, expire, are single-use, and are invalidated by any subsequent login. Rule #2 wants a concrete failure path and there is none — recorded here so the next reader does not re-derive it.
- **`auth` — the credential paths are now read, with one finding.** `switchRole` and `switchZone` are session-authenticated rather than permission-gated (which is why they carry no decorator), and both verify the target is actually available to the caller — `roleCodes.includes(selectedRoleCode)` and `isZoneAvailable(zone, permissions)` — before rotating the session token. No escalation is reachable through either; note also that the selected role is only a UI preference, since `getPermissionsForRoles(roleCodes)` always derives permissions from *all* assigned roles. `acceptInvite`'s superadmin replacement runs wholly inside a transaction, is tenant-scoped, writes a `superadmin.replaced` audit event, and claims the invite with a conditional `updateMany` that closes its own TOCTOU. The password-reset path does **not** do the same for its token — **F7**.
- **`roles` — not read directly.** Rests on `tests/role-permission-domain-disjointness.test.ts` (platform and tenant permission domains do not overlap, which is what lets `PermissionGuard` resolve several credentials at once without ambiguity) and `tests/zone-permission-mirror.test.ts`. Both pass.

### Tier B — tenant data, high volume or high churn

- [ ] `visits` (2218) — **hotspot**: largest churn among backend services — **write paths done** (`createVisit`, `confirmReport`, shelf check, media registration → **F9**); the read paths were covered in Pass 1, `updateVisit`/`cancelVisit`/`addTextNote` are unread
- [ ] `imports` (2683) — **hotspot**: largest file in the backend; validate→preview→confirm flow — **confirm/apply path done → F8**; the five `validate*Preview` methods (~700 lines) and the three parsers are unread
- [ ] `locations` (1172 + 273) — read scoping, contacts and the uniqueness paths audited → **F11**; assignments CRUD and `location-categories.service.ts` unread
- [x] `users` (1103) — privilege axis audited (role allowlist, admin cap at invite **and** acceptance, Serializable isolation, superadmin protection); **no findings**. `resendInvite`, `dispatchInviteEmail` and invite TTL handling unread
- [x] `tasks` (941) — ownership on both halves of reassignment, status/history atomicity, report→task replacement, `onDelete` deliberate; **no findings**
- [ ] `routes` (679 + 828 templates) — **write/bulk/reorder paths done → F10**; `listRouteTemplates`, `getTodayRoutes`/`listRoutes` and the plan-level CRUD are unread
- [x] `location-insights` (323 + 226 + 211) — summary, assortment, potential; two-owner invariant on `LocationAssortment` verified structurally, three ownership tiers correct; **F4** only (already recorded)
- [x] `products` (389 + 242) — maps `P2002` correctly on both dictionary services; **no findings**
- [x] `chains` (351) — same pre-check-then-write shape as `locations` with no `P2002` mapping → extends **F11**; plus a recorded (unreachable) archiving trap
- [x] `announcements` (567) — publish window (tenant-timezone bounded, non-nullable dates), receipt ownership, tally audience; **no findings**
- [x] `settings` (728) — admin + field settings; typed per-key mutations, branding logo double-gated against the public endpoint, `TenantSetting.updatedByUserId` attribution; **no findings**

### Tier B result — all 11 modules examined (7 fully, 4 on named paths)

**`imports` — the confirm/apply half is audited; the validate half is not.** One finding, **F8**, and it is the first S2 of this audit.

What holds: `confirmImportJob` fetches the job scoped to `context.tenantId`, and claims it *inside* the transaction with a conditional `updateMany({where: {id, status: "validated"}})` that aborts on zero rows — the same claim pattern Tier A found applied consistently, and the TOCTOU the security remediation plan closed. Every apply runs inside that one transaction, and the final `status: "applied"` write is inside it too, so a failure anywhere rolls the whole thing back; the release-readiness contract "Import failure cannot partially corrupt applied data" holds. Every write in every apply method carries `tenantId: context.tenantId` explicitly, and the reference resolvers (`resolveChainReference`, `resolveLocationCategoryReference`, `resolveLocationReference`, `findExistingUserByEmailOrThrow`) all filter on the tenant. Auto-created chains and categories are counted back to the caller rather than created silently.

What does not: the apply methods are per-row loops with 5–7 awaited queries each, inside a transaction whose 5-second default was never raised, with no row cap anywhere in the stack — **F8**. Worth stating plainly because the N+1 sweep in Pass 1 saw these same loops and cleared them: judged as query efficiency they are unremarkable bulk-insert code, and the defect only appears when the loop is read *together with* the fixed transaction budget wrapped around it. Neither half is wrong on its own.

Not yet read in this module: `validateUsersPreview`, `validateLocationsPreview`, `validateContactsPreview`, `validateProductsPreview`, `validateInitialPlanPreview` (~700 lines between them), the CSV/XLSX parsers, and `createImportValidationJob`/`getImportValidationJob`/`listImportJobs`. The preview path is where the per-column `TEXT_LIMITS` caps and `assertApprovedHeader` live — both closed and pinned by the security plan and `tests/import-length-limits.test.ts`, but not re-read here.

**`visits` — the write paths are audited; one finding, F9, and it is about a comment rather than behaviour.** This is the module with the highest churn in the backend and it is in good condition. `confirmReport` is the most intricate method in the service and holds up under every question worth asking of it: permission and ownership checked before anything else, a cancelled visit refused outright, the `clientRequestId` replay answered **before** payload re-validation (so a queue flushed days later cannot fail a visit-date window check on a report the server already accepted), and every write — report upsert, visit → `completed`, route item → `visited`, shelf check, tasks, problem-photo activation — inside one transaction. Tasks are written with `deleteMany` + `createMany` rather than per row. The problem photo is activated by an `updateMany` filtered on tenant, purpose **and** object-key prefix, so a payload cannot adopt another visit's object by id. The `P2002` path hands the loser of a concurrent flush the winner's report instead of a 500 it would only retry into, and `assertReplayBelongsToVisit` refuses a token replayed onto a different visit.

`applyShelfCheck` is the best-argued function read in this audit so far: it re-reads the required matrix at confirm time rather than trusting the report (so a product the manager removed mid-visit is not resurrected), never writes `shouldBeListed` (keeping the manager's matrix and the rep's observation separately owned), collapses the write into two grouped `updateMany` calls *because* it runs inside the confirm transaction, and guards monotonicity with `lastCheckedAt: {lte: checkedAt}` so a Monday report confirmed after Wednesday's cannot walk the shelf backwards — which also blunts a back-dated client `visitDate`.

`createVisit` handles the `clientVisitId` race the same way `confirmReport` does, and **documents the one race it does not handle**: two concurrent starts that both see a route stop's unique slot free will have one lose on `P2002` with no stored result to hand back, and the comment at `:502-508` says so and scopes it as "left for later". Recorded here rather than as a finding — it is a known, written-down limitation with a self-healing retry (the next attempt finds the slot occupied and either adopts the rep's own open visit or creates an unlinked one), not something this audit discovered.

Not read in this module: `updateVisit`, `cancelVisit`, `addTextNote`, and the two upload registration methods beyond their validation prologue. The read paths (`listVisits`, `getVisitDaySummary`, `getVisit`, `getVisitReport`, and the scope resolution behind them) were audited in Pass 1.

**`routes` + `route-templates` — the bulk and reorder paths are audited; one finding, F10.** This module was picked next specifically because it is where multi-step operations live, and it turns out to be the counter-example to F8 rather than another instance of it. `copyRoutePlans` fetches the occupied-dates set and the referenced-template map in two flat lookups "however many days are in the source month" (its own comment), keys occupancy on `(date, template)` to match the partial unique index rather than on date alone, and deliberately runs **no** wrapping transaction — each day materializes independently, a per-day `ConflictException` from a concurrent assign is caught and counted as skipped rather than aborting the batch, and the response returns `createdCount`/`skippedCount`. Partial progress is the designed semantic and a retry completes the rest, because re-copying an already-occupied `(date, template)` pair is skipped. `materializeTemplateAssignment` wraps only one day in a transaction and writes the stops with a single `createMany` — the shape `applyLocationsImport` should have. Deactivated representatives are re-checked at materialization time, not just at template creation.

`reorderRouteItems` renumbers in two phases (park every stop above the current maximum, then set 1..n) because `@@unique([tenantId, routePlanId, sequence])` is real and a single-pass renumber would collide with itself. Concurrent *inserts* during that window are handled — they trip the unique index and surface as a 409. Concurrent *deletes* are not: **F10**. `deleteRouteItem` pairs the delete with its audit event in one transaction so neither can exist alone, and refuses to remove a `visited` stop because it records real field work. `routes` is one of the twelve modules that does emit audit events, so F5 does not apply here.

Not read in this module: `listRouteTemplates`, `getTodayRoutes`, `listRoutes`, and the plan-level CRUD (`createRoutePlan`, `updateRoutePlan`, `deleteRoutePlan`) beyond the ownership assertions Pass 1 already covered.

**`users` — audited on the privilege axis; no findings.** The first module in this audit to come out clean, and it is the one where escalation would matter most, so the checks are recorded rather than just the verdict.

- **A tenant-side route cannot grant `tenant_superadmin`.** `normalizeRoleCode` resolves against `INVITABLE_ROLE_CODES` (`users.types.ts:50`), which lists exactly `company_admin`, `team_manager`, `field_representative` and carries the reason: superadmin "is the platform owner's to grant (`platform.service.ts`), and no tenant-side route may assign it". An unlisted code returns `null` and `addRole` throws `INVALID_ROLE`. The same constant backs the class-validator DTOs in front of the invite and add-role routes, so the allowlist is not restated in two places that could drift — "one vocabulary, two layers reading it".
- **The Company Admin cap is enforced where it actually matters.** The hypothesis worth testing was that `assertAdminLimitNotExceeded` counts only *active* admins and ignores pending invites, so a burst of invites issued while the count is under the cap would all pass and collectively exceed it on acceptance. That is true of the invite-time check — and `auth.service.ts:331-359` re-checks the cap at acceptance, inside the acceptance transaction, under `withSerializationRetry`, with a comment naming this exact scenario. Checked at the point of effect, not only at the point of request.
- **Every privileged mutation runs Serializable with retry.** Six `$transaction` calls in the module, six `isolationLevel: Serializable`, six `withSerializationRetry` wrappers — `addRole`'s comment explains why (two concurrent grants could each read the count as under the limit before either commits). This is a stronger guarantee than the conditional-`updateMany` claim pattern used elsewhere, and appropriate here because the invariant is a *count* rather than a single row's state.
- **The superadmin is protected from the tenant side in both directions.** `assertTargetNotSuperadmin` blocks every status or role change against a superadmin target on all four mutation paths (`updateUser`, `addRole`, `removeRole`, `deleteUser`), and `assertLeadershipNotLocked` is the anti-lockout guard for the last active `company_admin`, with a documented fallback for tenants not yet migrated to having a superadmin. Admin grants emit an `admin.role_granted` audit event.
- `listUsers` paginates through the shared `resolvePagination`; the `findMany` calls flagged as `take`-less in Pass 1 are the leadership/admin counts, bounded by a tenant's team size.

Not read in this module: `resendInvite`, `deleteUser`'s body beyond its guard calls, `dispatchInviteEmail`, and the invite token TTL/expiry handling (which sits in `auth.service.ts` and was covered only where acceptance touches it).

**`locations` — read scoping and uniqueness audited; one finding, F11.** Two hypotheses were tested here and **both were wrong**, which is worth recording so the next reader does not spend the same time on them:

- *"A field rep sees every location in the tenant, including ones they are not assigned to."* True, and intended. `buildLocationWhere` takes only `tenantId` — no assignment scoping — and `field_representative` does hold `locations.read`. But the field-zone locations screen is deliberately a browse-the-catalogue surface: it ships city, search and status filters, and its own import comment notes it calls the same endpoint as the admin list, "not admin-permission-gated despite the name".
- *"Contact reads are not assignment-scoped while contact writes are — the codebase's recurring one-path-not-its-twin shape."* The asymmetry is real: `GET /locations/:id/contacts` requires only `contacts.read` and does no assignment check, while every contact mutation runs `assertCanManageContacts`, whose `_OWN` tier requires an active `LocationAssignment`. But `docs/reference/permissions.md:87` states the design in as many words — "Reads stay tenant-wide … **only writes are ownership-scoped**" — and explains the two-tier shape and the computed `canManageNotes`/`canManageContacts` booleans that let the UI hide affordances a caller cannot use. A documented decision, not a gap. Rule #5 earned its place here: both of these would have been plausible-but-wrong findings.

What did hold up as a defect is the uniqueness path, **F11**. Otherwise the module is sound: soft-delete and restore are symmetric (`archiveLocation` sets `deletedAt`, `restoreLocation` clears it), the partial unique index is deliberately scoped to `deletedAt IS NULL` so archiving frees the code for re-import, contact creation is capped at `MAX_LOCATION_CONTACTS`, and `canManageLocationHeader` exists specifically to resolve both manage flags with a single assignment lookup instead of two. **F5** — no `deletedBy`, no audit event on archive — lives in this module and was already recorded; nothing worse was found beside it.

Not read in this module: `createAssignment`/`deactivateAssignment`/`listAssignments`, and `location-categories.service.ts` (273 lines) beyond the rename path already cleared during Pass 1's tenant-scope triage.

**`settings` — audited; no findings.** Picked because it is the module that changes tenant-wide behaviour and does not emit audit events. Three hypotheses, none of which survived contact with the code:

- *"A key-value settings table means a client can write arbitrary keys."* No. There is no generic key endpoint: every setting has its own normalizer (`normalizeName`, `normalizeLanguage`, `normalizeProductsEnabled`, `normalizeColorScheme`, `normalizeFieldReportVoiceHint`, …) and its own typed upsert helper, and `updateSettings` validates **every** field up front — throwing before any write — then performs the tenant-row update and each setting upsert inside one `$transaction`.
- *"The public branding endpoint could be pointed at an arbitrary object."* This was the sharpest one, because `GET /tenants/:slug/branding` is unauthenticated and mints a 15-minute presigned GET URL. It cannot: `confirmLogoUpload` fetches the object scoped to `context.tenantId` and then explicitly refuses anything whose `purpose !== "branding_logo"` or `status !== "active"`, and `purpose` is set server-side by `registerLogoUpload` — a caller never chooses it. `tenancy.buildPublicLogoUrl` re-applies the same three filters independently. Two layers, neither trusting the other.
- *"Tenant configuration changes are unattributed, like the soft-deletes in F5."* No — and this **narrowed F5**, which has been corrected accordingly. `TenantSetting` carries `updatedByUserId` with a relation, and all four upsert helpers set it, so who changed a tenant's language, colour scheme, feature toggles or voice hint is on the row. F5's finding is specifically `locations`/`products`/`chains`, which have neither a column nor an event.

Also sound: `registerLogoUpload` sweeps previously-registered-but-unconfirmed logo objects inside the same transaction that creates the new one (which is what the `take`-less `findMany` at `:320` is, and it is self-limiting because each registration clears the last), and only deletes the remote R2 bytes **after** that transaction commits — the same ordering `storage.service.ts` argues for, where an orphaned object is silent cost but a dangling row is not.

Not read in this module: `getSettings`'s response assembly, `field-settings.controller.ts`'s voice-hint read, and `removeLogo`/`deleteLogoObjectById` beyond their call shape.

**`tasks` — audited on the ownership and boundary axes; no findings.** Chosen because it combines `_OWN` permissions, status transitions and a link to reports — three boundaries. All three hold, and in each case the guard's own comment already names the attack the hypothesis was probing:

- **Own-scope escalation via reassignment is closed on both halves.** `updateTask:190` calls `assertCanUpdateTask` with `task.assignedToUserId` — the assignee read from the database, not the one in the request body — so a rep cannot reach a colleague's task by putting their own id in the payload. When the body *does* change `assignedToUserId`, `assertCanAssignTask` runs separately at `:200`, and its comment states the reason: without it "a PATCH that touches assignedToUserId would trivially undo that restriction, since assertCanUpdateTask above only checks the task's *current* assignee, not the one being set". `assertCanAssignTask` additionally refuses to let an own-scope caller leave a task unassigned, because such a task would be invisible to them on every later own-scope read — orphaning it.
- **Status changes are atomic with their history.** The `task.update` and the `taskStatusHistory` row commit together, and `completedAt` is derived on both transitions (stamped entering `done`, cleared leaving it) rather than trusted from the caller when omitted.
- **The report→task replacement is understood, not accidental.** `confirmReport` replaces a report's tasks with `deleteMany({reportId})` + `createMany`, which would discard a manager's edits to those tasks. That consequence is named in `confirmReport`'s own replay comment — "discarding whatever a manager had already done with the originals" — which is precisely why the `clientRequestId` replay path returns early instead of re-running. What remains is a *deliberate* re-confirm, where replacement is the intended semantic and is documented in `api-reference.md`.
- `onDelete` is deliberate on all five `Task` relations: `Cascade` for status history (it dies with its task) and `SetNull` for assignee, creator, location, visit and report — a deleted user does not take their tasks with them.

Worth flagging for whoever fixes **F5**: `deleteTask` is the pattern that finding asks for. It soft-deletes by stamping `deletedAt` *and* writes a `task.deleted` audit event in the same transaction, with a comment explaining that neither may exist without the other. `locations`, `products` and `chains` need the same two lines.

Not read in this module: `createTask`'s body beyond its guard calls, `listTasks`'s ordering and `findCompletedHistoryStart`, and the five `assertTenant*` reference validators.

**`location-insights` — audited; no new findings.** **F4** already sits in this module and stands; nothing worse was found beside it. What this pass establishes is that the module's central invariant is real and structurally enforced rather than merely asserted in a comment.

The invariant, stated in `shelf-check.ts`, is that a location's assortment row has **two separate owners**: the manager authors `shouldBeListed` (the matrix) and the field visit writes `status`/`lastCheckedAt` (the observation), and neither may touch the other's column. It holds:

- There are exactly three writers of `LocationAssortment` in the whole backend — `upsertAssortment` (`:116`), `deleteAssortment` (`:157`) and `applyShelfCheck` (`visits/shelf-check.ts:104`). Nothing else writes the model.
- The manager's upsert passes `update: data`, and `parseUpsertAssortmentBody` returns an object containing **only** `shouldBeListed`. So a manager re-saving a row cannot reset a field observation even by accident — the payload has no `status` to spread. The comment at `:111` explains the hazard ("spreading a full row here would reset them to their defaults on every edit"); the parse function is what actually prevents it.
- A created row deliberately starts with no `status` at all: nobody has looked at the shelf yet, which is the distinction `applyShelfCheck` later relies on to tell "checked and empty" from "never checked".

The three ownership tiers are each the right shape and each say why:

- **Assortment** is tenant-wide (`assertCanManageAssortment` is synchronous and takes no `locationId`) because "the assortment is a tenant-wide standard, so its write check is the plain permission — there is no ownership tier and therefore nothing to query".
- **Potential** is assignment-scoped (`assertCanManagePotential` is async and queries an active `LocationAssignment`) because "potential rows carry no representative of their own", so ownership has to be resolved per request rather than read off a column. Both of its mutation paths — `upsertPotential:85` and `deletePotential:117` — call it; `listPotential` does not, matching the documented "reads stay tenant-wide, only writes are ownership-scoped" rule that `locations` follows.
- Both helpers also feed a `canManage` flag into their list envelopes so the frontend hides affordances the caller cannot use — the same pattern as `canManageLocationHeader`.

Not read in this module: `location-insights-summary.service.ts` beyond the aggregation that produced F4 (`resolveTopProblemProducts`, `resolvePotentialByCategory`), and the list/response assembly in the assortment and potential services.

**`products` and `chains` — audited together on the uniqueness axis; `products` clean, `chains` extends F11.** These were taken as a pair because both are CRUD dictionaries with uniqueness rules, and the working hypothesis was that both would repeat F11. **Half right, and the half that was wrong is the more useful half.**

`products.service.ts` handles it correctly and carries the clearest articulation of the rule anywhere in the codebase: "A concurrent create can slip between the pre-check above and this insert; the partial unique index on (tenantId, externalCode) then raises P2002. Surface it as the same 409 the pre-check would have, **not an opaque 500**." `product-categories.service.ts` and `location-categories.service.ts` do the same. `chains.service.ts` contains not one reference to `P2002`, and has two unique constraints to trip. So the corrected picture — now recorded in F11 — is three services following a convention and two missing it, rather than a hazard nobody had considered.

The chain-archiving trap described in F11 was chased to the end and **deliberately excluded from the finding**: `Chain.deletedAt` exists and is filtered in four places, but `grep` over the whole of `src/` shows nothing ever writes it, so chains cannot be archived and the deterministic failure is unreachable today. Recorded as a note rather than a defect, per rule #2 — there is no failure path until someone implements archiving, at which point `Chain`'s plain (non-partial) unique indexes make it immediate.

Not read in these modules: `products.service.ts`'s list/filter assembly and `product-categories.service.ts` beyond its `P2002` handling, and `chains.service.ts`'s `listChains`. Neither module's read paths were examined beyond the tenant-scope sweep in Pass 1.

**`announcements` — audited; no findings.** The two questions worth asking of a publish-window feature both come out right.

- **Nothing leaks outside its window.** `listActiveAnnouncements` filters through `buildActiveWhere` (`tenantId`, `archivedAt: null`, `startsAt <= today <= endsAt`), bounds itself with `take: ACTIVE_ANNOUNCEMENTS_LIMIT`, and resolves "today" as the start of day **in the tenant's own timezone** rather than UTC — the right boundary for a field product whose reps read notices first thing in the morning. `startsAt`/`endsAt` are both non-nullable `@db.Date`, so there is no "no end date" row that the `gte` comparison would silently hide, and `assertWindowOrdered` validates the ordering on both create and update. `@@index([tenantId, archivedAt, endsAt])` covers the query.
- **A receipt cannot be forged or misplaced.** `markAnnouncementRead` takes no `userId` at all — it comes from `requireUserId(context)` — so acknowledging on someone else's behalf is not expressible. It re-applies the *same* `buildActiveWhere` filter before writing, with the reason stated: "marking a scheduled or withdrawn announcement read would put a receipt against something that was never on their screen". The write is an `upsert` on the composite unique key with `update: {}`, so a repeated tap is idempotent by construction.

Also worth recording because it is a bug class avoided rather than a check passed: the read tally deliberately excludes manager receipts. `announcements.read` is held by managers too, so a manager reading their own notice in the field zone would otherwise be counted in the numerator while `countRecipients` measures only active representatives — letting a tally read "8 of 7". Numerator and denominator are pinned to the same audience.

Not investigated: whether Prisma compiles this `upsert` to a native `INSERT … ON CONFLICT` (atomic) or to a select-then-insert that could raise `P2002` under a concurrent double-tap. The endpoint is idempotent either way, so the worst case is a spurious 500 on a retry that has already succeeded; establishing which would need the generated SQL, not a reading.

---

The four unticked boxes above are deliberate, not an oversight: `imports`, `visits`, `routes` and `locations` were each audited on the paths their finding came from plus the module questions that matter most there, and each carries its own note listing what was left. Anyone resuming should read those notes before treating the tier as done.

| module | outcome |
|---|---|
| `imports` | **F8** (S2) — confirm/apply audited, validate half not |
| `visits` | **F9** (S4) — write paths audited |
| `routes` | **F10** (S3) — bulk/reorder audited |
| `locations` | **F11** (S3) |
| `chains` | extends **F11** |
| `location-insights` | **F4** only (found in Pass 1) |
| `users` | clean |
| `tasks` | clean |
| `settings` | clean |
| `products` | clean |
| `announcements` | clean |

**What the tier says as a whole.** Five of eleven modules are clean, and the six findings cluster in one place: not authorization, not tenant isolation, not ownership — those produced **zero** findings across the entire tier, and the mechanical sweeps in Pass 1 said the same. Every Tier B defect sits on a *boundary*: a loop measured against a transaction budget (F8), a constraint whose error code nobody mapped (F10, F11), a comment that stopped matching the code (F9), a response array nobody bounded (F4).

That pattern is worth carrying into Pass 3. It suggests the productive questions for the frontend are not "is this screen permission-gated" but "what happens at the seam" — between a Server Action and its redirect, between an optimistic update and its failure, between the offline queue and the server's answer.

A second observation, recorded because it changed how findings were written: this codebase's comments repeatedly name the exact attack or race being probed — `assertCanAssignTask`, `createVisit`'s route-slot note, `confirmReport`'s replay rationale, `applyShelfCheck`'s grouped-update reasoning, `products.service.ts`'s P2002 comment. Where a guard exists, its reasoning is usually written down beside it. That made the productive audit question shift from "is this handled?" to "**which sibling didn't get the same treatment?**" — which is how F7, F10 and F11 were each found.

### Tier C — supporting

- [x] `ai` (1114) — plus: **manual report confirmation must remain a working fallback** (hard product requirement) — requirement **verified enforced**; **F3** (dead async pipeline) and **F12** (outage invisible)
- [x] `storage` (437) — presigned URLs, ownership, cleanup — read/write ownership are true mirrors; **F2** only
- [x] `email` (177) — both send paths never throw, for documented reasons; failures at error level and persisted as `emailStatus`
- [x] `audit` — thin transaction-aware recorder; untyped event taxonomy is the second half of **F5**
- [x] `operations` — summary endpoint, alerting inputs; `provisioning` block is documented-legacy, not a blind spot; `ai` block is **F12**
- [x] `health` (198) — readiness gates on DB + 2 env vars; migration drift chased and found already named/mitigated by the deployment runbook
- [x] `pilot-review` (304) — permission-gated, every aggregate tenant-scoped and windowed, audit event on dashboard views
- [x] `prisma` — client wrapper, connection handling; **no `transactionOptions`**, which is where **F8**'s 5-second default comes from
- [x] `worker` (`src/worker.ts`) — cleanup + purge tasks, crash safety, re-runnability; awaited Sentry capture before `app.close()`, non-zero exit on partial cleanup failure. *What invokes it in production, and what happens if it stops, stays open for Pass 6*

### Tier C result — 9 of 9 · **Pass 2 complete**

**`storage` — audited; `F2` remains its only finding.** The ownership model is the part worth recording, because it is the one the security remediation plan had to fix twice. `assertCanReadStorageObject` and `assertCanWriteStorageObject` are genuine mirrors: both require `Boolean(storageObject.createdByUserId)` *and* a match against `context.userId` for visit artifacts, so an object with no creator is neither readable nor writable by a representative. That matters because the AI worker writes `temporary_transcript` rows with no creator — the "nobody owns it, so nobody is wronged" reading that made every such row in a tenant reachable by any rep. The write path was corrected first and the read path later made its mirror; both now carry comments explaining why. Managers reach visit artifacts through `VISITS_READ_TEAM`, imports through `IMPORTS_READ`, the branding logo through `TENANT_SETTINGS_READ` — each purpose gated by its own permission rather than by one blanket check. Cleanup ordering is right throughout: `deletedAt` means "the bytes are gone" and only the sweep that deletes them may set it.

Confirmed here in passing, for **F9**: `transcribeFieldReport` downloads with `{ maxBytes: MAX_TEMPORARY_AUDIO_SIZE_BYTES }`, so the read-side cap genuinely exists — it is the *sole* enforcement claim in `visit-media-limits.ts`'s comment that is wrong, not the existence of the read-side check.

**`ai` — audited; the hard product requirement is genuinely enforced, and one new finding.** `AGENTS.md` and `CLAUDE.md` both state that manual report confirmation must remain a working fallback whenever AI is slow, weak or unavailable. This is not an aspiration in the code — it is structural, and it holds on every branch:

- The storage download and transcription call sit in one `try`; any failure returns `{ transcript: "", extractedData: empty… }`.
- An empty or whitespace-only transcript short-circuits to the same empty result rather than calling extraction with nothing.
- The extraction call sits in its own `try`; a failure returns the transcript that *did* succeed plus an empty extraction, so a rep keeps the words even when the structuring fails.
- The only exceptions thrown are a missing visit (404) and three 400s — scope, an audio object that is not an active `temporary_audio` row, and one not registered on this visit by this caller. All of them precede any provider call, exactly as `api-reference.md` describes.

Ownership on this path is tight in a way worth noting: the audio must be an active `temporary_audio` object **and** have a `VisitNote` on this visit whose `createdByUserId` is the caller — so a rep cannot transcribe a colleague's recording by passing its id.

What is wrong is that none of this is observable — **F12**.

**`operations`, `health` and `worker` — audited together; no new findings.** These three were taken as a set to test whether F12's shape — *the operational surface describes what does not run and is blind to what does* — generalizes. **It does not.** The answer matters as much as a finding would, so both halves are recorded.

- **`operations`.** The summary returns five blocks. `imports`, `storage` and `tenants` all count live activity. The `ai` block is the one F12 covers. The `provisioning` block looked like a second instance — `PlatformProvisioningJob` is written **nowhere in application code**, only by two seed scripts, and `parseWorkerTask` has no `provision` mode — but it is not a defect: `data-model.md:22` marks the model **legacy** in as many words ("tenants are created straight into `pilot` and no longer get a job row; existing rows are kept for history"), `api-reference.md` says the same on two endpoints, and `createTenant`'s own comment explains why new tenants skip the step. Three permanently-zero counters are dashboard noise, not a blind spot — unlike the AI block, there is genuinely nothing happening for them to miss. **What separates F12 from this is the distinction worth carrying forward**: a metric that reads zero because nothing happens is fine; a metric that reads zero while the real work happens somewhere it cannot see is not.
- **`health`.** `getReadiness` gates `status` on exactly two things — a `SELECT 1` and the presence of `DATABASE_URL`/`SESSION_SECRET` — and `scripts/production-alerts-check.mjs` validates precisely those and nothing more, so the alerting surface is exactly as complete as readiness. The operator gate on the `authHardening` block is correct and well-argued (it is omitted rather than blanked, so "not for you" is distinguishable from "configured false"). **Migration drift was chased and deliberately not recorded**: nothing anywhere checks `_prisma_migrations` or pending migrations, and this project's production database has drifted behind its code before — but `docs/runbooks/production-deployment.md:74-84` names that exact failure ("code that ships ahead of its migration … does not surface as a failed deploy. It surfaces later, as a runtime error … typically a cron worker emailing `worker_task_failed` every run"), puts migrations in the API's pre-deploy command, and documents the free-instance fallback with its three costs. A risk that is named, mitigated and given a detection path is a decision, not a finding. Worth knowing that the detection path is *partial* — the cleanup worker only touches `AiJob` and `StorageObject`, so drift on any other model would not make it fail — but that is a refinement for Pass 6, not a defect here.
- **`worker`.** Read in full during Tier A. `parseWorkerTask` accepts only `cleanup` and `purge` and throws on anything else, both tasks are re-runnable, failures log `worker_task_failed`, capture to Sentry **awaited** (so the event is delivered before `app.close()` ends the process — a real ordering bug avoided), and set a non-zero exit code that Render surfaces as a failed cron run. `runCleanup` also exits non-zero when `storage.failedObjectCount > 0`, so a cleanup that ran but could not delete bytes is not reported as success. What invokes it in production and what happens if it stops is a Pass 6 question and stays open there.

One documentation drift found here and **left for Pass 5** rather than raised as its own finding, since Pass 5 is the doc sweep: `docs/vizitum-action-plan.md` §7 still carries "[x] Advance provisioning jobs beyond `queued`/`tenant_created` (`provision` worker task moves tenant `draft`→`ready`, job `queued`→`succeeded`)" as completed work. That worker task does not exist, and `data-model.md` correctly calls the whole area legacy — so the action plan is stale against the reference docs.

**`email`, `audit`, `pilot-review`, `prisma` — audited; no findings.** The four smallest modules, closing Tier C.

- **`email`** is the module F12 should be measured against, because it solves the same problem correctly. Both send paths never throw, and each says why: an invite must survive a mail outage because "the accept link shown in the UI is the guaranteed fallback channel", and a password reset must survive one because *surfacing* a send failure to the caller "would be exactly the account-existence signal that endpoint exists to withhold" — a security property expressed as error handling. Failures are logged at **error** level, with a comment confirming driver messages never contain the token or URL, and the outcome is persisted as `emailStatus` on the invite row. `isEnabled()` deliberately returns `true` when `EMAIL_PROVIDER` is *misconfigured* so the attempt fails loudly rather than degrading to a silent `skipped`. The console driver, which prints one-time tokens to the log, is refused in production by `security-config.ts` (closed security-plan work, re-confirmed in Tier A).
- **`audit`** (31 lines) is a thin recorder: `tenantId` from context, `actorUserId` from context, `requestId` carried, and an optional transaction client so the event commits or rolls back with the write it records — which is what lets `deleteTask` and `deleteRouteItem` pair a mutation with its trail atomically. Its weakness is the untyped `entityType`/`eventType` strings, already recorded as the second half of **F5**.
- **`pilot-review`** carries `@RequirePermissions(PERMISSIONS.PILOT_REVIEW_READ)`, scopes every one of its six aggregate queries on `context.tenantId` — including repeating the tenant predicate on nested relation filters — bounds them all by a `createdAt` window, and emits an audit event when a dashboard view is recorded. Its metric definitions show the same care seen in the announcements tally: a task whose visit was deleted is excluded so it cannot read as manager engagement.
- **`prisma`** (29 lines) is a `PrismaClient` subclass over `PrismaPg`, refusing to construct without `DATABASE_URL`, with `$connect`/`$disconnect` on the Nest lifecycle hooks. **The absence worth naming is the one F8 rests on**: no `transactionOptions` are passed, so every `$transaction` in the codebase inherits Prisma's 5-second default. That is the right place to fix F8 if the decision is a global raise rather than a per-call one.

---

| tier | modules | findings |
|---|---|---|
| A — decides who sees what | 7 examined (4 fully) | F6, F7 |
| B — tenant data | 11 examined (7 fully) | F4, F8, F9, F10, F11 |
| C — supporting | 9 examined (9 fully) | F2, F3, F12 |

**Twelve findings across the whole backend: one S2, nine S3, two S4, and no S1 at any point** — so the stop-the-line rule never fired.

The distribution is the result worth carrying into Pass 3. **Authorization, tenant isolation and ownership produced zero findings across all 24 backend modules and the three shared areas audited alongside them (27 units in total — `src/common/*`, the bootstrap and `worker` are not modules)**, and they were the axes checked hardest: 393 Prisma calls swept for a tenant predicate, 139 handlers checked for a permission declaration, every `*_OWN` permission traced to its enforcement. That is a genuinely strong data plane, and it matches the security remediation plan's own baseline verdict rather than merely repeating it.

Every finding instead sits on a seam:

- **code against its runtime** — a per-row loop measured against a fixed transaction budget (F8), an env var parsed only at first use (F2);
- **code against its twin** — a claim pattern applied in five places and missed in one (F7), a second factor required on the irreversible operation but not the one that causes the outage (F6), an error code mapped by three services and not by two (F10, F11);
- **code against its own description** — a comment asserting a control is unenforceable after it was enforced (F9), a documented API whose pipeline has no runner (F3);
- **code against what can be observed** — an unbounded response (F4), an outage that logs at info level into a dashboard structurally unable to see it (F12).

Three hypotheses were chased to the end and **deliberately not recorded** — contact reads in `locations`, migration-drift detection in `health`, the provisioning metrics in `operations` — because the reference docs or runbooks already named each as a decision. Rule #5 paid for itself repeatedly; the productive question in this codebase is rarely "is this handled?" but "**which sibling didn't get the same treatment?**"

### Skipped in this pass, and why

Rule #10. **Tiers B and C were not started at all** — 11 and 9 modules respectively, including all four size-and-churn hotspots (`imports` 2683, `visits` 2218, `locations` 1172, `users` 1103). Nothing in this document should be read as saying anything about them.

Within Tier A, the deliberate gaps are listed inline above; the two worth repeating because they are large surfaces rather than incidental files:

- **`auth.service.ts` and `password-reset.service.ts` are read on their credential paths, not exhaustively.** Covered: login's tenant resolution, `switchRole`/`switchZone`, `acceptInvite`'s superadmin replacement, and reset-token validation and spending. Not covered: invite creation and expiry handling, the forgot-password request path's per-account cap, and the authenticated password-change flow.

Also not done in Tier A: module question 7 (indexes matching filters — deferred to Pass 4 with the schema), question 8 (transactions and race safety) beyond the purge claim and the import-confirm TOCTOU already closed by the security plan, and question 10 (reference-doc agreement) which is Pass 5's job and is only spot-checked here where a finding depended on it.

---

## Pass 3 — Frontend, zone by zone

**The standard screen pass**, drawn from the conventions in `CLAUDE.md`:

1. No hardcoded UI literals; both `en` and `uk` present, `uk` a real translation — **swept, clean**
2. Every free-text input sets `maxLength` from `INPUT_LIMITS` — **swept, clean**
3. Every Server Action submit uses `PendingSubmitButton` with a specific `pendingLabel` — **swept → F13**
4. Back navigation via `BackLink` + `resolveBackTarget`, never a hardcoded destination; `from` carried through redirects
5. Portals gate on `useIsMounted`, not hand-rolled `useState`+`useEffect` — **swept, clean**
6. Server Actions do not close over plain helpers; shared logic via a `"use server"` module
7. No authorization decision made from client-supplied tenant slug
8. Loading, error and empty states all exist and are reachable
9. Panel/modal twins both updated (`location-potential-*`, `location-assortment-*`, `location-contacts-panel`)
10. Dates/numbers via next-intl formatters, honoring tenant timezone

### Shared foundations (audit before the screens)

- [ ] `apps/web/lib/api-client.ts` (2475 lines, 88 commits) — **top hotspot of the whole project**: error handling, cookie/session forwarding, response typing — **core plumbing audited → F14**; the 124 endpoint wrappers and the upload flows are unread

  **What the plumbing does right.** `buildRequestHeaders` forwards the inbound cookie header to a known backend host, picks the CSRF cookie by path namespace (`isPlatformApiPath`, mirroring `src/modules/auth/csrf.ts`'s own namespacing), propagates `x-request-id` so a browser request and its API log line correlate, and sends **one** `x-forwarded-for` entry rather than the inbound chain — with a comment explaining that passing the chain through would make the API's hop count depend on how many proxies happened to sit in front of the web layer, which is the `TRUST_PROXY_HOPS` hazard the security plan spent an item on. `apiPost`'s `forwardCookies` flag is off by default and documented: only the endpoints that rotate the session token need the API's `Set-Cookie` copied onto the response, and `cookies().set()` is only legal inside a Server Action or Route Handler anyway.

  **The shape of the client is also right for a seam.** `apiGet`/`apiPost`/`apiPatch`/`apiDelete` never throw and never redirect — they return a discriminated `ApiResult` carrying `status`, `message`, `code` and `details`, leaving the decision to the screen. That is what makes the error surface uniform enough for **F14** to be one fix rather than 25.

  Noted, not recorded as a finding: `getApiBaseUrl()` falls back to `http://127.0.0.1:4000/api` when `API_BASE_URL` is unset. That is the same shape as **F2** but fails fast rather than silently — a production web app pointed at localhost fails every request immediately and visibly, so there is no "looks healthy while broken" window to record.
- [x] `apps/web/lib/navigation.ts` (32 commits) + `back-navigation.ts` — allowlist and zone checks — **audited; no findings**

  `back-navigation.ts` is the clearest case in this audit of rule #4 earning its place: `tests/web-back-navigation.test.ts` already pins every vector worth probing, and its own comment names why — "`from` is attacker-controllable, so the allowlist is the only thing standing between it and an off-site or cross-tenant redirect". The pinned rejections are absolute URL, protocol-relative `//host`, backslash-folded host, unknown path, an already tenant-prefixed path, another tenant's path, empty, over-length, a newline in the path, and a repeated `?from=` that reaches the page as an **array** rather than a string.

  Verified independently against the implementation, since a passing test proves the cases it wrote, not the ones it didn't:

  - **Nothing is decoded before matching.** There is no `decodeURI`/`decodeURIComponent` anywhere in the validation path, so the raw string is tested against the `RETURNABLE_SCREENS` patterns. A percent-encoded traversal (`/field/%2e%2e/admin/...`) is not a decode-then-match bypass here — it simply matches no pattern and falls back. This is the failure this design most easily could have had, and it does not.
  - **The structural checks precede the allowlist**, not the reverse: string type, non-empty, `≤ MAX_FROM_LENGTH` (2048), starts with `/`, does not start with `//`, contains no backslash, and no character `≤ 0x1f` — which covers newline, carriage return, tab and NUL in one test rather than enumerating them.
  - **The zone check reads the zone off the `fallback`**, which is supplied by the receiving screen, never by the client — so the check cannot be turned against itself by crafting `from`. The label likewise comes from the matched screen's own `labelKey`, so the control cannot announce a destination other than the one it resolved to.
  - The query string is carried through verbatim (deliberately — it is the opener's filter state), but only ever appended to a path that already passed the allowlist, and only ever as a React attribute value, which is escaped. The fragment is stripped before any of this.

  `navigation.ts` was not read line by line: its load-bearing invariant — that a nav item cannot leak a whole zone by gating on a permission shared across roles, which has happened in this project before — is pinned by `tests/zone-permission-mirror.test.ts`, which asserts both sides agree on the zone set and that each zone's backend permission list equals the union of that zone's nav-item `requiredPermissions`. Confirmed passing in Pass 0.
- [x] `apps/web/lib/offline-drafts.ts`, `report-outbox.ts`, `field-db.ts`, `route-snapshot.ts` — offline layer; read `docs/plans/offline-field-drafts-plan-prompt.md` first for known gaps — **audited; no new findings, one instance added to F14**

  This is the most heavily reviewed area of the codebase and it shows. Its own plan doc enumerates the open gaps precisely, and the one that remains — scenario T2b, a cold offline launch on iOS falling to Safari's own error page — is measured on a real phone, separated into observation versus inference, traced to WebKit failing the launch navigation before any worker is consulted, and then **narrowed everywhere the promise had been stated** (`module-map.md`, `executable-spec.md`, `sw.js`, `lib/manifest.ts`, the manifest test, the e2e header and the runbook). Withdrawn rather than left standing. Nothing to add.

  What was checked independently, and holds:

  - **`field-db.ts`'s upgrade path survives arriving from any version.** `onupgradeneeded` iterates the five stores and creates each one that is missing, rather than switching on the old version — so a device coming from v1, from none, or from a *half-applied* upgrade that reached a version without its store ends up with all five. That was the failure mode worth hunting (five stores added incrementally over the series, each a version bump) and it is handled with the reasoning written down. A failed open is cached as unavailable for that attempt only, so a dismissed quota prompt does not disable storage for the session. `KEY_SEPARATOR` is NUL, chosen because it is the one separator that cannot be smuggled into a slug, user id or visit id to collide two scopes.
  - **Store lifetimes are separated deliberately**, and the comment says why conflating them would delete the wrong thing at sign-out: drafts are retypeable so they clear; media bytes are not recreatable so they survive; the two outboxes are never swept by age "because a report nobody sent is not stale, it is missing"; the route snapshot is not user-scoped because `offline.html` — a plain script with no session — has to read it.
  - **`report-send-outcome.ts` is the best-argued file read in this audit.** It is pure and deliberately separated from the code performing the attempt, with a header stating why: "getting this classification wrong is the one way this feature can hurt". `status: 0` → queue; 401 → sign-in required; 408/429 → queue, since the server never got far enough to judge the report; 5xx → queue, because a rep in a shop cannot act on "internal server error" and the idempotency token makes a retry free; `VISIT_NOT_FOUND` → queue, covering the one real race where a confirm outruns its own offline visit-start; everything else → rejected, kept rather than deleted so finished work is not thrown away. `outcomeForThrownSend()` exists because a Server Action with no network throws before any of api-client's handling runs.

  Not read: `offline-drafts.ts` (586 lines) beyond its store contract, `route-snapshot.ts`, `visit-start-outbox-flush.ts`, and `sw.js`/`offline.html` — which have their own checkbox below.
- [x] `apps/web/public/sw.js` (191) + `offline.html` (515) — the field zone's offline shell — **audited; no findings.**

  **The gap this checkbox predicts does not exist, and that is the useful result.** The plan's own note reasons that both files restate shared constants as literals, so "a rename on the TS side that misses them breaks the shell silently, with nothing red anywhere", and asks what `tests/web-app-manifest.test.ts` does *not* cover. Checked, in the order the note suggests:

  - The literals do currently agree — `offline.html:164-165` restates `DATABASE_NAME = "vizitum-field"` and `ROUTE_SNAPSHOT_STORE = "route-snapshot"`, matching `field-db.ts:33` and `:42`. It opens **without a version** (`indexedDB.open(DATABASE_NAME)`), which is right: a plain script with no session has no business triggering an upgrade transaction, and it guards on `objectStoreNames.contains(...)` before reading.
  - `tests/web-app-manifest.test.ts` indeed does **not** pin those two literals. It pins a different pair of agreements — that `FIELD_ZONE_PATH` is still a plain regex literal in `sw.js` (with a failure message telling the next reader the test itself needs updating), that the tenant manifest's `start_url` sits inside the worker's fallback scope, that `offline.html` still recovers the slug from the first path segment, and that the origin-wide manifest stays *outside* the worker's scope.
  - **The DB literals are covered anyway, by a mechanism the note did not consider**: `apps/web/e2e/field-offline-shell.spec.ts:119` asserts `#stops` contains the seeded location name after an offline reload. Rename either constant on the TS side and the writer writes one name while the shell reads another, the shell falls to "No offline data yet", and that assertion fails. **And `web:e2e` runs in CI** (`.github/workflows/ci.yml:109`), so this is enforced on every change rather than only when someone remembers. This is why **F15**'s scope stops at the five TypeScript-side mirrors and does not extend into `public/`.

  `sw.js` itself is a complete, correct hand-rolled worker, including the two things this shape usually gets wrong: `activate` deletes every cache whose name is not one of the current two, and the static cache is bounded at `MAX_STATIC_CACHE_ENTRIES = 200` with eviction rather than growing forever. `install` precaches only `offline.html`; the fetch handler serves the shell for failed navigations into `/field` and is cache-first only for content-hashed `/_next/static/` assets, so no API, JSON or RSC response is ever cached. The cold-start iOS limitation in its header is the documented, withdrawn promise from the offline plan — not re-reported.
- [ ] `apps/web/messages/{en,uk}.json` (1824 lines each, 90 commits each) — keys present in one dictionary and not the other, orphaned keys no component reads, `uk` entries that are stubs rather than translations
- [x] `apps/web/lib/content-security-policy.ts`, `canonical-host.ts`, `backend-cookies.ts` — plus `proxy.ts`, whose `matcher` decides which pages get a CSP at all — **audited; no findings**

  **Both lines of defence from the security plan's `[tenantSlug]` finding are intact, including across a refactor that could have dropped one.** The matcher anchors its skip list on a *real file extension at the end of the path* rather than the `.*\..*` shape most Next examples use — its comment records exactly what that fixed: `[tenantSlug]` can hold anything, so `/acme.x/field` used to render the real session-authenticated app with no CSP and no nonce, losing an XSS its main mitigation to one extra character. The second line, `notFound()` for anything not slug-shaped, **survived the move into the `(workspace)` route group** — it is still in `app/(workspace)/[tenantSlug]/layout.tsx`, and `tests/web-tenant-slug-shape.test.ts` still targets it. That was the specific regression worth checking, since the security plan documented the guard at the pre-route-group path.

  **The policy itself is tight and every directive carries its reason.** `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` (so nothing can aim one of our forms off-origin) and `frame-ancestors 'none'` (the clickjacking fix — the login screens were framable). `script-src` is nonce + `'strict-dynamic'`, with `https:` present only as the fallback for pre-CSP3 browsers that ignore strict-dynamic, and `'unsafe-eval'` gated to development because React's dev build needs it and its production build does not. The nonce is minted per request in the proxy and set on both the request and response headers, which is what lets Next stamp it onto the tags it renders. Two deliberate looseness points are documented as such: `style-src 'unsafe-inline'` ("inline CSS is a far weaker vector than inline script, so this is the usual place to stop tightening") and `connect-src https:`, which is broad because presigned storage hosts are runtime configuration, and is already flagged in-code as worth narrowing once storage sits on a fixed custom domain.

  `canonical-host.ts` redirects only hostnames on an explicit allowlist, and redirects them to a **constant** `CANONICAL_ORIGIN` — the destination is never derived from the request's own `Host` header, which is the usual way this shape becomes an open redirect. It uses 307 rather than 308 with the reasoning written down (a 308 is cached for the life of the browser profile and would strand everyone on the alias). `backend-cookies.ts` re-sets cookies parsed from our own API's `Set-Cookie`; its comma-splitting heuristic is the standard one and its inputs are session and CSRF tokens with no commas.
- [ ] `apps/web/components/field-visit-report-form.tsx` (2060 lines) — largest component — **partially audited**: three findings came out of it (**F14**'s sharpest instance, **F13**'s submit button, **F15**'s mirrored constant) and the two on-device lifecycles below were checked and are clean. The rest of the form body — the shelf-check panel, product chips, the photo-capture flow and roughly 1500 lines of rendering and state — is **not** read and must not be treated as covered.

  **Media lifecycle — clean.** This was the axis worth checking hardest, because a live microphone or a leaked blob on a phone is invisible in review and obvious in the field. `URL.createObjectURL` appears exactly once and its `revokeObjectURL` is the same effect's cleanup. The recorder holds its stream in a ref and `releaseMicrophone()` stops every track; it is called from **seven** sites covering each exit — the error path, the normal stop, the max-duration timeout, and a mount-only effect whose cleanup runs `clearRecordingTimeout()` then `releaseMicrophone()`, so navigating away mid-recording releases the mic. An `unmountedRef` guards the async continuation after `getUserMedia` resolves, so a rep who leaves while the permission prompt is up does not get a setState into an unmounted tree. The `pendingAudio` → `pendingAudioUrl` reset uses React's documented adjust-state-during-render pattern rather than a third effect, with the reason noted.

  **Draft persistence — clean, and it already closes the trap.** The hook writes the draft on unmount, which is exactly what makes `CancelVisitModal` deliberately not delete it (deleting would lose that race and resurrect it). The obvious consequence to hunt is the *successful* path: confirm deletes the draft, the redirect unmounts the form immediately, and the unmount flush writes it straight back — leaving a completed visit showing an unsent draft. `use-field-report-persistence.ts:75` carries a flag set once the report is confirmed, with a comment naming that exact sequence including "the redirect makes that unmount immediate".
- [x] `apps/web/components/app-shell.tsx` (23 commits) — **audited; no findings**

  `AppShell` is a server component that resolves the current zone from `activeArea`, fetches the session, translations and both nav badge counts in one parallel round-trip, and — the load-bearing part — **enforces zone access**: a caller whose `availableZones` do not include the current zone is redirected to their own landing zone, or to `/choose-zone` when there isn't one. Its own comment records the structural consequence: there are no per-zone `layout.tsx` files, so every zone page renders `AppShell` and this is the only place the frontend gate exists.

  That makes "does every zone page actually render it?" the question worth asking, and nothing checks it. Verified by hand across all 46 workspace pages: **33 render `AppShell`, and every one of the 13 that do not is legitimate** — the four under `admin/` (`admin`, `admin/chains`, `admin/review`, `admin/setup`) are *pure redirects* that render nothing and forward to a page that is gated; six are pre-auth or zone-selection screens that must not have a shell (`login`, `password/forgot`, `password/reset`, `invites/accept`, `choose-zone`, and the tenant entry page); three are `platform/*`, which has its own console layout.

  Recorded but **not** raised as a finding, per rule #2: the convention holds today with nothing enforcing it, so a *new* zone page that forgets `AppShell` would carry no frontend zone gate and nothing would flag it. The blast radius is bounded — the backend gates every endpoint independently, so such a page would render its chrome and fill with 403 error panels rather than leak anything — which is why this is a note rather than a defect. Worth a test the day a fifth zone-level page is added by someone who has not read this.

- [x] `apps/web/app/globals.css` (7094 lines, 108 commits — highest churn in the repo) — dead selectors, duplicated rules — **27 dead selectors → F16**; zero duplicated rules across 921 blocks

### Shared foundations closed — 8 of 8

`api-client.ts` → **F14**; `globals.css` → **F16**; the report form → **F13**, **F14**, **F15** (body's media and draft lifecycles clean, the other ~1500 lines unread). `navigation`/`back-navigation`, the offline layer, `sw.js`/`offline.html`, the CSP/proxy group and `app-shell` are clean.

**The pattern across the eight is consistent enough to steer the zone pass.** Every *mechanism* audited came back clean — offline send classification, IndexedDB upgrades, back-origin validation, the CSP matcher, the microphone and blob lifecycles, draft resurrection, service-worker cache eviction, zone gating. In each case the hypothesis worth testing had already been considered, with the reasoning written beside the code.

All four Pass 3 findings instead came from things that **repeat across many files with no machine check**: a pending state on 10 buttons, `.message` on 25 screens, a constant in 5 places, a selector in 27. And the one case that looked like that shape but was not — `offline.html`'s restated IndexedDB names — turned out to be covered by an e2e assertion that runs in CI. So the criterion for the remaining zone pass is not "is there a convention here" but "**what would fail if this convention were broken?**" Where the answer is "nothing", that is where to look.

### Zones (50 routes)

- [x] `(public)` — 4 routes: landings + sign-in; confirm both landings stay prerendered and the i18n-provider pinning still holds — **both confirmed**

  Prerendering was verified in Pass 0: `web:build` reports `○` for `/` and `/en`. The provider pinning holds, and holds for the reason `CLAUDE.md` gives rather than by luck. The two sign-in pages — the ones that render `WorkspaceEntry`, and through it `PendingSubmitButton`, which calls `useTranslations` unconditionally — each pin their own `NextIntlClientProvider`. The two landings pin none and need none: `(public)/page.tsx` imports `messages/uk.json` directly and passes it to `<Landing messages={t} …>` as a prop, and `landing.tsx` takes `messages` as a prop with no hook at all ("The caller pins the dictionary and passes the messages down"). Nothing in the landing tree can reach the provider-dependent path.
- [ ] `[tenantSlug]/page.tsx` (the workspace entry itself), `login`, `password/forgot`, `password/reset`, `invites/accept`, `choose-zone`, `no-access`, `account` — 8 routes — **conventions swept, screen bodies not read**

  Covered by the four global sweeps. Back navigation: only `account` carries a `BackLink` in this group and it resolves through `resolveBackTarget`; the other seven are entry or terminal screens with none, which is correct — they are not reached *from* somewhere inside the app. Established in the `app-shell` audit rather than here: six of these eight deliberately render no `AppShell`, because they are pre-auth or zone-selection screens that must not have one. The `login-error.ts` code-to-key mapping that serves this group is the pattern **F14** and **F21** both point at as the fix.
- [ ] `[tenantSlug]/admin/*` — 11 routes; `admin/locations/page.tsx` is 1699 lines — **conventions swept, screen bodies not read**

  Covered by the four global sweeps across all 50 routes (questions 1, 2, 3 and 5). Back navigation (question 4) is clean: only one screen in the zone carries a `BackLink` — `admin/locations/[locationId]` — and it resolves through `resolveBackTarget`. Four of the eleven routes are pure redirects (`admin`, `admin/chains`, `admin/review`, `admin/setup`), established while auditing `app-shell`, which is also why they legitimately render no shell. No raw date formatting: the global sweep's five `Intl.DateTimeFormat` uses are all outside this zone.

  One finding, **F21**, from the one pattern in the zone that repeats without a check — `admin/users/page.tsx` round-trips API error text through the URL across seven Server Action redirects and renders the parameter back unvalidated.

  **Not read**: all eleven screen bodies, including `admin/locations/page.tsx` (1699 lines — the largest screen in the app, and a listed hotspot), and screen-pass questions 6, 7, 8, 9 and 10 for this zone.
- [ ] `[tenantSlug]/manager/*` — 9 routes; `manager/tasks/page.tsx` is 1094 lines, 27 commits — **conventions swept, screen bodies not read**

  Back navigation is clean across the zone: every `BackLink` resolves through `resolveBackTarget` (`manager/visits/[visitId]`, `manager/locations/[locationId]`), so **F17** is specific to the field zone rather than a zone-wide habit. Date handling is clean: `manager/tasks:133` and `manager/announcements:74` use `Intl.DateTimeFormat("en-CA", { timeZone })`, which is an ISO *key* in the tenant's zone, not display formatting bypassing next-intl.

  **The panel/modal twins were probed and no drift was demonstrated.** `CLAUDE.md` warns that `location-potential-*`, `location-assortment-*` and `location-contacts-panel` come in twins and "a change to one has to hit all of them" — a documented duplication with no machine check, which is exactly the shape that produced F15 and F16. It does not hold here: the two are not copies but different roles — the modals are editor dialogs under their own `*Modal.*` message namespace, the panels are lists with inline remove — so their message-key sets diverge by design and a key diff is the wrong instrument. Their remove controls use `PendingSubmitButton` correctly, including `pendingLabel={null}` on the icon-only variant exactly as the convention requires, which incidentally confirms **F13**'s ten hand-rolled buttons are genuine exceptions rather than the norm. Checked and deliberately **not** recorded: the panels delete a row on a single tap with no confirmation step, and `ConfirmActionButton` exists but is not used here. No convention in `CLAUDE.md` requires one, the rows are re-addable, and calling it a defect would be design opinion rather than a finding — noted so the next reader knows it was considered.

  **Not read**: the nine screen bodies themselves, including `manager/tasks/page.tsx` (1094 lines, 27 commits — a listed hotspot), and screen-pass questions 6 and 8 (Server Action helper closure, and whether loading/error/empty states are all reachable) for this zone.
- [ ] `[tenantSlug]/field/*` — 14 routes; highest real-world usage, offline paths — **conventions swept, screen bodies not read**

  Covered by the four global sweeps that ran across all 50 routes at once (screen-pass questions 1, 2, 3 and 5 — see the mechanical-sweeps section below): dictionaries, `maxLength`, portal mounting and pending states. Question 3 is the one that produced **F13**, and two of its ten hand-rolled buttons are in this zone — `field/today-route-drag-list.tsx:484` and `components/location-notes-modal.tsx:101`, the two that set no `disabled`, no spinner and no label change at all.

  Back navigation (question 4) was checked across the whole zone rather than sampled, and is where **F17** came from: thirteen of the fourteen screens pass `backTarget.href` from `resolveBackTarget`, `field/tasks/page.tsx:342` is the only hardcoded `BackLink` in the zone, and `withBackOrigin` was counted at 22 uses across 9 files here — including twice in the same file whose task deep link omits it.

  **Not read**: all fourteen screen bodies, and the six screen-pass questions no global sweep covered for this zone (4 is answered only for the back controls above, and 6, 7, 8, 9 and 10 not at all). The offline paths this entry names are audited in the shared-foundations section above, not here — that covers the libraries and the service worker, not these screens' use of them.
- [ ] `[tenantSlug]/operations` — 1 route — **conventions swept, screen body not read.** Covered by the four global sweeps; no `BackLink`, no reflected `searchParams` render. It is one of the 25 screens rendering a raw `result.message` (**F14**).
- [x] `platform/*` — 3 routes; renders in `en` by design — **design confirmed, and it is what excludes this zone from two findings.** These three pages call **no** next-intl API — zero `useTranslations`/`getTranslations` across the zone — so their hardcoded English is the documented design rather than an i18n violation, and their own `result.message` renders are correct where the same pattern is **F14** in a tenant zone. Seven of **F13**'s ten hand-rolled submit buttons are here, which is why that finding is scoped to the two field-zone ones. **F1** lives on `platform/tenants`. No `BackLink` in the zone. Screen bodies not read.
- [ ] Accessibility sweep: labels, focus order, `aria-busy`/`aria-label` on icon-only controls
- [ ] Mobile viewport sweep of the field zone (the primary device for this role)

### Mechanical sweeps across every screen, run 2026-08-05

Four of the ten screen-pass questions are mechanically checkable across all 50 routes at once, so they were run globally before reading any individual screen. Three came back clean; one produced **F13**.

- **i18n dictionaries (question 1) — clean.** `en.json` and `uk.json` hold **1676 keys each, with zero keys present in one and absent from the other**. Nine values are byte-identical across the two, and all nine are legitimately so: the brand name (`common.appName`, `common.nav.ariaBrand`), three pure format patterns (`{from} – {to}`, `{date}, {weekday}`, `{completedPercent}%`), two placeholders (`name@company.com`, `your-workspace`) and `Email`, which is the same word in Ukrainian. No stub translations. `npm run web:i18n:check` separately confirms no Cyrillic literals outside `messages/`.
- **`maxLength` coverage (question 2) — clean.** 197 `<input>`/`<textarea>` tags across `app/` and `components/`; exactly one lacks `maxLength`, and it is the `readOnly` copy-to-clipboard summary box on the admin pilot screen, which takes no input. **Method note for a re-run**: a naive `<input …>` regex is wrong here — JSX attributes contain arrow functions whose `>` truncates the match, which produced nine false positives on the first attempt. Extract the tag with a brace-depth counter instead.
- **Portal mounting (question 5) — clean.** The only two components combining `createPortal` with a `useState(false)` both import and use `useIsMounted`; the boolean state is unrelated (`discarding`, `open`). No hand-rolled mount flags remain.
- **Pending states (question 3) — F13.** Ten hand-rolled `<button type="submit">` remain outside `PendingSubmitButton`, and none of the ten carries the `is-pending`/`aria-busy` pair `CLAUDE.md` requires of components that manage their own transition. Eight at least disable and swap their label; two — both field-zone, both touch-first — do nothing at all.

### Skipped in this pass, and why

Rule #10, and this is the pass with the most partial coverage in the audit — read it before treating any part of the frontend as covered.

**Four of the ten screen-pass questions were swept globally** across all 50 routes at once (1 dictionaries, 2 `maxLength`, 3 pending states, 5 portal mounting), which is what the mechanical-sweeps section above records. **Six were not:**

- **4. Back navigation** — answered only for the back *controls* themselves, and only in the two zones below. Whether `from` is carried through every Server Action redirect, as the convention requires, was not checked anywhere.
- **6. Server Actions do not close over plain helpers** — not checked in any zone.
- **7. No authorization decision made from client-supplied tenant slug** — not checked at screen level. The related backend question was answered in Pass 1, and `app-shell`'s zone gate plus the `[tenantSlug]` slug-shape guard were read in the foundations, but that is not the same as auditing what each screen does with the slug it receives.
- **8. Loading, error and empty states all exist and are reachable** — not checked. **F14** touches the error state's *text* on 25 screens, which is not the same as establishing the three states exist and are reachable.
- **9. Panel/modal twins** — probed once, in the manager zone, where no drift was demonstrated. The other zones' twins were not compared.
- **10. Dates/numbers via next-intl formatters** — checked only where it surfaced incidentally: the five `Intl.DateTimeFormat` uses found outside the shared formatters, two of which are manager screens. No zone was swept for this.

**All seven zones have now been swept for conventions; none has had its screen bodies read.** Each zone carries its own note above stating exactly what its sweep covered. Two are ticked because their checkbox asked a question a sweep can fully answer — `(public)` (prerendering and provider pinning) and `platform/*` (that it renders in `en` by design). The other five stay unticked: a convention sweep is not a screen audit, and the distinction is the whole point of leaving them open.

**No screen body was read in any zone** — 50 `page.tsx` files, none of them opened for its own logic. That includes the two the plan itself flags by size: `admin/locations/page.tsx` (1699 lines) and `manager/tasks/page.tsx` (1094 lines, 27 commits). The one large component that *was* partly read, `field-visit-report-form.tsx`, is a shared foundation rather than a screen, and its own entry records that ~1500 lines of it are still unread.

**Neither of the two sweeps at the foot of the zone list was run**: the accessibility sweep (labels, focus order, `aria-busy`/`aria-label` on icon-only controls) and the mobile viewport sweep of the field zone. The first is partly prejudged by **F13**, which found ten hand-rolled submit buttons carrying neither `aria-busy` nor `is-pending` — that is a reason to expect the sweep to find more, not a substitute for running it.

What *is* closed is the shared-foundations list — 8 of 8, with its own summary above.

---

## Pass 4 — Data layer

- [x] Every tenant-owned model carries `tenantId` and the indexes to filter on it — **35 of 39 models are tenant-owned, and all 35 carry an index or unique constraint whose leading column is `tenantId`. Zero exceptions.**
- [x] `onDelete` behavior is deliberate on every relation, not defaulted — **59 owning-side relations, all 59 with an explicit `onDelete`. Nothing left to Prisma's default**, which is unusual and worth stating plainly: the default would have been silently reasonable in most cases, and someone chose not to rely on it.
- [x] Nullable columns that the code assumes are non-null — **no evidence of any.** `tsc` enforces this already, so the check is really "what asserts around it": there is **not one non-null assertion (`!.`) anywhere in `src/`**, and every `as` cast in the services is either on `confirmedData` (deliberately opaque JSON, each followed by an `isRecord()` guard) or immediately preceded by the membership test that justifies it.
- [x] Enums with retired values still referenced in code — **clean, and by construction rather than by diligence.** `TenantStatus` does still carry the retired `draft`/`provisioning`/`ready`/`active` (it must — old rows hold them), but `tenant-serving-status.ts` judges them with an **allowlist** of the three plan tiers, so anything retired is refused without needing to be listed. Across 31 enums only two values are unreferenced in code: `DatabasePlacement.dedicated`, which is the documented forward-looking half of the hybrid tenancy model, and `ReportStatus.discarded`, which nothing writes or reads.
- [x] Migrations: none edited after being applied; sequence replays cleanly on an empty database — **45 migrations, every one with exactly one commit in `git log`** — none has been touched since it landed. The replay half was done in Pass 0 against a throwaway database, together with `migrate diff --exit-code` returning 0.
- [ ] Production drift check — `prisma migrate status` against the production schema (this has drifted before) — **not doable from this session**: it needs production `DATABASE_URL`, which is deliberately not available here. Left open rather than waived; see Skipped.
- [x] Orphan-row classes reachable by current code paths — **one found, F18.** The `onDelete` sweep above cannot see it, because the relation it concerns has no foreign key at all: `Product.category` is a free-text string.
- [x] `data-model.md` matches `schema.prisma` — **all 39 models appear in the document.**

### Result, run 2026-08-05

One finding, **F18**, and it came from the one checkbox a schema-level sweep is structurally blind to. That is the lesson worth carrying: every mechanical axis here — index coverage, `onDelete`, nullability, enum hygiene, migration immutability, doc agreement — came back **perfectly** clean, 0 exceptions out of 35, 59, 45 and 39 respectively. The defect was in the gap between the schema and the code, on the one reference the schema does not model.

### Skipped in this pass, and why

**The production drift check is the one item left open.** It requires a production `DATABASE_URL` and cannot be run from a development session. It matters more than its single line suggests: this project's production database has drifted behind its code before, `docs/runbooks/production-deployment.md` records that "code that ships ahead of its migration … does not surface as a failed deploy", and Pass 2 established that `/health/readiness` does not check migration state either. Whoever has production access should run `npx prisma migrate status` against it before the pilot and record the result here.

Also not attempted: index *efficacy* — whether the indexes that exist are the ones the actual `where` clauses use, as opposed to merely existing on `tenantId`. That needs `EXPLAIN` against a database with representative row counts, which no environment here has.

---

## Pass 5 — Tests and documentation

- [x] Map the 173 test files **and the 12 Playwright specs** against `docs/reference/executable-spec.md` — **all 173 and all 12 are mapped; zero unreferenced**
- [ ] Identify contracts with **no** test: list them as S4 findings — **not enumerated**, see Skipped
- [x] Tests that assert nothing meaningful — **no test file lacks an assertion.** The stronger reading (a test that holds even when the code is wrong) was not attempted; see Skipped
- [x] `docs/reference/api-reference.md` — every endpoint present — **all 139 handlers appear**; permission correctness was cross-checked against the code in Pass 1 rather than here
- [x] `docs/reference/module-map.md` — **24 of 24 modules present**, and the route count matches at 50 `page.tsx` files
- [x] `docs/reference/permissions.md`, `environment.md`, `feature-spec-gates.md` — `environment.md` verified exhaustively in Pass 1 (all 60 variables read in code are documented); `permissions.md` was read against the code in Passes 1–2, including the contacts read/write tier split that stopped a wrong finding
- [ ] `AGENTS.md` "Current State" and `docs/vizitum-action-plan.md` §3/§4 reflect reality — §7 does **not** → **F19**
- [x] `AGENTS.md` "Documentation Map" lists every file under `docs/plans/` — **all four named here are still unlisted** → **F19**
- [x] Plan documents in `docs/plans/` that describe work already finished — `dto-migration-tiers-4-6-plan-prompt.md` already reads "Complete as of 2026-08-04 … the track is closed"; `visits-dto-migration-note.md` does the opposite and claims "no code yet" for work that shipped → **F19**
- [x] **Carried in from Pass 2 (`operations`)**: the stale `provision` worker-task checkbox in `docs/vizitum-action-plan.md` §7 → **F19**

### Skipped in this pass, and why

- **"Contracts with no test" was not enumerated**, and it is the largest thing left in this pass. It needs `executable-spec.md`'s contract list read against Pass 2's module notes, and it is the Pass 5 item most likely to yield more findings — **four of this audit's own findings (F15, F16, F17, F18) exist precisely because a stated convention had no test**. What *was* established is the opposite direction: every test that exists is mapped, and none is assertion-free.
- **"Tests that pass regardless of the behavior under test"** was answered only in its weak form — no assertion at all, of which there are none. The strong form (assertions that hold even when the code is wrong) cannot be settled by reading; it needs mutation testing or breaking each behavior deliberately, which a read-only pass cannot do.
- **Permission correctness in `api-reference.md`** was not re-verified row by row here. It was cross-checked against the code during Pass 1's authorization sweep instead, which is the stronger direction anyway.

---

## Pass 6 — Operations and delivery

- [x] Runbooks in `docs/runbooks/` still match the deployed topology — **yes, and the deployment runbook is ahead of the action plan.** `production-deployment.md:90` states plainly: "There is no longer a provision worker … the `worker:provision`/`worker:provision:prod` npm scripts and the underlying `ProvisioningService` were removed", and tells an operator to disable a leftover cron. That is the same fact `docs/vizitum-action-plan.md` §7 still records as shipped work — independent confirmation of **F19**'s third instance, from the document an operator actually follows.
- [x] Alerting: `npm run alerts:check` covers the failures that would actually page someone — **it covers what readiness reports and nothing more**: HTTP status, `status: "ready"`, `checks.database.status`, `checks.criticalEnvironment.status`. Established in Pass 2 that this is exactly as complete as `/health/readiness`, whose `status` gates only on a `SELECT 1` and two environment variables. The two gaps this leaves — storage configuration (**F2**) and AI provider health (**F12**) — are already recorded
- [ ] Backup/restore drill record is current (`npm run restore:drill:check`) — **not runnable here**: the script refuses without a `DATABASE_URL` pointing at a restored recovery database. See Skipped
- [x] Worker scheduling: what invokes cleanup/purge in production, and what happens if it stops — **documented**: both run as provider cron jobs (`worker:cleanup:prod`, `worker:purge:prod`) with "Non-zero exit alert and `worker_*_completed` log" as the signal, which Pass 2 verified the worker actually produces (awaited Sentry capture, non-zero exit, and a non-zero exit even for a *partial* cleanup failure). Worth stating the asymmetry the runbook does not: a worker that **fails** alerts, a worker that is never **scheduled** — or is disabled — produces no signal at all, because the only evidence is the absence of a log line nothing watches for
- [x] Log hygiene: no PII, tokens or full request bodies written to logs — **no tokens, no bodies.** The access log carries method, path, status, duration and user-agent only; `JsonLogger` writes named structured fields; every `@Query()` in the codebase is a list filter, so nothing secret rides the query string into `originalUrl`. Two candidates were chased and cleared: `turnstile.service.ts:109` reads "Turnstile rejected a login token" but stringifies `outcome["error-codes"]`, not the token; and password-reset logs carry `tenantSlug`/`requestId`, never the address. **Noted, not recorded**: `email.service.ts` logs the recipient address (`to:`) on invite and reset sends. That is PII in a log, but it is the address of a mail the tenant just chose to send, it is already in the database unhashed, and the security remediation plan reviewed this file and drew its line at *tokens* — refusing `EMAIL_PROVIDER=console` in production precisely because that driver logs them. A decision, not an oversight
- [x] CI covers everything Pass 0 runs locally — **all ten**, including the backend suite and Playwright. Method note for a re-run: `ci.yml` invokes the backend suite as `npm test`, not `npm run test`, so a grep for the latter reports it missing and would produce a serious false finding
- [x] Dependency freshness beyond advisories — **7 behind, 3 by a major** → **F20**

### Skipped in this pass, and why

- **The restore drill could not be run.** `scripts/restore-drill-check.sh` requires `DATABASE_URL` to point at a *restored* recovery database, which no development environment has. This is the second of the two items this audit cannot answer from here — the first is Pass 4's production migration-drift check — and both are gates on the same event: `AGENTS.md` lists the restore drill as a final production-pilot gate, and `docs/runbooks/production-launch-readiness-record.md` is where the evidence belongs. Whoever performs the drill should run both checks in the same session.
- **Alert *thresholds* were not evaluated**, only alert *coverage*. Whether "database reachable and two env vars present" is the right bar for paging someone is a product decision about the pilot's tolerance, not something this pass can settle from the code.

---

## Progress

Update after each pass. `Findings` counts only recorded, verified findings.

| Pass | Status | Findings (S1/S2/S3/S4) | Date | Notes |
|---|---|---|---|---|
| 0 — Automated baseline | done | 0/0/2/0 | 2026-08-05 | Every check green; both findings came out of the e2e run's logs, not a failed assertion |
| 1 — Cross-cutting axes | mostly done | 0/0/2/0 | 2026-08-05 | Tenant isolation holds under mechanical check; 5 axes deferred — see Skipped |
| 2 — Backend modules | **done** — all 24 modules examined, plus the 3 non-module units (`src/common/*`, bootstrap, `worker`); Tier C 9/9, Tier B 11/11 (7 fully), Tier A 7/7 (4 fully) | 0/1/5/2 | 2026-08-05 | F2, F3, F4, F6, F7, F8, F9, F10, F11, F12. Zero findings on authorization, tenant isolation or ownership. 7 boxes deliberately unticked = audited on named paths; each module's note lists what was left |
| 3 — Frontend zones | 8 foundations done; **all 7 zones swept for conventions**; no screen body read in any zone | 0/0/3/3 | 2026-08-05 | Sweeps → F13; `api-client.ts` → F14; mirrors → F15; `globals.css` → F16; field back-origin → F17; admin reflected param → F21. Accessibility and mobile sweeps not run |
| 4 — Data layer | done, except the production drift check | 0/0/1/0 | 2026-08-05 | F18 (product-category orphans). Every schema-level axis clean with zero exceptions: 35/35 tenant indexes, 59/59 explicit `onDelete`, 45/45 unedited migrations, 39/39 documented models |
| 5 — Tests and docs | done, except enumerating untested contracts | 0/0/0/1 | 2026-08-05 | F19 (three drifted prose records). Machine-checkable records are exact: 173/173 tests + 12/12 specs mapped, 139/139 endpoints, 24/24 modules, 0 assertion-free tests |
| 6 — Operations | done, except the restore drill | 0/0/0/1 | 2026-08-05 | F20 (3 majors behind). CI covers all 10 Pass 0 commands; logs carry no tokens or bodies; the deployment runbook independently confirms F19's provisioning drift |

## Findings

**21 findings: 0 S1 · 1 S2 · 13 S3 · 7 S4.** The stop-the-line rule never fired.

Where they came from is the result worth reading before the list. **Authorization, tenant isolation and ownership produced zero findings across all 24 backend modules and the three shared areas audited alongside them (27 units; `src/common/*`, the bootstrap and `worker` are audit units, not modules)**, and those were the axes checked hardest — 393 Prisma calls swept for a tenant predicate, 139 handlers for a permission declaration, every `*_OWN` permission traced to its enforcement. Pass 4 found the schema equally exact: 35/35 tenant indexes, 59/59 explicit `onDelete`, 45/45 unedited migrations, 0 non-null assertions. Pass 5 found every machine-checkable record accurate: 173/173 tests and 12/12 specs mapped, 139/139 endpoints and 24/24 modules documented.

Three gaps recur, and the examples under each are illustrative rather than an exhaustive classification — a few findings (notably **F1**, **F3**, **F4**, **F5**, **F9**, **F20**) sit at the edges of more than one:

- **Between code and its runtime** — a per-row loop against a fixed transaction budget (**F8**), an env var parsed only at first use (**F2**), a metric counting the wrong table (**F12**).
- **Between a thing and its twin** — a claim pattern applied five times and missed once (**F7**), a second factor on the irreversible operation but not the one causing the outage (**F6**), an error code mapped by three services and not two (**F10**, **F11**), a cascade on rename but not on delete (**F18**), a redirect carrying an error *code* on one screen and raw reflected text on another (**F21**).
- **Between a convention and anything that checks it** — pending state on 10 buttons (**F13**), `.message` on 25 screens (**F14**), a constant in 5 places (**F15**), a selector in 27 (**F16**), a back-origin on one journey (**F17**), three prose records (**F19**).

That third group is the largest, and it is the one a reader should act on structurally rather than item by item: in every case the convention was written down and nothing compiled, diffed or asserted it.

Recorded in the format above, newest first. Every entry must also be filed into the matching backlog section of `docs/vizitum-action-plan.md` — the `Filed:` line is not optional.

### [S3] F21 — The admin users screen renders an unvalidated query parameter as its own error message

- Where: `apps/web/app/(workspace)/[tenantSlug]/admin/users/page.tsx:369` — `body={pageState.message ?? t("errorFallback")}`, where `pageState` is `await searchParams`
- Failure: `?message=` is read straight off the URL and rendered as the body of a `DismissableNotice`, with no validation of either it or the `error` param that gates it (both are declared `?: string` and used as-is). A crafted link to a tenant's own admin users screen — `/{tenant}/admin/users?error=1&message=<anything>` — therefore renders arbitrary attacker-supplied text inside the application's own danger notice, wrapped in the app's translated eyebrow and title, on the most privileged screen a tenant has. The frame is first-party; only the sentence inside it is the attacker's.
- **Why the parameter exists**, which is what makes this a defect rather than a design choice: the same file redirects into it from **seven** Server Actions (`:87`, `:113`, `:140`, `:161`, `:182`, `:204`, `:224`), each stuffing the API's own error text into the URL because a redirect loses in-memory state. Carrying an error across a redirect is legitimate; trusting the value on the way back in is the part that is not.
- Bounded honestly, and it should not be over-prioritised: **this is not XSS.** `DismissableNotice` renders `{body ? <p>{body}</p> : null}` — plain JSX text interpolation, which React escapes — and `body` is typed `string`, so no markup or link is producible. The payload is unlinkified text, and the victim must already be an authenticated admin who followed an attacker's link into their own tenant. What is left is a phishing surface with the application's own styling behind it.
- **The codebase already solves this exact problem correctly elsewhere.** `apps/web/lib/login-error.ts` carries a failure across a redirect as `?error=<reason>`, where the reason is one of four known values mapped to a translated message key — no text crosses the URL at all. This screen is the only one in the app that reflects a message parameter: a sweep for `searchParams.message`-style renders returns this single site, and every other screen renders `result.message` from its own fetch instead.
- Related to **F14** but not fixed by it: both are cured by mapping an error *code* to a translated key rather than passing text around. But a reader who fixes F14 the other plausible way — by translating the message before displaying it — closes F14 and leaves this open. Recorded separately for that reason.
- Filed: action-plan §13

### [S4] F20 — Three dependencies are a major version behind, one of them the cookie parser in the session path

- Where: `package.json` — `cookie` 0.7.2 → 2.0.1, `ioredis` 5.11.1 → 6.0.0, `typescript` 6.0.3 → 7.0.2. Four more are behind by a patch or minor (`@types/pg`, `next-intl`, `tsx`, `typescript-eslint`).
- Failure: none today, and that is the honest framing — `npm run audit:check` reports **zero** open advisories and an empty accepted list, so this is pinned-behind rather than vulnerable. It is recorded because the Pass 6 checkbox asks for exactly this ("dependency freshness *beyond advisories*"), and because the gap grows silently: `audit:check` gates CI on advisory ids, so a package can drift several majors behind without anything failing until the day an advisory lands on the old line and the upgrade is no longer small.
- **`cookie` is the one worth doing first.** It is a direct dependency, imported by `src/common/cookie-token.ts`, and it parses an attacker-supplied header on the path every session and CSRF read goes through. Its own comment records that the hand-rolled version it replaced threw on a malformed percent-encoded cookie — so this parser's behaviour on hostile input is already known to matter here. Two majors behind on that specific package is a different proposition from two majors behind on a linter.
- Filed: action-plan §12

### [S4] F19 — Three records describe a codebase that no longer exists, in places the project tells an agent to trust

- Where: `AGENTS.md` "Documentation Map"; `docs/plans/visits-dto-migration-note.md` (status line); `docs/vizitum-action-plan.md` §7
- Failure: each of these is a document the project explicitly directs a new agent or developer to read as current, each currently misdescribes reality, and the three are independent — no single edit fixes them.
  1. **The Documentation Map omits four files under `docs/plans/`**: `dto-migration-tiers-4-6-plan-prompt.md`, `error-monitoring-sentry-plan-prompt.md`, `imports-dto-migration-note.md`, `visits-dto-migration-note.md`. This is the exact gap this audit's own plan predicted when it was opened — "an agent reading only the map never learns they exist" — and it is still open. The two DTO notes hold the recorded *reasoning* for how the imports and visits bodies were gated, so an agent about to touch either controller is precisely the reader who will not find them.
  2. **`visits-dto-migration-note.md` still reads "Status: decision note, no code yet."** The code shipped: `visits.controller.ts` carries **11** `@UsePipes(createStrictValidationPipe())` call sites — one per gated body, and `docs/security-remediation-plan.md` records "`visits`, whose eleven bodies were gated across two changes per the design note". A reader trusting the status line concludes the work is outstanding.
  3. **`docs/vizitum-action-plan.md` §7 records as done**: "Advance provisioning jobs beyond `queued`/`tenant_created` (`provision` worker task moves tenant `draft`→`ready`, job `queued`→`succeeded`)". No such worker task exists — `parseWorkerTask` accepts only `cleanup` and `purge` — and `data-model.md:22` correctly calls the whole provisioning area legacy, so the action plan contradicts the reference doc. Carried in from Pass 2, found while auditing `operations`.
- Why this is worth recording rather than shrugging at: this repository keeps its *machine-checkable* records in unusually good order, which is what makes three drifted prose records worth fixing rather than distrusting the set wholesale. Verified in this pass — **173 of 173** test files and **12 of 12** Playwright specs mapped in `executable-spec.md`; **139 of 139** HTTP handlers present in `api-reference.md`; **24 of 24** backend modules in `module-map.md`; **0** assertion-free test files. The drift is confined to what nothing compiles or diffs.
- Filed: action-plan §1

### [S3] F18 — Deleting a product category orphans every product tagged with it; the rename path in the same file cascades

- Where: `src/modules/products/product-categories.service.ts:185` (`deleteCategory`), against `:137` (the rename cascade in the same file) and `src/modules/locations/location-categories.service.ts:170` (the sibling that gets it right)
- Failure: an admin deletes the product category "Напої". The `ProductCategory` row goes; every `Product` carrying `category: "Напої"` keeps that string, because `Product.category` is a free-text `String?` with **no foreign key**. The dictionary and the catalogue now disagree: the products still claim a category that no longer exists, and since the category filter's options are built from `ProductCategory`, nothing in the UI offers that value any more — those products become unfilterable by their own category, reachable only by hand-crafting `?category=Напої`. `products.service.ts:215` filters on exactly that string.
- **The same file already knows this string needs maintaining.** `renameCategory` cascades: it updates the dictionary row and `product.updateMany`s every product tagged with the old name, in one transaction, matching case-insensitively, under a comment stating the reason — "`Product.category` is a free-text string (no FK), so cascade the rename to every product tagged with the old name **to keep the catalog consistent**". Delete does none of it.
- **The sibling module does it right**, which is what makes this a gap rather than a design stance: `location-categories.deleteCategory` counts the locations using the category, throws `categoryInUseConflict(locationsInUse)` when any exist, and catches `P2003` as a backstop because `Location.categoryId` is a real FK with `onDelete: Restrict`. Product categories have no FK to fall back on, so the service is the *only* thing that could refuse — and it does not.
- Bounded honestly: nothing is destroyed. The products keep their labels and the state is recoverable by re-creating the category under the same name. Either fix works — refuse the delete while in use, like locations, or cascade it to `null`/a replacement, like the rename — but doing neither leaves the catalogue in a state the module's own rename path exists to prevent.
- Filed: action-plan §8

### [S4] F17 — One field journey loses its place: the task deep link skips the back-origin convention on both ends

- Where: `apps/web/app/(workspace)/[tenantSlug]/field/locations/[locationId]/page.tsx:627` (the link) and `apps/web/app/(workspace)/[tenantSlug]/field/tasks/page.tsx:342` (the back control)
- Failure: a rep working a location taps one of the open tasks listed on its card and lands on the tasks screen. Tapping back sends them to the **field home**, not to the location they were working — so they have to re-enter Locations, re-find the outlet and re-open the card. Every time, on the zone `CLAUDE.md` calls the primary device for the role.
- Both ends skip the convention, and each alone would be enough to cause it. The link is a plain `` href={`/${tenantSlug}/field/tasks#task-${item.id}`} `` with no `withBackOrigin(...)`, so no origin is ever sent; and the destination hardcodes `` <BackLink href={`/${tenantSlug}/field`} label={tBack("home")} /> `` instead of resolving one — **the only hardcoded `BackLink` in the field zone**, where all fourteen other screens pass `backTarget.href` from `resolveBackTarget`.
- **Nothing needed to be built for this to work.** `RETURNABLE_SCREENS` already registers both sides: `/field/locations/[^/]+$` with `labelKey: "location"` (so the back control would even announce "Back to location" correctly) and `/field/tasks$`. `withBackOrigin` is used **22 times across 9 files** in this zone — including **twice in the very file that contains this link**. The machinery, the allowlist entry and the label all exist; this one round-trip does not use them.
- Why S4 rather than higher: nothing is lost or unreachable, and the rep can navigate back through the menu. It is a documented convention — `CLAUDE.md` states that a screen reachable from more than one place "cannot name one destination without stranding every other journey" — violated at exactly one journey, with a small but unavoidable cost each time.
- Filed: action-plan §13

### [S4] F16 — 27 dead class selectors in the repo's highest-churn file, clustered around superseded features

- Where: `apps/web/app/globals.css` (7094 lines, 108 commits)
- Failure: 27 of the 599 class selectors the stylesheet defines are referenced **nowhere** — not in `apps/web/app`, `components` or `lib`, not in `src` or `tests`, and not in `public/offline.html`, which matters because that file is outside the module graph and is exactly where a "surely something uses it" assumption would hide. They are dead weight in the file a developer touches more often than any other in the repository, and each one costs a reader the same question: is this still live, and dare I remove it?
- **They cluster by superseded feature, which is what makes them worth removing rather than tolerating**:
  - `ai-draft-state`, `needs-review`, `field-ai-guidance` — the AI draft UI. This is the visual residue of **F3**: the asynchronous transcription/extraction pipeline whose runners nothing calls. The CSS for a feature that cannot complete outlived the feature.
  - `setup-check`, `setup-checklist`, `setup-grid`, `setup-metrics-strip` — the admin onboarding checklist.
  - `import-grid`, `import-history-panel`, `import-issues-panel` — import screens.
  - `tab-switcher`, `tab-switcher-link`, `segmented`, `segmented-option` — **two** generations of tab UI, both dead.
  - Singles: `category-list`, `checkbox-inline`, `chip-remove`, `combo-footer`, `drilldown-table`, `field-label-row`, `field-panel-section`, `general-stack`, `location-feature-help`, `platform-create-panel`, `review-grid`, `route-stop-detail`, `visit-field-label`.
- Method, and the false positives it had to clear — worth recording because a naive sweep over this file is badly wrong: the first pass flagged 36, and **9 of those are alive through template interpolation**. `assortment-status-badge--{active,danger,neutral,warning}` come from `` `assortment-status-badge--${tone}` `` in `location-assortment-panel.tsx:117`; `filter-pill--{overdue,priority}` from `filter-toggle-pills.tsx:29`; and `is-archived`/`is-finished` from `` `is-${announcement.state}` `` in the manager announcements page, where `AnnouncementState` is `scheduled | active | finished | archived`. A tenth candidate, `processing`, is excluded as unprovable — it is an ordinary English word with 86 substring hits, so no textual sweep can show it is unused *as a class*.
- **The other half of this checkbox is clean**: 921 top-level selector blocks, 921 distinct selectors, **zero defined more than once**. The file is large, but it is not redundant — which is why this is recorded as dead code rather than as duplication.
- Filed: action-plan §13

### [S4] F15 — Five constants are duplicated across the workspace boundary; one of the five is test-enforced

- Where: `apps/web/components/field-visit-report-form.tsx:96` (`VISIT_DATE_BACKDATE_WINDOW_DAYS`), `apps/web/lib/api-client.ts:40` (`VisitCancellationReason`) and `:2320` (`resolveCookieName`), `apps/web/lib/offline-drafts.ts:27` (`PENDING_MEDIA_MAX_AGE_MS`, mirrored by `src/modules/visits/visits.service.ts:77`) — against the one that *is* enforced, `apps/web/lib/input-limits.ts` via `tests/input-limits.test.ts`
- Failure: `apps/web` is a separate npm workspace and cannot import from the backend, so several values exist twice with a comment instructing a human to keep them in step. **All five agree today** — this is a drift risk, not a live defect, which is why it is S4 and not higher. The sharpest consequence if one slips is `resolveCookieName`: it duplicates the backend's rule that production hardcodes a `__Host-` prefixed cookie name while only `SESSION_COOKIE_NAME` takes a dev override. If the backend's rule changed and this copy did not, the API would set one cookie name in production while `apps/web` cleared another — logout would appear to work and leave a live session behind. The `VISIT_DATE_BACKDATE_WINDOW_DAYS` copy fails asymmetrically: a *narrowed* backend window leaves the date picker offering days the server will refuse, so a rep finishes a report and is refused at confirm — and by **F14** the refusal arrives in English.
- Evidence: `tests/field-report-visit-date.test.ts` imports `VISIT_DATE_BACKDATE_WINDOW_DAYS` from `src/modules/visits/shelf-check` and never reads the frontend's copy; `tests/cookie-naming.test.ts` contains no reference to `apps/web`; no test mentions `VisitCancellationReason` at all. Verified by hand that each pair currently matches — cancellation reasons are the same four tokens, both age constants are 7 days, both windows are 3.
- **The repository already has the mechanism and states the reason it is shaped that way.** `tests/input-limits.test.ts` reads `apps/web/lib/input-limits.ts` **as text** and regex-parses it, commenting: "Read as text rather than imported: apps/web is a separate workspace with its own tsconfig, and the point of the check is that the two tables agree." The same eight lines would cover the other four. It even applies that technique twice — the second time against a script file — so the pattern is established, not hypothetical.
- Minor, found alongside: `visits.service.ts:74` points at `PENDING_MEDIA_MAX_AGE_MS in apps/web/lib/field-db.ts`, but the constant lives in `apps/web/lib/offline-drafts.ts`. A stale pointer in the one comment whose whole job is to tell a maintainer where the twin is.
- Filed: action-plan §5

### [S3] F14 — Every API error reaches tenant users in English, under a translated heading

- Where: `apps/web/lib/api-client.ts:2388` (`readErrorPayload`, which passes the backend's `message` straight through) and **25 render sites** across all four tenant zones — 7 in `admin/*`, 10 in `field/*`, 7 in `manager/*`, 1 in `operations`
- Failure: a Ukrainian tenant's field rep opens today's route after their session expires. The panel renders its heading through next-intl — and the line directly beneath it is `Authentication is required.` in English, because it is `todayRoutesResult.message` rendered verbatim. Every error state in the product does this: `admin/locations/page.tsx:755` is typical, pairing `<h2>{t("notConnectedTitle")}</h2>` with `<p>{locationsResult.message}</p>` inside one `empty-state-panel`. The strings a user actually sees are the backend's own English — "You do not have permission to perform this action.", "Internal server error." — or, when the API is unreachable, `apiGet`'s catch surfacing a raw Node `fetch failed`.
- **Why it survived every existing check**, which is the useful part: `npm run web:i18n:check` scans for *Cyrillic* literals outside `messages/`, so an English string is invisible to it by construction. And the screen-pass convention as worded — "no hardcoded UI literals" — passes too, because these are not literals: they are runtime values arriving from the API. The gap sits precisely between the automated check and the manual convention, which is why 25 sites accumulated.
- **The correct pattern already exists in the repo and is documented.** `apps/web/lib/login-error.ts` maps the API error *code* to a translated message key rather than rendering the message, and its header explains that it was written after every sign-in failure collapsing into one message cost a real debugging session. `ApiResult` already carries `code` alongside `message` (`api-client.ts:2402`), so every one of these 25 sites has the discriminator it needs; nothing new has to be plumbed.
- **The sharpest instance is in the offline layer, and it inverts the priority.** `apps/web/components/field-visit-report-form.tsx:1320` handles a confirm the server *refused* with `setError(sendOutcome.message || t("saveFailedError"))` — so a translated string exists, and is used only when the backend's English one is empty. This is the highest-stakes message in the product (a finished report refused, a rep standing in a shop) on the zone `CLAUDE.md` calls the primary device, and the correct behaviour is one `||` away. `start-visit-control.tsx:161` handles its own rejection correctly by redirecting to an error route rather than rendering the raw message.
- Bounded honestly: nothing breaks, and the affordance beside the message is usually translated and actionable (the locations panel offers a translated "Sign in" button). `platform/*` renders in `en` by design, so its own `.message` renders are correct and are excluded from the 25.
- Filed: action-plan §13

### [S3] F13 — Two field-zone submit buttons give no feedback at all and nothing stops a second tap

- Where: `apps/web/app/(workspace)/[tenantSlug]/field/today-route-drag-list.tsx:484` (swipe "mark visited" on a route stop) and `apps/web/components/location-notes-modal.tsx:101` (icon-only save). Both are raw `<button type="submit">` inside a `<form action={serverAction}>`.
- Failure: a field rep swipes a stop and taps "mark visited". Nothing changes — the button does not disable, shows no spinner, and its label does not move, because nothing in either component reads the form's pending state. On a field connection the round trip is seconds long, so the rep taps again, and the Server Action fires a second time. Same shape on the location-notes modal's save. Neither action corrupts anything (marking visited and overwriting a note are both idempotent), so the cost is a confused user on the product's primary device and a duplicate request, not damaged data.
- Evidence: a brace-aware sweep of every `<button type="submit">` in `app/` and `components/` returns **10** hand-rolled submit buttons, and **none of the ten carries `aria-busy` or `is-pending`**. Eight at least set `disabled` and swap their label ("Saving…" or a spinner), so a user sees *something*; these two set neither. `CLAUDE.md` states the requirement for exactly this case: a component running its own transition "renders `PendingLabel` by hand and passes `is-pending`/`aria-busy` itself", because `is-pending` "restores its own colours over the `:disabled` palette — busy and unavailable must not look alike" and `aria-busy` is needed since "the spinner is `aria-hidden` … so `disabled` alone would announce 'unavailable' rather than 'working'".
- Scope, stated honestly: seven of the ten are `platform/tenants/*`, the single-user owner console — real but low-value. The two recorded here are the field zone, which `CLAUDE.md` calls the primary device for the role. The eighth, `field-visit-report-form.tsx:2034`, disables and swaps to a spinner + "Saving…", so its accessible name does change; its gap is the missing `is-pending` colour restoration and `aria-busy` only.
- Filed: action-plan §13

### [S3] F12 — An AI provider outage is invisible: the only path in production use logs at info level and appears in no metric

- Where: `src/modules/ai/ai.service.ts:786` and `:823` (the two catches in `transcribeFieldReport`), against `src/modules/operations/operations.service.ts:56-62` (the three AI metrics)
- Failure: `OPENAI_API_KEY` expires, the key's quota runs out, or OpenAI has an incident. `transcribeFieldReport` catches the failure and returns `{ transcript: "", extractedData: emptyFieldReportExtractedData() }` — **correctly**, because manual confirmation must stay usable. But it records the failure with `this.logger.log(...)`, which is **info** level, emits no `logJob` entry, and captures nothing to Sentry. Every field rep now gets a blank form after every recording, types the whole report by hand, and concludes the voice feature is broken. Nothing tells anyone operating the system that it is. The first signal is a support message from the pilot.
- The sharp part is the pairing with **F3**: `/operations/summary` reports exactly three AI numbers — `aiJobs` queued, running and failed — and all three count `AiJob` rows. `transcribeFieldReport` **never writes an `AiJob` row** (stated in `api-reference.md` and true in the code: the only `logJob` calls sit at `:157-:468`, all inside the async pipeline). So the operations summary describes in detail a pipeline that nothing runs, and is structurally blind to the one path every field report actually goes through. An operator watching that dashboard would see a healthy, quiet system throughout a total AI outage.
- Evidence: `grep -n "logJob\|captureException\|logger\." src/modules/ai/ai.service.ts` — the eight `logJob` calls are all in `runTranscriptionJob`/`runExtractionJob`/`createExtractionJob`, i.e. F3's dead code; the two calls inside `transcribeFieldReport` are plain `logger.log`. `scripts/production-alerts-check.mjs` reads neither. Contrast with the same file's async path, which logs failures at **error** level through `logJob` (`json-logger.service.ts:69` sets `level = "failed" ? "error" : "log"`) — the reachable path got weaker treatment than the unreachable one. **`email` is the standard this should meet**, and it is the closest analogue in the codebase — the other place an external provider can fail while the product must keep working. `EmailService` also never throws, for documented reasons, but it logs the failure at `logger.error` *and* persists the outcome as `emailStatus` on the invite row, so a delivery problem is both alertable and visible per record. The AI path logs at info and persists nothing.
- Why this is S3 and not S2: nothing breaks. The degradation is graceful and deliberate, and the hard product requirement — manual confirmation always available — is genuinely met. That is precisely what makes the silence a defect rather than a nuisance: a feature that fails loudly gets fixed, and one that fails into a working manual form does not.
- Filed: action-plan §12

### [S3] F11 — Two of the five services that pre-check uniqueness answer 500 instead of 409 when the constraint fires

- Where: `src/modules/locations/locations.service.ts:604`/`:162`/`:173` and `src/modules/chains/chains.service.ts:150`/`:176`/`:110`/`:120`. Neither file contains a single `P2002` or `isUniqueConstraintViolation` reference.
- **The split, measured:** five services pre-check a uniqueness rule and then write. Three map the resulting `P2002` to the 409 their own pre-check would have produced — `products.service.ts` (whose comment is the clearest statement of the rule: "A concurrent create can slip between the pre-check above and this insert … Surface it as the same 409 the pre-check would have, **not an opaque 500**"), `product-categories.service.ts` and `location-categories.service.ts`. Two do not: `locations` and `chains`. This is not a gap nobody noticed — it is a convention three services follow and two missed.
- `chains` is the same shape as `locations`: `assertNameAvailable` and `assertExternalCodeAvailable` pre-check, then `createChain:110` and `updateChain:120` write bare. `Chain` carries **two** unique constraints (`@@unique([tenantId, name])` and `@@unique([tenantId, externalCode])`), so it has two ways to reach the unmapped path.
- Failure: `createLocation` pre-checks that the external code is free, then creates without a `try`. The check and the write are not atomic, and a **real partial unique index** backs the column — `(tenantId, externalCode) WHERE deletedAt IS NULL`, created in raw SQL by `20260718090000_location_external_code_partial_unique`. Two admins creating a location with the same code concurrently, or an import confirming after someone manually took one of its validated codes, therefore land on `P2002`. Nothing maps it: `ApiErrorFilter` has no Prisma special case, so the caller gets a generic `500 Internal server error` and Sentry records a server fault — instead of the `409 LOCATION_EXTERNAL_CODE_EXISTS` with a `fieldErrors.externalCode` message that `assertExternalCodeAvailable` was written to produce.
- The import variant is the one that costs the most: `applyLocationsImport` creates locations without any external-code assert (duplicates are caught earlier by the preview's `findExistingLocationExternalCodes`), so a code taken between validation and confirm surfaces as an unexplained 500 that rolls back the entire import, with nothing naming the offending code — on top of **F8**, which already makes large imports fragile.
- Evidence the constraint is genuine and deliberate: the schema comment at `prisma/schema.prisma:630` explains the index is partial precisely so archived locations do not reserve their codes, warns against reintroducing a plain `@@unique`, and notes `tests/location-external-code-index.test.ts` guards both mistakes. The database side is well thought through; only the error mapping is missing.
- **A trap primed in `chains`, deliberately recorded but NOT counted as part of this finding.** `Chain` has a `deletedAt` column and `chains.service.ts` filters `deletedAt: null` in four places — but **nothing anywhere in the codebase ever sets it**, so chains cannot currently be archived and the scenario below is unreachable today. It is worth writing down because the moment someone implements chain archiving it becomes a *deterministic* 500 rather than a race: the pre-checks exclude archived rows while `Chain`'s unique constraints are **plain**, not partial, so re-creating a chain with an archived chain's name would pass the pre-check and then be refused by the database, unmapped. `Location`'s equivalent index is partial precisely to avoid this, and its schema comment spells out why — "would reserve externalCodes of archived (soft-deleted) locations and break re-create/re-import after archive". `Chain` never got that treatment. Whoever implements chain archiving has to make the indexes partial *and* map `P2002`, or the import path's `resolveChainReference` (which auto-creates chains by name) will start failing whole imports.
- **Same pattern as F10, and worth fixing as one item.** All of these are a pre-check followed by a write whose constraint violation is left unmapped, so a legitimate conflict becomes a 500. `routes` already carries a `toSequenceConflictOrRethrow` helper doing exactly this job, and `route-templates` a second copy; `products` and the two category services each have their own inline version. Six local implementations, two services with none.
- Filed: action-plan §8

### [S3] F10 — Reordering a route while another stop is deleted answers 500, not a conflict

- Where: `src/modules/routes/routes.service.ts:357` (the items read), `:378-392` (the transaction) and `:521` (`toSequenceConflictOrRethrow`)
- Failure: `reorderRouteItems` reads the plan's stops, validates that `body.itemIds` is an exact permutation of them, and *then* opens a transaction that updates each stop by id. If another actor deletes one of those stops between the read and the transaction, `tx.routeItem.update({where: {id}})` raises Prisma **P2025** (record to update not found). `toSequenceConflictOrRethrow` only recognizes unique-constraint violations and returns every other error unchanged, so P2025 propagates to `ApiErrorFilter` as a generic `500 Internal server error` — and is captured to Sentry as a server fault, which it is not.
- Reachable how: the manager route editor exposes reorder and delete on the same screen, so two managers on one route, or one manager with two tabs, is the ordinary case. The frontend serialize-and-coalesce hook added for the earlier reorder race bounds *one client's* concurrent reorders; it does nothing about a second actor, or about reorder-versus-delete.
- Why it is S3 and not worse: the transaction rolls back whole, so no partial ordering is written, and the user's retry succeeds because their next read no longer contains the deleted stop. The damage is a spurious 500 on a legitimate flow plus Sentry noise attributing a client-side race to a server fault.
- Evidence, and why this counts as an inconsistency rather than an oversight of the whole module: `@@unique([tenantId, routePlanId, sequence])` exists in the schema, which is why the two-phase park-then-renumber shuffle is there and correct. The **concurrent-insert** variant of this same race is already handled gracefully — a stop added between the read and the transaction collides during phase-1 parking, raises a unique violation, and `toSequenceConflictOrRethrow` turns it into a clean 409 `ROUTE_ITEM_SEQUENCE_TAKEN`. Only the delete variant falls through, because it raises a different Prisma code. The module handles races well everywhere else: `copyRoutePlans:571` catches a per-day `ConflictException` and skips rather than aborting the batch, and `materializeTemplateAssignment:632` maps its unique violation to a 409. One error code is missing from a mapper that already exists.
- Filed: action-plan §8

### [S4] F9 — A code comment states the upload size cap is unenforceable, describing behaviour the security plan closed

- Where: `src/modules/visits/visit-media-limits.ts:6-10`, contradicted by `src/modules/storage/s3-storage.client.ts:200-208`
- Failure: `visit-media-limits.ts` tells its reader, as the stated reason for sharing its two constants: "the presigned PUT does not sign `Content-Length`, so nothing stops a caller declaring one number and uploading another — the registration check bounds a claim, not the bytes. The limit only becomes real where the bytes are read, and only if that reader applies the same number." **That has not been true since the security remediation plan's item 3.2.** `s3-storage.client.ts` now signs the header, and says so in its own comment: "The signature only holds if that browser-computed value matches what was signed here, which is exactly what makes an oversized body fail the PUT instead of merely failing a later read." Two comments in one codebase state opposite things about the same control, and the stale one is the one a developer touching visit media reads first.
- Evidence: `storage.service.ts:80` passes `contentLength: assertPresignableSize(storageObject.sizeBytes)` on every presigned upload, and `assertPresignableSize` (`:403`) *throws* on a null size rather than returning undefined — so `input.contentLength !== undefined` is always satisfied and the `PUT` branch at `s3-storage.client.ts:206` always signs. There is no path through `createPresignedUploadUrl` that produces an unsigned `Content-Length`. `docs/security-remediation-plan.md` records 3.2 as "Done — the read side enforces the cap against the length the store reports, and the PUT itself now signs `Content-Length`."
- Why it matters despite being a comment: it understates a shipped security control, and it does so in the file whose whole purpose is to explain why those two constants must agree. A reader deciding whether the registration-time check is worth keeping, or whether the read-side check can be relaxed, is being given the pre-fix model. Pass 1 left "upload content-type/size enforced server-side" marked partial largely because this comment says the size check is advisory; it is not.
- Filed: action-plan §11

### [S2] F8 — A large import can never be applied: the whole apply runs in one 5-second Prisma transaction with a per-row query loop

- Where: `src/modules/imports/imports.service.ts:701` (`prisma.$transaction(async (transaction) => {…})`, called with **no options object**) wrapping `applyUsersImport:803`, `applyLocationsImport:841`, `applyContactsImport`, `applyProductsImport` and `applyInitialPlanImport:958` — every one of them a `for (const row of parsedFile.rows)` loop issuing awaited queries per row
- Failure: an admin uploads a locations or initial-plan CSV of a few hundred rows, sees a clean validation preview, presses Confirm, and gets an opaque `500 Internal server error`. Nothing applies. Retrying fails identically, because the cause is deterministic. Nothing anywhere tells them the file is too big or that splitting it would work, and the preview that just passed gave no hint — validation is not transactional, so the size only becomes fatal at the confirm step.
- The arithmetic: Prisma's interactive-transaction defaults are `maxWait ?= 2000`, `timeout ?= 5000` (confirmed in `node_modules/.prisma/client/index.d.ts:4614`), and **no options are passed at the call site**, so the whole apply has a fixed 5 000 ms budget. Nothing caps the row count — not the DTO (`csvText` is `@IsString()` with no `@MaxLength`, deliberately, since size is "already bounded by `JSON_BODY_LIMIT`"), not the service, not the frontend (`api-client.ts:1741` posts the entire `csvText` in one request; there is no chunking). The bound is therefore the 100 kB body limit alone. Measured against the repo's own sample pack (`docs/samples/import-packs/first-pilot/locations.csv`), a real location row is **130 bytes**, so a maximum-size file is **~790 rows**. `applyLocationsImport` issues ~5 sequential queries per row once chains and categories exist (chain lookup, category lookup, `location.create`, representative lookup, `locationAssignment.create`) — about **3 950 round trips**, which needs every one to complete in under **1.27 ms** for the transaction to survive. `applyInitialPlanImport` is worse at 6–7 per row. Local Postgres over loopback is marginal at that rate; the deployed topology (API on Render, managed Postgres) is not close.
- **The same codebase gets this exactly right elsewhere, which is what makes it an inconsistency rather than an unknown hazard.** `src/modules/visits/shelf-check.ts:94` collapses a per-product loop into two grouped `updateMany` calls and says why in the comment: "Two grouped updates rather than a row-per-product loop: a full matrix can run to hundreds of SKUs and **this sits inside the confirm transaction**." `confirmReport` likewise creates its tasks with a single `createMany`. The reasoning F8 asks for is already written down in this repository — one module applied it and the bulk-import path did not.
- Evidence that nothing catches it: no row cap appears in `docs/reference/api-reference.md`, whose import section discusses `JSON_BODY_LIMIT` at length without mentioning apply-time cost. None of the nine `tests/import-*.test.ts` files exercises volume — they cover parsing, length limits, the confirm race, tenant isolation and the sample pack, all at a handful of rows. On timeout Prisma raises `P2028`, which is a `PrismaClientKnownRequestError` rather than an `HttpException`, so `ApiErrorFilter` answers a generic 500 and captures to Sentry. The rollback is complete and correct — including the status claim, which is *inside* the transaction — so the job returns to `validated` and the data is untouched. **That correctness is exactly what makes it a dead end rather than corruption**: the release-readiness item "Import failure cannot partially corrupt applied data" holds, and the admin still cannot onboard.
- Why S2: this is the primary onboarding path — importing a pilot tenant's outlets and initial plan is the first thing a new customer does, and a few hundred locations is an ordinary size for the small-and-medium field teams the MVP targets. The user-visible outcome is an unrecoverable dead end with no diagnostic. Not S1: no data is exposed, lost or corrupted.
- Filed: action-plan §9

### [S3] F7 — A password-reset token is single-use only sequentially: nothing claims it, so two concurrent resets both succeed

- Where: `src/modules/auth/password-reset.service.ts:297-307` (the read and the `usedAt` check) and `:352-356` (the write)
- Failure: the token is fetched, checked for `usedAt`/`expiresAt`, and only much later spent — with a plain `update({ where: { id: resetToken.id }, data: { usedAt: now } })` that is **not conditional on `usedAt` still being null**. Two `POST /auth/password/reset` requests carrying the same valid token therefore both pass the check, both enter the transaction, and both commit: under Read Committed the second `UPDATE` simply waits for the first to release the row and then applies on top. Both callers get a success and the account ends up with whichever password committed last. The token is single-use sequentially — a *later* attempt does fail — but not concurrently, which is the only case that matters for a race.
- Failure scenario in concrete terms: a reset link is exposed (forwarded mail, a shared inbox, a device someone else also holds). Without this gap the second submitter gets `INVALID_RESET_TOKEN` and learns the link is spent; with it, whoever submits at the same moment can land their own password and the legitimate user's reset silently loses. It does not grant access to anyone who did not already hold the token, which is what keeps this out of S2.
- Evidence: **the window is unusually wide for a TOCTOU** — `passwordService.hashPassword(password)` runs at `:339`, between the check and the transaction, and argon2 is deliberately expensive, so the gap is on the order of a hundred milliseconds rather than microseconds. The transaction at `:352` is an array `$transaction([...])`, which makes the *contents* atomic but claims nothing. The long comment at `:343-351` shows atomicity was thought about carefully — but about what the transaction contains, not about claiming the row it opens on.
- **This is the only single-use credential in the codebase that is not claimed atomically.** Five others are, four of them with a comment saying why: `auth.service.ts:529` (invite acceptance, `updateMany({where:{id, status:"pending"}})`); `platform-mfa.service.ts:155` (MFA challenge, `{id, consumedAt: null}` — "two requests racing the same token must not both come away with a session"); `:265` (TOTP code, `{totpLastUsedStep: {lt: timeStep}}` — "two requests replaying one code concurrently would both pass a read check"); `:333` (recovery code, `{totpRecoveryCodeHashes: {has: candidateHash}}` — "neither can two concurrent requests both spend the same code"); and import confirm, closed the same way per the security remediation plan. The pattern is established, understood and written down — the reset token is the one place it was not applied.
- Filed: action-plan §6

### [S3] F6 — Archiving a tenant is an instant outage for every one of its users and needs no second factor; purging it does

- Where: `src/modules/platform/platform.service.ts:809` (`archiveTenant`) and `:865` (`unarchiveTenant`); the gate they do not call is `assertFreshSecondFactor` at `:714`, whose only caller is `requestTenantPurge` at `:1004`
- Failure: `POST /platform/tenants/:tenantId/archive` takes no `mfaCode` and performs no re-authentication. It flips the tenant to `archived` — which `canTenantServeRequests` treats as unable to serve, so every request from that tenant is refused — and calls `revokeTenantSessions`, signing out every user in it. A platform-owner session that has been stolen inside its TTL can therefore archive every tenant in sequence, taking the entire customer base offline, without ever presenting the second factor that the *reversible-later* operation demands.
- Evidence: `grep -n assertFreshSecondFactor` over the file returns the definition and exactly one call site — `requestTenantPurge`. The gate's own error codes (`TENANT_PURGE_REAUTH_REQUIRED`, `TENANT_PURGE_REAUTH_INVALID`) and its parameter type (`PlatformRequestPurgeInput`) are purge-specific, so this is a deliberate scoping rather than an omission in wiring. What makes it worth recording is that the scoping is nowhere stated: `docs/security-remediation-plan.md` records item 1.3 as "re-auth for destructive tenant operations is **done**", generically, and a reader checking that claim would reasonably assume archive is covered.
- Weighed honestly: archive is **reversible** — `unarchiveTenant` restores the tenant, and the purge worker only touches tenants that stay archived past retention or are explicitly marked, so an archive alone destroys nothing. Recovery is a single call, itself needing no second factor. The precondition is an already-compromised platform-owner session, which is the worst-case credential in the system. So this is an availability gap behind a serious precondition, not a data-loss path — hence S3, not S2. The decision to make is whether "destructive" should mean "irreversible" (current behaviour, defensible) or "customer-visible outage" (which archive is); either answer should be written down.
- Filed: action-plan §7

### [S4] F5 — Archiving a location, product or chain records when it happened and nothing about who did it

- Where: `prisma/schema.prisma` (13 models carry `deletedAt`; **`deletedBy` does not exist anywhere in the schema** — `grep -c deletedBy` returns 0) and `src/modules/locations/locations.service.ts:232`, which writes `data: { deletedAt: new Date() }` and emits no audit event
- Failure: a Company Admin archives a location — or a run of them. Afterwards the only trace is a `deletedAt` timestamp on each row. There is no `deletedBy` column and `locations`, `products` and `chains` are not among the modules that call `AuditService.recordEvent`, so nothing anywhere attributes the change to an actor. An operator investigating "half our outlets disappeared from the reps' routes on Tuesday" can establish *when* to the millisecond and cannot establish *who* by any means. The data itself is recoverable (`locations.service.ts:262` clears `deletedAt`), so this is a forensics gap, not data loss.
- Evidence: `grep -rln "auditService\|AuditService\|recordAuditEvent"` over `src/modules` returns 12 files — `announcements`, `auth` (×3), `pilot-review`, `platform` (×3), `routes` (×2), `tasks`, `users`. Absent: `locations`, `products`, `chains`, `settings`, `visits`, `imports`, `storage`, `ai`. **Most of those absences are defensible on their own terms, and the finding is deliberately narrower than the list**: an `ImportJob` row already persists `confirmedByUserId`/`appliedAt`/`summary`, a `Visit` carries its own authorship, and — confirmed while auditing `settings` — every `TenantSetting` carries `updatedByUserId` with a relation, set by all four upsert helpers, so tenant configuration changes *are* attributed without needing an event. A soft-deleted `Location`, `Product` or `Chain` carries neither an audit event nor a column. Those three are the finding. **What makes this a finding rather than a design choice is the inconsistency**: the same codebase attributes login failures, platform tenant operations, task changes and user changes with care, so the omission on the entity a field team actually works from reads as an oversight, not a policy. Related and worth deciding at the same time: `AuditService` takes free-form `entityType`/`eventType` strings with no enum or union type, so there is nothing that could have flagged the gap and nothing preventing two modules from spelling the same event differently.
- Filed: action-plan §12

### [S3] F4 — The location-insights summary returns one row per location, uncapped, on an endpoint with no pagination

- Where: `src/modules/location-insights/location-insights-summary.service.ts:41` (the read) and `:231` (`locations: locationSummaries`, the response field)
- Failure: `location.findMany({ where: { tenantId, deletedAt: null }, select: { id, name } })` has no `take`, and the array it builds is returned in full. The response grows linearly with the tenant's location count and there is no page/pageSize parameter to bound it — a tenant with 5 000 outlets receives 5 000 objects of eight fields each on every load of the manager potential screen, and there is no request the client can make that asks for fewer. Every sibling list endpoint in the codebase bounds itself through `src/common/pagination.ts`; this one is outside that pattern.
- Evidence: the `where` has no `take` (confirmed by a sweep of all 36 `take`-less `findMany` calls in `src/modules/**/*.service.ts` — this is the only one whose row count grows with tenant age and is not bounded by a fixed key list, an `{in: [...]}` batch or a single location's children). The two derived lists beside it, `highPotentialLowCoverage` and `neverChecked`, *are* capped with `.slice(0, TOP_N)`, which shows the size question was asked for them and not for the array they are derived from. **Note what is deliberately not being claimed**: the aggregation itself is well built — five `groupBy`/`aggregate` calls joined in memory, specifically to avoid the N+1 this would otherwise be — and at pilot scale (tens to low hundreds of locations) nothing here is slow. The finding is that nothing bounds it, not that it is currently breaking.
- Filed: action-plan §5

### [S3] F3 — Three of the four AI endpoints can never succeed: the async pipeline has no runner

- Where: `src/modules/ai/ai.service.ts:169` (`runTranscriptionJob`) and `:381` (`runExtractionJob`); the endpoints are `src/modules/visits/visits.controller.ts:198`, `:216` and `:233`
- Failure: `POST /visits/:visitId/ai/transcription-jobs` writes an `AiJob` row with `status: "queued"` and returns it. **Nothing in production ever moves it out of `queued`.** `createExtractionJob` requires a transcription job with `status: "succeeded"` (`ai.service.ts:310`), so `POST /visits/:visitId/ai/extraction-jobs` returns 400 `EXTRACTION_INPUT_INVALID` every time; `confirmAiDraft` requires a *succeeded extraction* job (`:504`), so `POST /visits/:visitId/ai/drafts/confirm` returns 400 `AI_DRAFT_NOT_CONFIRMABLE` every time. The queued rows are also permanent: the only sweep that touches `AiJob`, `cleanupExpiredFailedAiJobs`, filters on `status: "failed"` (`:903`), so a queued job is never cleaned and is counted forever by `operations.service.ts:57`'s `aiJobs.queued`.
- Evidence: `grep -rn "runTranscriptionJob\|runExtractionJob"` over `src/`, `tests/`, `scripts/` and `apps/web` returns the two definitions and **three call sites, all of them in `tests/`** (`tests/ai-transcription-job.test.ts:214`, `tests/ai-extraction-job.test.ts:164` and `:213`). No controller calls them; `src/worker.ts` runs only `cleanupExpiredFailedAiJobs` + storage cleanup + purge, and `parseWorkerTask` accepts only `cleanup` and `purge`, so there is no worker mode that could. This is a live illustration of rule #4 in reverse: two green test files pin the runners' logic in detail and say nothing about whether anything calls them.
- Blast radius, stated honestly: **no shipped user journey hits this.** `apps/web` calls only the fourth, synchronous endpoint (`ai/field-report-transcriptions`, `api-client.ts:2051`); the three job endpoints appear nowhere in the frontend. The hard product requirement — manual report confirmation must always work — is intact and independent (`POST /visits/:visitId/reports/confirm`). Nothing alerts on the queued count either (`scripts/production-alerts-check.mjs` never reads it). What is actually wrong is that `docs/reference/api-reference.md:191-193` documents all three as working, including "when extraction succeeds the response also carries `draftQuality`", so anyone building against the documented API — or any future frontend work that reaches for the async path — gets a pipeline that cannot complete.
- Filed: action-plan §10

### [S3] F2 — S3 storage configuration is never validated at boot, so a bad value 500s at first upload

- Where: `src/modules/storage/storage.config.ts:15-18`, read per request from `src/modules/storage/storage.service.ts:75`; the boot gate that should own this is `src/modules/auth/security-config.ts:20`
- Failure: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are read inside `getConfig()` at request time and checked only for *presence*. Set `S3_ENDPOINT` to a value with no scheme — `r2.example.com` rather than `https://…`, an ordinary paste error — and the API boots, `/health/readiness` reports ready, UptimeRobot stays green and `npm run alerts:check` passes, while every `POST /visits/:id/notes/audio/register` returns a 500 `INTERNAL_SERVER_ERROR`. Field representatives lose audio and photo capture entirely and nothing pages anyone; the first report is a rep saying the button does not work.
- Evidence: observed live, not theorized — the e2e run logged `TypeError: Invalid URL at buildObjectUrl (src/modules/storage/s3-storage.client.ts:218)` → 500, because the local `.env` carries placeholder R2 values. `new URL(config.endpoint)` at `s3-storage.client.ts:214` is the first and only thing that parses the endpoint. `PRODUCTION_REQUIREMENTS` in `security-config.ts` gates `COOKIE_SECURE`, `TURNSTILE_SECRET_KEY`, `REDIS_URL`, `SESSION_SECRET`, `TOTP_ENCRYPTION_KEY` and `TRUST_PROXY_HOPS` — no S3 variable is on it — and `grep -n 'storage\|S3' src/modules/health/*.ts` returns nothing, so readiness does not cover it either. This is the exact failure mode that file's own header comment says it exists to refuse: "the app looks healthy and the control simply isn't there". Storage was left out of the pattern the rest of the configuration follows.
- Filed: action-plan §11

### [S3] F1 — Platform tenant modal hydrates with a mismatch: region names differ between Node's ICU and the browser's

- Where: `apps/web/app/(workspace)/platform/tenants/create-tenant-modal.tsx:156` via `apps/web/app/(workspace)/platform/tenants/phone-country-options.ts:12`
- Failure: `create-tenant-modal.tsx` is a `"use client"` component that calls `phoneCountryOptions()` **inside its own render**, so the `<option>` labels are computed twice — once by Node during SSR and once by the browser during hydration — from two different CLDR datasets. They disagree, React reports a hydration mismatch and discards the server HTML for that subtree, re-rendering it on the client. Every visit to `/platform/tenants` does this.
- Evidence: observed live in the e2e run, which logged the mismatch with the diff `Falkland Islands (Islas Malvinas) (FK)` against `Falkland Islands (FK)` at `create-tenant-modal.tsx:157`. Reproduced directly: `Intl.DisplayNames(["en"],{type:"region"}).of("FK")` returns `Falkland Islands` on Node v26.4.0 (full ICU) and `Falkland Islands (Islas Malvinas)` in Chromium. Deterministic, not a flake, and `FK` is unlikely to be the only divergent code — `.sort(localeCompare)` over labels that differ can also reorder the list. **The sibling does it correctly and is the shape of the fix**: `phone-country-form.tsx` has no `"use client"`, computes the same options on the server and passes them to a client component as props, so the client renders exactly what SSR produced. Reach is bounded — this is the platform-owner console, `en` by design, not a tenant surface.
- Filed: action-plan §13
