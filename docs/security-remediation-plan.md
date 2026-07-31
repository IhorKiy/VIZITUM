# Security Remediation Plan

Status: draft · Date: 2026-07-31 · Scope: NestJS API (`src/`) + Next.js web (`apps/web`)

Derived from a defensive security review covering tenant isolation, authentication/authorization, session management, injection/input validation, secrets, and HTTP hardening.

## Baseline verdict

The core is solid. **No critical or exploitable data-exposure defect was found.** Tenant isolation holds uniformly (tenant id always from request context, never client input; every cross-tenant read/write is scoped and FK-validated). Auth primitives are strong: argon2id, 256-bit CSPRNG session tokens stored as SHA-256, httpOnly cookies, HMAC signed double-submit CSRF, private tenant-scoped storage with short-lived presigned URLs. The gaps are at the edges — brute-force resilience, security headers, and a few architectural guardrails — not in the data plane.

Work is grouped into three waves by priority. Each item lists the finding, the target files, the concrete change, and how to verify it. Ship each wave as its own PR (or one PR per item where noted) off latest `main`.

---

## Wave 1 — High priority (brute-force & platform-owner exposure)

### 1.1 Rate limiting / account lockout on auth endpoints
- **Risk (HIGH):** Unlimited online password guessing / credential stuffing against `/auth/login`, `/platform/auth/login`, `/auth/invites/accept`. Argon2 slows but does not stop it. Platform login is the highest-value single-account target.
- **Files:** `src/main.ts`, `src/modules/auth/*`, `src/modules/platform/platform-auth.service.ts`, `package.json`.
- **Change:**
  - Add `@nestjs/throttler`. Register a global throttler guard with a permissive default, then tight per-route limits on the login and invite-accept routes (per-IP **and** per-account/email).
  - Add short-lived progressive backoff / temporary lockout after N consecutive failures per account.
  - Keep this independent of Turnstile — it is the always-on floor.
  - Requires `trust proxy` (item 3.3) for correct per-IP keying behind Render's proxy.
- **Verify:** New test asserting the Nth+1 rapid login attempt is rejected with 429; manual check that a valid login still succeeds after the window resets.

### 1.2 Turnstile: fail-closed on rejection, required in production
- **Risk (HIGH):** Captcha is the only brute-force control today, and it (a) is a silent no-op when `TURNSTILE_SECRET_KEY` is unset, and (b) fails open on any non-2xx siteverify response — an attacker can induce this by loading siteverify (`src/modules/auth/turnstile.service.ts:36-77`).
- **Files:** `src/modules/auth/turnstile.service.ts`, app bootstrap/config validation, `docs/reference/environment.md`.
- **Change:**
  - Separate *transport failure* from *HTTP rejection*: treat a non-2xx siteverify response as a verification failure (fail closed). Only fail open on genuine network errors, and gate that behind a short circuit-breaker window plus a hard `fetch` timeout (`AbortSignal`).
  - Make `TURNSTILE_SECRET_KEY` required when `NODE_ENV === "production"` — fail startup if absent.
  - Expose captcha-enabled state on the health endpoint so a misconfig (site key set, secret missing) is observable.
  - Note: `tests/auth-captcha.test.ts` currently pins "fails open when unreachable" — update it to match the new transport-vs-rejection semantics.
- **Verify:** Update `tests/auth-captcha.test.ts`; add a case that a non-2xx siteverify response now rejects the login.

### 1.3 Harden the platform-owner account
- **Risk (HIGH, aggregate):** `/platform/login` is publicly reachable and protected by a password alone — no MFA, no lockout, no IP allowlist, 30-day session. One credential controls every tenant's data.
- **Files:** `prisma/schema.prisma` (PlatformUser), `src/modules/platform/*`, `apps/web/app/platform/login/*`.
- **Change:**
  - Add MFA (TOTP or WebAuthn) to `PlatformUser`; require it on platform login.
  - Aggressive lockout + login alerting for the platform domain (pairs with 1.1 and 3.5).
  - Shorten the platform session TTL (hours, not 30 days) and require re-auth for destructive tenant operations (pairs with 2.4).
- **Verify:** e2e for the TOTP/WebAuthn challenge; unit test that a platform session older than the new TTL is rejected.
- **Note:** Largest item in the wave — may warrant its own PR and a short design note (choose TOTP vs WebAuthn first).

---

## Wave 2 — Medium priority (hardening & guardrails)

### 2.1 Security response headers (web + API)
- **Risk (MEDIUM):** `apps/web/next.config.ts` sets no CSP, `X-Frame-Options`/`frame-ancestors` (login pages are framable → clickjacking), HSTS, `Referrer-Policy`, or `X-Content-Type-Options`. No `helmet` on the API.
- **Files:** `apps/web/next.config.ts`, `src/main.ts`.
- **Change:**
  - Add a Next `async headers()` block: nonce-based CSP (include `https://challenges.cloudflare.com` in `script-src`/`frame-src` for Turnstile), `frame-ancestors 'none'`, HSTS, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`. Set `poweredByHeader: false`.
  - Add `helmet()` to the Nest bootstrap for consistency.
- **Verify:** curl the web app and assert the headers are present; confirm Turnstile still loads under the CSP.

### 2.2 Password change flow + invite cannot overwrite an active account
- **Risk (MEDIUM):** No self-service change/reset password exists. `acceptInvite`'s upsert overwrites `passwordHash` and reactivates soft-deleted users — any still-pending invite (7-day TTL) is a working password-overwrite for that email (`src/modules/auth/auth.service.ts:255-279`).
- **Files:** `src/modules/auth/auth.service.ts`, `auth.controller.ts`, `src/modules/users/users.service.ts`, `apps/web` account UI.
- **Change:**
  - Add an authenticated change-password endpoint (verify current password, revoke all *other* sessions on success).
  - In `acceptInvite`, refuse to overwrite the password of an already-`active` user (or require the invite to post-date the user's `passwordChangedAt`).
  - Revoke prior pending invites for the same `(tenantId, email)` when issuing a new one.
- **Verify:** Tests for change-password happy/failure paths; test that accepting a stale invite for an active user is rejected.

### 2.3 CSRF path normalization (case-sensitivity bypass)
- **Risk (MEDIUM):** `isPlatformPath` compares the raw `/api/platform/` case-sensitively while Express routing is case-insensitive; `POST /api/Platform/...` with a platform session skips CSRF entirely (`src/modules/auth/csrf.ts:141-146`). Mitigated by `SameSite=Lax`.
- **Files:** `src/modules/auth/csrf.ts`, `src/main.ts`.
- **Change:**
  - Normalize the path once (lowercase, strip query/trailing slash) and share it between `isCsrfExemptRoute` and `resolveCsrfSession`.
  - Set `app.set('case sensitive routing', true)` and `strict routing`.
  - Optionally add an `Origin`/`Sec-Fetch-Site` check as a second layer.
- **Verify:** Test that `/api/Platform/...` (mixed case) with a platform session now requires a CSRF token.

### 2.4 Global input validation + backend length caps
- **Risk (MEDIUM/LOW):** No global `ValidationPipe`, no class-validator. Mass-assignment safety rests on service discipline (`data: { tenantId, ...parsed }`, never `...body`). Most free-text fields have no backend length cap (all columns are unbounded `text`; only client-side `INPUT_LIMITS` guards them).
- **Files:** `src/main.ts`, DTOs across `src/modules/*`, the shared `normalize*` helpers, `prisma/schema.prisma`, `package.json`.
- **Change:**
  - Add `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))` with class-validator DTOs — defense-in-depth against future `...body` spreads.
  - Enforce backend length caps in the `normalize*` helpers mirroring `apps/web/lib/input-limits.ts` (keep the two in sync).
  - Set an explicit Express JSON body-size limit rather than relying on the ~100 kB default.
- **Verify:** Test that an over-limit field and an unknown extra property are both rejected at the API.

### 2.5 Session TTL, rotation & idle timeout
- **Risk (MEDIUM):** 30-day absolute TTL, no rotation (not on login, not on privilege change), no idle timeout — including platform-owner sessions (`src/modules/auth/auth.constants.ts:4`). A stolen cookie is valid up to 30 days.
- **Files:** `src/modules/auth/auth.constants.ts`, `session.service.ts`, `session-lifecycle.ts`, `auth.service.ts` (switchRole/switchZone).
- **Change:**
  - Shorten TTL (tenant: days; platform: hours) and add an idle timeout enforced against `lastSeenAt` in `isSessionActive` (it is written but never read for expiry).
  - Rotate the session token on any privilege change (role/zone switch, superadmin promotion).
- **Verify:** Test that an idle session past the timeout is rejected; that a role switch mints a new token.

### 2.6 Do not return raw invite tokens in API responses
- **Risk (MEDIUM):** `inviteUser`/`resendInvite` return the plaintext token in the API response, which flows through the Next server and admin UI and any log sink (`src/modules/users/users.service.ts:955-966`).
- **Files:** `src/modules/users/users.service.ts`.
- **Change:**
  - Return the token only to the creating request and only when email delivery is unavailable (flagged as such); never in list responses.
  - Move the invite `status !== "pending"` check inside the acceptance transaction as a conditional `updateMany({ where: { id, status: "pending" } })`, aborting on 0 rows affected.
- **Verify:** Test that list/detail responses never include the token; concurrency test on double-accept.

---

## Wave 3 — Low priority / hardening

### 3.1 Equalize login timing (user enumeration)
- **Risk (LOW):** Argon2 runs only when the user exists, so response timing distinguishes valid emails/tenants (`auth.service.ts:88-99`, `platform-auth.service.ts:49-60`).
- **Change:** Perform a dummy argon2 verify against a fixed hash on the not-found path. Consider a generic error for unknown tenant slugs on the login route.

### 3.2 Enforce upload size on presigned PUTs
- **Risk (LOW/MEDIUM):** `s3-storage.client.ts:29-45` signs `contentType` + host but not `Content-Length`; the byte cap is validated only against the client-declared size at registration, so the actual PUT to R2 is uncapped.
- **Change:** Sign `Content-Length` (or a content-length-range policy) so R2 enforces the cap.

### 3.3 Set `trust proxy`
- **Risk (LOW):** No `app.set('trust proxy', …)`; `request.ip` is the proxy address, degrading session forensics and undermining any IP-based rate limit (1.1).
- **Change:** Set `trust proxy` to the exact hop count; forward `x-forwarded-for` from the Next layer (`buildRequestHeaders`).

### 3.4 `__Host-` cookie prefix
- **Risk (LOW):** Session/CSRF cookies lack the `__Host-` prefix → cookie-tossing from a sibling subdomain.
- **Change:** Rename to `__Host-vizitum_session` / `__Host-vizitum_csrf` in production (requires `Secure`, `Path=/`, no `Domain` — all already true). Also drive the `secure` flag from an explicit `COOKIE_SECURE` env var rather than `NODE_ENV`.

### 3.5 Auth audit events
- **Risk (LOW):** No audit record for login success/failure/logout on either domain, so the brute-force that 1.1 addresses can't be detected after the fact.
- **Change:** Emit `auth.login.success` / `auth.login.failed` / `auth.logout` audit events (tenant + platform), including user id.

### 3.6 Pin argon2 work factor + rehash-on-login
- **Risk (INFO):** `hash(password)` uses library defaults with no `needsRehash` path, so a dependency bump can silently change cost and existing users can never be upgraded.
- **Change:** Pin explicit argon2id parameters in a constant; on successful login, re-hash when `argon2.needsRehash(hash, options)`.

### 3.7 Dependency advisories (transitive)
- **Risk (LOW):** `npm audit` reports 5 high (postcss XSS/path-traversal, sharp/libvips CVEs), both transitive via `next@16`. Real exposure is low — the app avoids `next/image` (logos render via plain `<img>`) so no user bytes reach libvips at runtime, and postcss runs at build over first-party CSS only.
- **Change:** Bump Next when a patched release is available; not urgent.

### 3.8 Miscellaneous
- Replace hand-rolled cookie parsing (`src/common/cookie-token.ts`) with the `cookie`/`cookie-parser` package.
- Route `switchRole`/`switchZone` session resolution through `PermissionGuard` instead of three parallel inline copies.
- Add server-side email format validation on contact/user email.

---

## Sequencing

1. **PR 1 — Rate limiting + `trust proxy`** (1.1, 3.3): highest value, unblocks per-IP keying.
2. **PR 2 — Security headers** (2.1): quick, high defensive payoff.
3. **PR 3 — Turnstile fail-closed + required in prod** (1.2).
4. **PR 4 — Password change + invite overwrite fix** (2.2, 2.6).
5. **PR 5 — CSRF normalization** (2.3).
6. **PR 6 — Platform-owner MFA** (1.3): own PR + short design note.
7. **PR 7 — Global ValidationPipe + length caps** (2.4).
8. **PR 8 — Session TTL/rotation** (2.5).
9. **PR 9 — Low-priority hardening batch** (3.1–3.8, split as convenient).

Keep `docs/reference/environment.md`, `permissions.md`, and `api-reference.md` updated in the same PRs where env vars, permissions, or endpoints change.
