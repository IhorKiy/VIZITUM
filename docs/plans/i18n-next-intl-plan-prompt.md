# Task: Internationalize the web frontend with next-intl (tenant-driven locale)

## Context

VIZITUM is a multi-tenant field-visit SaaS: NestJS API at repo root (`src/`), Next.js App Router frontend in `apps/web` (Next 16, React 19), PostgreSQL via Prisma. Read `CLAUDE.md` and `AGENTS.md` first, then `docs/reference/module-map.md` and `data-model.md`.

Current i18n state (verify against code):

- **No i18n library is installed.** All UI strings are hardcoded in JSX.
- The UI is in a **mixed language state**: admin/manager/platform screens are English, while the two field-representative screens contain hardcoded Ukrainian (`app/[tenantSlug]/field/page.tsx`, `app/[tenantSlug]/field/locations/[locationId]/page.tsx`).
- The `Tenant` Prisma model **already has `language` and `timezone` fields** (`prisma/schema.prisma`), but `language` is not consumed by the frontend anywhere yet. The platform screens already have a `timezone-form.tsx`; check whether/where `language` is editable.
- Frontend surface: ~36 `.tsx` files, ~11k lines total, under `apps/web/app/` (areas: `[tenantSlug]/{admin,manager,field,operations,invites,login}`, `platform/*`, root pages) plus shared components in `apps/web/components/` and navigation labels in `apps/web/lib/navigation.ts`.

## Target design (decided, do not re-litigate)

1. **Library: `next-intl`**, used in **"without i18n routing" mode**. Do **not** add a `[locale]` URL segment — the URL structure already carries `[tenantSlug]` and must not change. Locale is resolved server-side per request. Verify the next-intl version compatible with Next 16 before pinning.
2. **Locale source is the tenant**, not the URL and not the browser:
   - Inside `[tenantSlug]/...` (including pre-auth pages like login and invite-accept, where the tenant is already resolvable from the slug): use the tenant's `language` field.
   - `platform/*` and root pages: default to `en` (platform-user language preference is out of scope).
   - Fallback locale is `en` everywhere (missing key or unsupported tenant language must never crash a page).
3. **Supported locales initially: `en` and `uk`.** `en` is the canonical source of truth. Message files live in `apps/web/messages/en.json` and `apps/web/messages/uk.json`, organized by namespace per area (`common`, `auth`, `field`, `manager`, `admin`, `operations`, `platform`, `invites`).
4. **`uk.json` must be fully populated** with real Ukrainian translations (not stubs): the current pilot is Ukrainian, so after this change a tenant with `language = "uk"` gets a fully Ukrainian UI (today admins see English). Reuse the existing Ukrainian strings from the field screens verbatim where they exist.
5. **Dates and numbers** go through next-intl formatters, honoring the tenant `timezone` where a timestamp is shown. Replace ad-hoc `toLocaleDateString`/manual formatting as you touch each file.
6. **Tenant language must be editable**: if no admin-facing control exists, add a language selector to the tenant settings screen (`app/[tenantSlug]/admin/settings/page.tsx`) wired to the existing settings module (`src/modules/settings`), and/or alongside the platform `timezone-form.tsx`. Follow the tenancy invariant: tenant id from `RequestContext`, never from client input.
7. **Convention going forward**: every new UI string goes through the message dictionary. Encode this as a short rule in `CLAUDE.md` (frontend section) and add a cheap guard — e.g. a CI/lint grep failing on Cyrillic literals in `apps/web/app/**/*.tsx` outside `messages/`.

## Non-goals (explicitly out of scope, list as follow-ups in the PR description)

- Translating backend API error messages/codes (frontend may map known error codes to localized strings, but the backend contract stays English).
- AI transcription/extraction language handling (`src/modules/ai`) — separate task; do not touch.
- Per-user language override (cookie/profile) — the tenant-level setting is enough for now.
- Localizing reference docs, emails, or CSV import templates.

## Suggested execution order

1. **Infrastructure** (small): install next-intl in the `apps/web` workspace, add `i18n/request.ts` with `getRequestConfig`, wire the provider in the root layout, create both message files with the `common` namespace, and implement tenant-locale resolution. First verify how tenant data (slug → settings) already reaches server components — reuse that path; only extend the API if `language` is genuinely not exposed yet (check `docs/reference/api-reference.md` first).
2. **Extraction, area by area** (bulk of the work — mechanical; keep commits per area):
   1. `field/*` (has the only Ukrainian strings today; most end-user-visible),
   2. `login` + `invites` (entry points),
   3. shared `components/` + `lib/navigation.ts` labels,
   4. `manager/*` (largest files, ~3.6k lines),
   5. `admin/*`,
   6. `operations`, `platform/*`, root pages.
3. **Tenant language selector** (item 6 above) + docs updates (`docs/reference/api-reference.md`, `data-model.md`, `module-map.md` if endpoints/screens change — hard project convention).
4. **Guard + convention note** (item 7 above).

## Verification

- `npm run web:typecheck` and `npm run web:build` must pass after every stage.
- Run the app (`npm run dev` — ts-node, **not** tsx, see CLAUDE.md — plus `npm run web:dev`) and walk the key screens twice: once with tenant `language = "uk"`, once with `"en"`. Check: field home, a visit flow screen, login, admin settings, one manager screen, platform tenants list (stays English).
- No hardcoded user-visible literals left in touched files; the Cyrillic grep guard passes.
- Existing tests must stay green (`npm run test`); frontend has no test runner — typecheck + build + manual walk is the bar.

## Rough sizing

- Stage 1 (infra + locale resolution): small — a day-scale change, mostly wiring and one settings read path.
- Stage 2 (extraction): the bulk — ~36 files / ~11k lines, several hundred strings; mechanical but must be done carefully (pluralization, interpolated values like `{firstName}`, `aria-label`s, placeholder/`title` attributes, toast/error texts — not just visible JSX text).
- Stages 3–4: small.

## Working notes

- The branch you start from may have moved since this prompt was written — trust the code over this snapshot.
- Do not restructure routes, navigation permission filtering (`apps/web/lib/navigation.ts` is permission-string based), or any backend permission logic while extracting strings.
- Keep the manual report-confirmation flow untouched functionally — it is a hard product requirement (see CLAUDE.md).
