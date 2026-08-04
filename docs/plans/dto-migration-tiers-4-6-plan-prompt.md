# Task: Finish the class-validator DTO migration — tiers 4, 5 and 6

## Context

VIZITUM is a multi-tenant field-visit SaaS: NestJS API at repo root (`src/`), Next.js frontend in `apps/web`, PostgreSQL via Prisma. Read `CLAUDE.md` and `AGENTS.md` first, then `docs/reference/api-reference.md` and `docs/reference/executable-spec.md`.

This finishes the deferred half of item 2.4 in [`docs/security-remediation-plan.md`](../security-remediation-plan.md) — the only part of that plan still open. Read 2.4's own item there before starting: it carries the tier order and the reasoning for the split.

**Where the track stands: 18 of 22 controllers taking a `@Body()` are gated. Tiers 1–4 are closed** (`location-potential`, `location-assortment`, `pilot-review`, `chains`, `location-categories`, `product-categories`, `products`, `announcements`, `tasks`, `locations`, `routes`, `route-templates`, `visits`, `admin-settings`, `admin-users`, `storage`, `platform`, `platform-tenant-superadmin`). Four controllers and 11 write routes remain: `imports` (tier 5) and `auth`/`password`/`platform-auth` (tier 6).

**There is no global `ValidationPipe` and there must not be one until every controller has DTOs.** Each gated route carries its own `@UsePipes(createStrictValidationPipe())`. Enabling `whitelist: true` globally would strip the entire body of every route that still types `@Body()` against a plain interface.

## The pattern, already established — follow it, do not redesign it

Read `src/modules/visits/visits.dto.ts` and `src/modules/ai/ai.dto.ts` (the richest examples), then `src/common/strict-validation-pipe.ts`. Per module:

1. Add `<module>.dto.ts` next to the module's `*.types.ts`, one class per body shape. Reuse one class for two routes when the shape is genuinely identical (`UpsertLocationCategoryDto`); use `extends` when one body is the other plus a field (`UpdateProductDto extends CreateProductDto`); keep them separate when inheriting would whitelist a field the route must ignore (`UpdateRouteTemplateDto` deliberately does not inherit `representativeUserId`).
2. Put `@UsePipes(createStrictValidationPipe())` on each write route — **never on a read route or one whose payload is all path params**.
3. Leave the service's `normalize*`/`parse*` helpers running unchanged behind it.
4. Update `docs/reference/api-reference.md` (the DTO-track table plus a note in the module's own section), `docs/reference/executable-spec.md` (a row for the new test file) and the plan's status counter, **in the same change**. Hard project convention.

## The rules this track has learned — these are the point

Most of these were bought with a bug. Do not rediscover them.

**Every field is optional, and the service keeps its error envelope.** Required-ness, trimming, uniqueness, calendar validity and reference checks stay in the service, so `CHAIN_INVALID`, `VISIT_INVALID`, `REPORT_INVALID` etc. are unchanged. The DTO is a coarse gate in front, not a replacement.

**`@IsOptional()` admits `null`, so every optional property is typed `?: T | null`.** Not `?: T` — that would describe an instance that cannot occur, and several routes document `null` as "clear this field".

**Import every cap, never restate one.** `TEXT_LIMITS`, `MAX_TEMPORARY_AUDIO_SIZE_BYTES`, `DATE_ONLY_PATTERN` and friends are imported from the module that enforces them. Where a constant lived inside a service, it was moved to a small shared module (`visits/visit-request-limits.ts`) rather than imported out of a Nest service — a DTO importing a service module is the wrong direction of dependency.

**Do tighten these two shapes.** They are silent wrong writes and the reason this track is worth doing:
- *Dropped enums.* A value outside the set the service recognises was normalized to `null` and then spread away, so a typo returned 200 having changed nothing. Worst case found: `PATCH /tasks` read an unrecognised status as `in_progress`, so a typo reopened a finished task.
- *Wrong type meant "clear this field".* On a PATCH the field is *present*, so the normalizer's `null` was written rather than ignored. `{"chainId": 0}` unlinked a location's chain; `{"email": 42}` erased a contact's email. Both 200s.

**Do not narrow a contract the service defines more loosely.** Found repeatedly, each one a live-screen break if you get it wrong:
- Number-or-string stays number-or-string (`latitude`, `sizeBytes` — the latter is signed as `Content-Length` by item 3.2, so refusing `"1048576"` makes the presigned PUT unsignable). Use the `@ValidateIf((_dto, value) => typeof value !== "string")` + `@IsNumber()` idiom.
- Timestamps stay plain strings where `parseOptionalDateTime` defines them; `""` and `null` are how a caller clears one.
- A shape check is not a semantic check: `@Matches(DATE_ONLY_PATTERN)` and calendar validity are different jobs, and `"2026-13"` passing the DTO while `normalizeMonth` refuses it is correct.
- An enum-looking field that *falls back* rather than failing is not an enum (`contentType` falls back to the file extension).

**Leave a judgement to the service when its refusal says more than a whitelist rejection would.** Three shipped examples: `status: "cancelled"` is *inside* `UpdateVisitDto`'s `@IsIn` set so the route can answer "Use `POST /visits/:visitId/cancel`"; the cancellation `reason` set stays with the service because its message enumerates every allowed value; `sizeBytes` is type-checked only, because "up to 50 MB" is what a rep with an over-long recording needs, not "must not be greater than 52428800".

**Verify every payload `apps/web` actually posts before you write the DTO.** `forbidNonWhitelisted` turns a field the client sends and the DTO forgets into a broken screen. Read `apps/web/lib/api-client.ts` *and* the call sites, since a wrapper takes a typed object but a caller can spread. Declare documented fields even when no client sends them today (imports write `externalCode`; `latitude`/`longitude` have no client at all).

## What remains

Counts verified 2026-08-04; re-check against code.

### Tier 4 — administrative surfaces (13 routes) — **done**

Shipped as one change: twelve DTO classes over `admin-settings` (3), `admin-users` (3), `storage` (2), `platform` (3) and `platform-tenant-superadmin` (2), pinned by `tests/admin-platform-dto-validation.test.ts`. Two of its findings change how tier 6 should be approached, so read them before starting there:

- **`@IsOptional()` is not automatically right.** It admits `null`, and `platform.service.ts` reads a *present* tenant field as a string (`input.name.trim()`) — so `{"name": null}` was a 500, not a "clear this field". Those fields use `@ValidateIf((_dto, value) => value !== undefined)` instead; only `primaryDomain` and `adminLimit`, where `null` genuinely clears something, keep `@IsOptional()`. Check which one a field actually wants before reaching for the idiom.
- **A route whose refusal is itself a security event must not be refused by the DTO.** `mfaCode` on `POST /platform/tenants/:tenantId/purge` carries `@Allow()` and no type check: the pipe runs before the service, and it is the service that charges the shared `platform-login` backoff and records `platform.reauth_failed`. An `@IsString()` there would have turned `{"mfaCode": 123456}` — the shape a naive scripted guess produces — into an unlogged, unpenalized 400, while buying nothing (`verifyTotpCode` already takes `unknown`). This is the tier-6 trap below, met one tier early; the answer generalizes directly to the login bodies.

### Tier 5 — `imports` (1 route), deliberately late

`POST /imports/jobs/validate` takes `{ templateType, csvText, fileName }`. `csvText` is a large, intentionally loose text blob bounded only by the 100 kB JSON body limit; `templateType` and `fileName` are the only fields that fit a DTO cleanly.

**Write a short design note before the code**, as was done for `visits` — see [`visits-dto-migration-note.md`](visits-dto-migration-note.md) for the shape and the standard. It raises the same question `confirmedData` did ("what does *whitelisted* mean for a body that is mostly a text blob"), and that note's answer is the thing to argue from or against: gate the envelope, leave the blob opaque, and say plainly what the gate does **not** buy. Note the difference worth weighing: unlike `confirmedData`, `csvText` is not replayed from a device outbox, so the argument that settled `visits` does not transfer automatically — decide it on its own merits.

### Tier 6 — `auth`, `password`, `platform-auth` (10 routes), last

`auth` (4), `password` (3), `platform-auth` (3). **These are the routes this repo can least afford a false rejection on**: a whitelist mismatch on `/auth/login`, `/auth/password/*` or the platform login's TOTP step is a lockout, not a bug report. Do these only once the pattern has held everywhere else, and prefer leaving a judgement to the service in every case where it is arguable.

Specific traps here:
- `password.controller.ts`'s helpers were duplicated from `auth.service.ts` by a concurrent PR once already and lost their length caps in the copy (recorded in the plan's follow-up section). Check both copies agree before declaring caps.
- Login bodies feed rate limiting and audit events (items 1.1 and 3.5). A refusal at the pipe happens *before* the service, so make sure a body refused by the DTO cannot become an unlogged login attempt or bypass the per-account backoff. **Half of this is already answered.** Nest's order is middleware → guards → interceptors → pipes, so every *guard* runs before the DTO: measured against the live API on 2026-08-04, `POST /platform/tenants/:tenantId/purge` with no session answers 401 `AUTHENTICATION_REQUIRED` for a body the pipe would also have refused, and a tenant session on `POST /platform/tenants` answers 403 before validation. The throttle is a guard too, so a refused body still costs its request. What is *not* covered is the per-account backoff and the audit event, both of which live in the service — which is exactly why tier 4 left `mfaCode` unvalidated (see tier 4 above), and the same reasoning should decide `password` and the login bodies field by field.

## How to verify — the bar this track has held

**Tests.** One file per tier or module, `tests/<name>-dto-validation.test.ts`, plain `node --test`. Copy the structure from `tests/visits-ai-dto-validation.test.ts`. It must:
- run the **real** `createStrictValidationPipe().transform()` with the metadata Nest attaches to a `@Body()` parameter (`{ type: "body", metatype, data: "" }`) — not the DTO class in isolation;
- read `PIPES_METADATA` off every gated handler **and** every ungated one on the same controller, so a misplaced decorator fails here rather than passing against a route the pipe never reached;
- pin the live `apps/web` payloads as accepted;
- pin the **non**-narrowings as explicitly as the tightenings. A test that only checks "invalid input is refused" passes just as well against a DTO that swallowed the service's better error message.

**Live.** Every tier so far was exercised against a running API, and it has repaid the effort every time (it is how the `parseDateOnly` rollover bug and the empty-`fieldErrors` gap were both confirmed). Bring the stack up per the working notes below and hit each gated route with a happy path and each refusal.

**Then** `npm run test`, `npm run lint`, `npm run format:check`, `npx tsc --noEmit`. All four; `format:check` is a separate CI step from `lint`.

## Working notes

- `npm run dev` runs the API through **ts-node, not tsx** — tsx drops the `design:paramtypes` metadata Nest DI needs. Tests are fine on tsx.
- Single test file: `node --import tsx --test tests/<file>.test.ts`.
- Prettier's globs **exclude `tests/`**. Format your own new test file explicitly (`npx prettier --write tests/<file>.test.ts`) and do not run a blanket `--write` over `tests/**` — it reformats dozens of unrelated files.
- Fresh worktrees have no `node_modules`: run `npm ci && npx prisma generate` in the worktree once (every `prisma` call needs `DATABASE_URL` in env). Never `cd apps/web && npm ci`.
- For live verification: copy the root `.env`, give the worktree its own `PORT`/`APP_BASE_URL`/`API_BASE_URL`/`SESSION_COOKIE_NAME`, and **set `S3_ENDPOINT` to a valid URL** — the committed placeholder is not one, and any upload-registration route 500s in `buildObjectUrl` without it (presigning needs no reachable server, just a parseable URL). `node --watch` does not reload `.env`; restart the API after editing it.
- Run `npm run db:up` only from the repo-root checkout, never from a worktree.
- Demo logins for live checks are in the platform docs/seed scripts; the field rep and all-roles accounts are the useful ones for tenant routes, and platform login needs a TOTP code.

## Unrelated follow-up, already identified

`GET /routes` fails for callers holding `routes.manage_team` unless they pass `representativeUserId`: `buildRoutePlanWhere` (`src/modules/routes/routes.service.ts`) narrows the filter to `null` for exactly that branch and then throws `AUTHENTICATION_CONTEXT_MISSING`. `apps/web/app/(workspace)/[tenantSlug]/manager/representatives/page.tsx` calls it that way. Not part of this task — `listRoutes` takes no body and is not gated — but it is a real bug worth its own change.
