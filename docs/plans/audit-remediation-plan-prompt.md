# Task: Work off the full-project audit's 32 findings

## Context

VIZITUM is a multi-tenant field-visit SaaS: NestJS API at repo root (`src/`), Next.js frontend in `apps/web`, PostgreSQL via Prisma, S3-compatible storage (Cloudflare R2). Read `CLAUDE.md` and `AGENTS.md` first.

A full-project audit ran 2026-08-05/06 and landed in two files (PRs #235 and #239, both merged, both docs-only). **The split between them is load-bearing and you will use both:**

- **`docs/vizitum-action-plan.md` is the work tracker.** 33 unchecked `- [ ] **[audit FNN, SN]** …` items across nine sections (F29 has two — a backend half in §5 and a frontend half in §13). Each states the fix: what to change, at which `file:line`, and which existing pattern to copy.
- **`docs/plans/full-project-audit-plan.md` is the coverage record.** It holds the full entry per finding: the failure path, the evidence, the severity argument, and — the part that matters most to you — **what was chased and deliberately excluded**.

32 findings: 0 S1, 1 S2, 16 S3, 15 S4. The stop-the-line rule never fired. Distribution: §13 Frontend 13, §5 Backend 5, §8 Field Ops 3, §12 Observability 3, §6 Auth 2, §11 Storage 2, and one each in §1, §7, §9, §10.

Two audit items remain open and are **not** part of this task: the restore drill (Pass 6) and index efficacy (Pass 4). Both need something this repository cannot provide — a database restored from a backup, and representative row counts.

## Rules of engagement (decided, do not re-litigate)

1. **Read the finding entry in `full-project-audit-plan.md` before touching anything.** The action-plan line tells you what to do; the audit entry tells you what *not* to do. Several findings carry an explicit "chased and deliberately not recorded" note that exists to stop the next person over-fixing — F29 excludes the assignee filter (a written design decision), F11 excludes the chain-archiving trap (unreachable today), F26 excludes the account link's zone-aware fallback.
2. **One finding, or one named cluster below, per branch and per PR**, off latest `main`. Never batch unrelated findings: the audit's value is that each item can be judged on its own.
3. **Tick the action-plan checkbox in the same PR that fixes it**, and note the PR number beside it. A finding fixed in code but left unticked will be re-fixed by somebody.
4. **Do not re-open severities.** They were assigned at record time against a fixed scale, with the reasoning written down. If you believe one is wrong, say so in the PR description and leave the record alone.
5. **The finding names the fix; do not widen it.** Where a finding offers two acceptable fixes (F18: refuse the delete, or cascade it) either is fine — pick one and say which in the PR.
6. **Do not re-audit closed security work** (`docs/security-remediation-plan.md`). Its accepted risks are decisions.

## Clusters that must be fixed together

Fixing one half of these and not the other leaves a defect standing that looks fixed:

- **F17 + F28** — the same back-origin convention, violated at two sites (one screen, one component). F28's entry also corrects F17's "only hardcoded `BackLink` in the field zone" scope. **And read F17's note about `LIST_PARAMS`**: `field/tasks` does not carry `from` through its own save redirect, so fixing the link half alone drops the origin on every task update.
- **F14 + F21** — both are cured by mapping an error *code* to a translated key. But F21's entry warns explicitly: fix F14 the other plausible way (translate the message text) and F21 stays open. Do the code map.
- **F10 + F11** — F11's entry says it outright: "Same pattern as F10, and worth fixing as one item." A pre-check followed by a write whose constraint violation is unmapped, so a legitimate conflict answers 500. Six local implementations of the mapping already exist; two services have none.
- **F29 backend half, then frontend half** — `GET /tasks` needs the `statusTotals` aggregate that `GET /visits` already returns (`visits.service.ts:144-172` is the model). The five screens cannot be fixed properly until it exists.
- **F3 + F16 (partial)** — three of F16's 27 dead selectors are the AI draft UI, which is F3's visual residue. Whatever is decided for F3 (delete the runnerless pipeline, or give it a runner) determines whether those three go.

## Plan of record

**Wave 1 — before a real customer's data lands.** Four findings, all small, all with an existing pattern to copy.

1. **F8 (S2, §9)** — the only S2. Importing outlets is the first thing a new tenant does, and past a few hundred rows it is a deterministic dead end with no diagnostic. `shelf-check.ts:94` shows the shape the apply loops should have.
2. **F7 (S3, §6)** — the password-reset token is the one single-use credential in the codebase not claimed atomically. Five siblings do it; `auth.service.ts:529` is the closest.
3. **F2 (S3, §11)** — storage configuration is never validated at boot, so a pasted-wrong `S3_ENDPOINT` leaves readiness green while every field capture 500s. One entry on `PRODUCTION_REQUIREMENTS` in `security-config.ts`.
4. **F12 (S3, §12)** — an AI provider outage is invisible. `EmailService` is the standard to meet: log at error level *and* persist the outcome.

**Wave 2 — mechanical, low-risk, good first PRs.** F9 (a comment that contradicts a shipped control), F19 (three drifted prose records), F22 (one `aria-label`), F30 (three query parameters), F25 (extract one function into `request-context.ts`), F16 (delete 27 dead selectors — read its method note first, nine further candidates are alive through interpolation), F17+F28 together.

**Wave 3 — the highest-value test in the set.** F23 (§6): one test file that walks `src/modules/**/*.controller.ts` and asserts every HTTP handler either declares a permission or sits on a named public allowlist, and every `@Body()` handler carries the validation pipe. Both properties hold **completely** today — 121 of 121 decorators, 69 of 69 pipes — and nothing would notice if they stopped. It is the only S4 whose absence could later admit an S1. Three techniques already in the repo: reflection over `PIPES_METADATA` (`auth-dto-validation.test.ts:125`), reading source as text (`input-limits.test.ts`), and the allowlist shape (`audit-allowlist.test.ts`). F15 and F24 belong to the same wave.

**Wave 4 — needs a product decision before code.** Do not start these by writing code; get the answer, write it into the finding, then implement.

- **F6** — should "destructive" mean *irreversible* (current behaviour, defensible) or *customer-visible outage* (which archive is)? Either answer is fine; it needs to be written down.
- **F26** — which of Next's four route-level states to define, and what the 404 should say. `no-access/page.tsx` already carries the reasoning for the standalone-PWA case.
- **F14** — 25 sites; agree the code→key convention once, then apply. `lib/login-error.ts` is the pattern.
- **F5** — attribution on soft-delete: a `deletedBy` column, an audit event, or both. `deleteTask` is the shape the finding asks for.

**Wave 5 — deliberately deferrable, and the audit says why.** F4, F31 and F29's frontend half are all bounds that bite at scale. Production was measured on 2026-08-06: two tenants, four locations and six tasks at the largest, zero `ai_jobs` rows. Nothing is near a threshold. These are pre-scale work — do them before onboarding a real customer, not this week. **Re-measure before deciding they are still deferrable**; the queries are recorded in the audit's Pass 4 section.

**Unwaved, judge on their own:** F1, F13, F18, F20, F27, F32. Each is self-contained and small. F32 in particular is a documentation fix, not a code change — resist the urge to "modernise" the anchors it describes.

## Non-goals (explicitly out of scope, list as follow-ups in the PR description)

- The two open audit items — restore drill and index efficacy. Both need infrastructure, not code.
- Re-running the audit or extending its coverage. The one gap Pass 3 could not close (whether a screen's copy says what it should) needs a person who knows the product, not another pass.
- Refactoring beyond a finding's stated scope. Several findings sit in large files (`imports.service.ts` 2683 lines, `admin/locations/page.tsx` 1699); fixing the finding is not permission to split the file.
- Changing the manual report-confirmation fallback, which is a hard product requirement (`AGENTS.md`), or the offline layer's behaviour beyond F28's one back control.

## Verification

Per PR, all green before review: `npm run lint`, `npm run format:check` (**separate from lint in CI — passing lint is not passing Prettier**), `npm run build`, `npm run test`, `npm run web:typecheck`, and `npm run web:build` for anything under `apps/web`.

- Backend findings: a test under `tests/`, one behavior per file, mapped into `docs/reference/executable-spec.md` in the same PR — that mapping is currently 174/174 and 12/12 exact, and it should stay exact.
- Frontend findings that change a shared convention (F13, F14, F17, F27, F30): a sweep proving the *other* sites did not regress, in the PR description. The audit's own counts are the baseline — 10 hand-rolled submit buttons, 25 `.message` renders, 27 dead selectors, 339 button/link elements.
- Docs touched by any change: `api-reference.md`, `permissions.md`, `data-model.md`, `environment.md`, `module-map.md` — hard project convention.
- **F8 specifically cannot be verified by the existing suite** (F24 explains why: no test touches a database, and every fake `$transaction` just invokes its callback). Verify it against a real local Postgres with a few-hundred-row CSV, and say so in the PR.

## Rough sizing

- Wave 1: day-scale each; F8 is the largest of the four because the fix is a rewrite of five apply loops plus a decision about transaction budget (`prisma.service.ts` passes no `transactionOptions` — that is where a global raise would go).
- Wave 2: hours each, several can share a review even if not a branch.
- Wave 3: F23 is a day and worth two.
- Wave 4: the decision is the work; the code is small in every case except F14's 25 sites.

## Working notes

- **Method traps recorded in the audit, each of which nearly produced a wrong finding.** `grep -A 1` truncates a multi-line `@RequireAnyPermissions` block and will tell you handlers require a permission they do not. A naive `<input …>` regex breaks on `>` inside arrow functions in JSX attributes. CI invokes the backend suite as `npm test`, not `npm run test`. `--to-schema-datamodel` was removed from `prisma migrate diff`. Three form-name indirections (`fieldName`, `inputName`, and a `[1, 2]` slot loop) defeat a naive scan.
- **Docs are outside Prettier's globs.** `git diff --check` is the check for them.
- **This codebase argues its guards in comments beside the code.** Before concluding something is missing, look for the comment explaining why it is not — that habit is what stopped three wrong findings during the audit, and it is recorded as rule #5.
- The audit's Progress table is the state of record; the Status line at the top of the file only compresses it. Update neither unless you are auditing.
