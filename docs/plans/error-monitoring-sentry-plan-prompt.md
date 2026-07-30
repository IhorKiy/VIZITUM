# Task: Complete error monitoring (Sentry) across web frontend and workers

## Context

VIZITUM is a multi-tenant field-visit SaaS: NestJS API at repo root (`src/`), Next.js App Router frontend in `apps/web` (Next 16, React 19), PostgreSQL via Prisma. Read `CLAUDE.md` and `AGENTS.md` first, then `docs/reference/module-map.md` and `docs/reference/environment.md`.

Current error-monitoring state (verify against code):

- **Backend API is already covered.** `src/common/sentry.service.ts` is a deliberately lightweight, hand-rolled Sentry client: it builds a Sentry envelope and POSTs it with `fetch` to the endpoint derived from `SENTRY_DSN` — no `@sentry/*` SDK dependency. It is a no-op when `SENTRY_DSN` is unset, and a failed capture only logs a warning (never fails the request).
- `src/common/api-error.filter.ts` (the global exception filter) captures every **5xx** response with tags `requestId`, `method`, `path`, `statusCode`, `errorCode`, `module: "api"`.
- Env vars `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` are documented in `docs/reference/environment.md`; `GET /health` (see `src/modules/health/health.service.ts`) reports `sentryConfigured` / `sentryReleaseConfigured`.
- `tests/sentry-service.test.ts` pins the envelope format, the disabled-without-DSN behavior and scrubbing expectations.
- **Gap 1 — web frontend (`apps/web`) has zero error monitoring.** No Sentry reference anywhere: browser-side exceptions, React render errors and Next.js server-side errors (server components, server actions) are invisible in production.
- **Gap 2 — workers report nothing.** `src/worker.ts` (cleanup/purge tasks) catches failures, logs them via `JsonLogger` and sets `process.exitCode = 1`, but no Sentry event is sent.
- **Gap 3 — backend stack traces are low-fidelity.** `parseStackFrames` in `sentry.service.ts` puts each raw stack line into the `function` field with no `filename`/`lineno`/`colno`, which makes Sentry grouping and reading traces harder than necessary.

## Target design (decided, do not re-litigate)

1. **Stay SDK-free; extend the existing lightweight envelope approach.** Do **not** add `@sentry/nextjs` or `@sentry/node`. Rationale: the backend already made this choice deliberately (small dependency surface, full control over what leaves the process); `@sentry/nextjs` adds significant bundle weight and build-config coupling for capability we don't need (tracing, replay). The browser and Node can POST the same envelope format to the same `/api/<project>/envelope/` endpoint.

2. **Frontend — three capture surfaces, one shared reporter:**
   - New `apps/web/lib/error-reporting.ts`: a small module that builds and sends a Sentry envelope (`platform: "javascript"` for browser events, `platform: "node"` for server events). Reuse the DSN-parsing/envelope logic shape from `src/common/sentry.service.ts`, but keep the frontend copy self-contained inside `apps/web` (the two workspaces do not share code today; do not introduce a shared package for this).
   - **Browser DSN is public by design**: expose it as `NEXT_PUBLIC_SENTRY_DSN` (plus `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_RELEASE`). It may be the same DSN as the backend's or a separate Sentry project — both must work; the code just reads the env var. Everything is a silent no-op when unset (dev default).
   - **React render errors**: add `apps/web/app/global-error.tsx` (client component) that reports the error and renders a minimal recovery screen. Note the root `global-error` renders outside the locale provider, so its user-visible strings cannot use `useTranslations`; keep the visible text minimal and hardcode-free by using both dictionaries' `common` fallback pattern — check how `apps/web/app/[tenantSlug]` handles pre-provider errors first, and follow the least-surprising existing pattern. `npm run web:i18n:check` must stay green.
   - **Unhandled browser errors**: a tiny client component mounted once in the root `apps/web/app/layout.tsx` that registers `window.onerror` + `onunhandledrejection` listeners and reports through the shared module. Dedupe repeated identical errors (simple in-memory key of message+stack, cap events per pageload, e.g. 10) so an error loop can't flood Sentry.
   - **Next.js server-side errors**: add `apps/web/instrumentation.ts` implementing the `onRequestError` hook (supported in Next 15+; verify the exact signature against the installed Next 16) to capture server-component/server-action/route errors with method, path and digest as tags, `module: "web-server"`.

3. **Worker coverage**: in `src/worker.ts`, resolve `SentryService` from the Nest application context (it is `@Injectable`; register/provide it wherever the app module makes it available — check how `ApiErrorFilter` obtains it and mirror the simplest working approach) and call `captureException` in the existing `catch` with `module: "worker"`, `operation: <task>`, plus a synthetic `requestId` (e.g. `worker-<task>-<timestamp>`). Capture must be awaited before `app.close()` so the process doesn't exit with the event unsent.

4. **Backend stack-trace fidelity**: improve `parseStackFrames` to parse V8 stack lines (`at fn (file:line:col)` and `at file:line:col` forms) into `{ function, filename, lineno, colno }`, keeping the existing frame cap and reversal (Sentry expects oldest-first). Unparseable lines keep the current raw-line fallback. Update `tests/sentry-service.test.ts` accordingly.

5. **Privacy/scrubbing stays as-is**: events carry no request bodies, no user PII, no tenant data — only message, stack, method, path, status/error codes and ids. The frontend reporter must follow the same rule (no form values, no localStorage contents, no cookies).

6. **Health visibility**: extend the existing health payload only if it already has a natural place for web-side config (it likely doesn't — the web app has no health endpoint; in that case skip, do not invent one).

## Non-goals (explicitly out of scope, list as follow-ups in the PR description)

- Source-map upload / release artifact publishing to Sentry (stack traces will show minified frames for browser errors; acceptable for now).
- Performance tracing, session replay, breadcrumbs, user feedback widgets.
- Alerting rules / Sentry project configuration (done in the Sentry UI, not in code).
- Capturing 4xx responses or handled validation errors.
- A shared `packages/` workspace for the envelope code.

## Plan of record

1. **Backend stack-trace fidelity + worker capture** (pure backend, lowest risk):
   - Rework `parseStackFrames`; extend `tests/sentry-service.test.ts`.
   - Wire `SentryService` into `src/worker.ts`; add a test if worker bootstrap logic is testable without a full Nest boot (if not, cover the new frame parser thoroughly instead and note it).
2. **Frontend reporter + browser capture**:
   - `apps/web/lib/error-reporting.ts` with envelope builder + sender, no-op without `NEXT_PUBLIC_SENTRY_DSN`, per-pageload event cap.
   - Client listener component in root layout; `apps/web/app/global-error.tsx`.
   - Unit-test the envelope builder and dedupe/cap logic in `tests/web-error-reporting.test.ts` (plain node test importing the pure functions; keep DOM-dependent code separated from the testable core).
3. **Next server-side capture**: `apps/web/instrumentation.ts` with `onRequestError`; verify against Next 16 docs/types, not memory.
4. **Docs**: update `docs/reference/environment.md` (new `NEXT_PUBLIC_SENTRY_*` vars, worker note on reusing API Sentry vars), and `docs/reference/module-map.md` if it lists frontend cross-cutting concerns.
5. **Verification**:
   - `npm run test`, `npm run lint`, `npm run format:check` (CI runs it separately from lint), `npm run web:typecheck`, `npm run web:build`, `npm run web:i18n:check`.
   - Manual smoke: run web dev with a fake DSN pointing at a local listener (or a real staging DSN), throw a test error from a client component and from a server action, confirm both envelopes arrive; run `WORKER_TASK=cleanup` with a forced failure and confirm the worker envelope.

## Working rules

- Follow the worktree rules in `CLAUDE.md`: start from a clean branch off latest `main` (`feat/error-monitoring-web-worker` or similar), never commit onto `wt-N` or `main`.
- All new user-visible frontend strings go through `apps/web/messages/{en,uk}.json` with real Ukrainian translations (see the i18n section of `CLAUDE.md`); the `global-error` screen is the one place needing special handling — solve it, don't skip translation.
- Free-text inputs are not expected in this task, but if any UI is added, respect `INPUT_LIMITS`.
- Keep each capture path fail-safe: a broken/unreachable Sentry endpoint must never affect user-facing behavior (no thrown errors, no blocked navigation, no delayed responses beyond the worker's final await).
