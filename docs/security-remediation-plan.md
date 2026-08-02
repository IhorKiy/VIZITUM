# Security Remediation Plan

Status: waves 1 and 2 implemented · Date: 2026-07-31 · Scope: NestJS API (`src/`) + Next.js web (`apps/web`)

## Implementation status

Waves 1 and 2 are done, plus 3.3 (trust proxy), which 1.1 depends on for
correct per-IP keying. Each item below is marked; the reference docs
([environment.md](reference/environment.md),
[api-reference.md](reference/api-reference.md),
[data-model.md](reference/data-model.md),
[module-map.md](reference/module-map.md),
[executable-spec.md](reference/executable-spec.md)) describe the shipped
behaviour and are the place to read what the code does now — this file stays
as the record of what was found and why each fix took the shape it did.

| Item | Status |
| ---- | ------ |
| 1.1 Rate limiting / account lockout | Done — hard per-IP throttle, progressive per-account delay, Redis-backed counters. Amended: the per-IP half was bypassable until `CLIENT_IP_HEADER` landed — see the follow-up below |
| 1.2 Turnstile fail-closed, required in production | Done |
| 1.3 Platform-owner hardening | Done for TOTP MFA and the shortened session TTL. Login alerting is 3.5 (wave 3); re-auth for destructive tenant operations is **not** implemented |
| 2.1 Security response headers | Done — verified live, including Turnstile under the CSP |
| 2.2 Password change + invite overwrite | Done, but **not by this branch**: PR #168 landed both halves — the authenticated change *and* the forgot-password flow the plan deferred — while this was open, so this branch dropped its duplicate change-password and kept only the invite-overwrite fix |
| 2.3 CSRF path normalization | Done, including the Express routing flags (applied before the router is built) |
| 2.4 Backend length caps + body limit | Done. The class-validator DTO migration remains deferred |
| 2.5 Session TTL, rotation and idle timeout | Done |
| 2.6 Raw invite tokens | Done |
| 3.2 Upload size | Half done — the read side enforces the cap against the length the store reports; signing `Content-Length` on the PUT is still open. See the item below |
| 3.5 Auth audit events | Done — login success/failure and logout on both domains, with the failure reason; see the item below |
| 3.1, 3.4, 3.6–3.8 | Not started (wave 3) |

Two deviations worth knowing about, both deliberate:

- **1.2 fails closed on any non-2xx siteverify response, as specified.** That
  includes a 5xx or 429 from Cloudflare, which therefore blocks logins for as
  long as it lasts. The alternative — treating a degraded response as "allow"
  — is the bypass this item exists to remove.
- **`TRUST_PROXY_HOPS` has no production default and the process refuses to
  start without it.** The plan says "set it to the exact hop count"; there is
  no value that is safe to guess, since too low puts all traffic in one
  rate-limit bucket and too high lets clients forge their own address.
  Successive versions of this document asserted 1, then 2, and staging
  measured 3 — a Cloudflare proxy sits in front of Render, which no amount of
  reading this repository would have revealed. Derive nothing: the readiness
  diagnostic added in #170 reports the address the setting actually resolved
  and the length of the forwarded chain, and the correct hop count is that
  length. Measure each environment separately.

## Follow-up review of the shipped work

A second pass over the implementation found three defects in what had already
landed. All three are fixed; they are recorded here because two of them were
introduced *by* this plan's own work and the third was an error in its
reasoning, which is worth not repeating.

- **The per-IP throttle of 1.1 rested on the host rather than on the code.**
  The web layer forwarded the leftmost `X-Forwarded-For` entry as the client
  address, and the API keys every per-IP limit on it. Whether that entry is the
  client's or the caller's to choose is decided entirely by whatever terminates
  the request first, and nothing in the repository recorded which it was.

  **Not exploitable as deployed — the first version of this note said it was,
  and that was wrong.** `apps/web` runs on Vercel, which overwrites
  `X-Forwarded-For` and drops external values expressly to prevent spoofing,
  and `www.vizitum.com` reaches it directly: Cloudflare holds the DNS but does
  not proxy that hostname (`server: Vercel`, no `cf-ray`). The
  Cloudflare-appends reasoning is sound, but it describes the edge in front of
  *Render*, where the API lives, not the web layer. Turning Cloudflare's proxy
  on for the web domain is a one-switch change that would have made the old
  behaviour a live bypass with nothing here to notice it — that latent
  exposure, not a present one, is what this closes.

  The address now comes from a header named per deployment by
  `CLIENT_IP_HEADER` — `x-vercel-forwarded-for` here, the one Vercel keeps
  authoritative even under a proxy — with a startup gate in production and no
  address forwarded at all when the header is absent.
  `tests/web-client-address.test.ts` pins it.

  The documentation error was real and is corrected: this plan recorded the
  safe condition as an edge that "appends to, or normalizes" the header.
  Appending is exactly what leaves the entry caller-controlled; only
  overwriting or stripping is sufficient. See `docs/reference/environment.md`
  and `src/common/trust-proxy.ts`.

  **Untouched by this:** the API answers on its own public `*.onrender.com`
  URL, so a caller reaching it directly can still forge the chain and pick the
  address it is limited under. Recorded as an accepted risk below rather than
  fixed.
- **2.4's caps did not reach the password endpoints.** PR #168 landed the
  recovery flow while the caps PR was open, carrying its own copies of
  `normalizeToken` / `normalizeNewPassword` / `normalizeTenantSlug` /
  `normalizeCurrentPassword` — the same helpers as `auth.service.ts`'s, minus
  the limits. `/auth/password/{forgot,reset,change}` therefore accepted
  unbounded values up to the body limit. `tests/input-limits.test.ts` could not
  catch this: it compares the two limit maps, not their use sites.
- **The per-account backoff did not apply to the password change.**
  `BackoffScope` declared `"password-change"` and nothing ever used it, so the
  one credential check reachable from a session someone else already holds — a
  borrowed phone left signed in — was bounded only by the 10/min per-IP cap.

### Found outside this plan: a suspended tenant kept serving its live sessions

Not a wave-3 item and not a defect in this plan's work — a gap the original
review did not look for, found by a later audit and fixed with it.
`TenancyService.assertTenantCanServeRequests` was reachable only from
`resolveTenant`, i.e. from login and password reset. `PermissionGuard` checked
the user's status but never the tenant's, so every session opened before a
suspension or archival kept full access for the rest of its TTL — the exact
window an abuse or non-payment suspension exists to close, and the one
`unarchiveTenant`'s own comment claimed was already shut. The serving set now
lives in `tenancy/tenant-serving-status.ts` and is read by both the login-time
resolution and the guard, and the platform side revokes the tenant's open
sessions when it archives or suspends. `tests/tenant-suspension-revokes-access.test.ts`
pins both halves.

Worth generalizing: the finding is that a check performed once at the session
boundary is not a check on requests. Anything else resolved only at login has
the same shape.

Still open from the original review: wave 3 apart from 3.5 and the read half
of 3.2, plus re-auth for destructive tenant operations (part of 1.3). Item 3.7 has moved and should be
re-read rather than trusted as written — `next` now carries advisories of its
own beyond the transitive `postcss`/`sharp` ones, with a patched release
available, and `multer` (via `@nestjs/platform-express`, no multipart endpoint
in the app) has appeared since.

### Found outside this plan: the second factor's own weak points

Two more gaps the original review did not look for, found by the same later
audit and fixed with it. Both sit inside 1.3's TOTP work, which this plan
recorded as simply "done".

- **The TOTP secret was stored in the clear.** A code is verified against the
  secret itself, so unlike a password it cannot be hashed — which is exactly
  why it needed encrypting. Any database read (a dump, a replica, a restore
  drill) handed over a permanent code generator for the one account that
  reaches every tenant. Now AES-256-GCM under `TOTP_ENCRYPTION_KEY`, with a
  production boot gate, both formats readable so an enrolled owner survives
  the deploy, a re-encrypt on next sign-in, and
  `npm run encrypt:totp-secrets` to migrate immediately rather than
  eventually.
- **A code could be spent more than once.** One code is accepted across three
  steps — the current one and one either side, for the clock drift RFC 6238
  expects — and nothing recorded that it had been used. Roughly ninety
  seconds in which a code seen over a shoulder, or caught by a phishing
  proxy, worked again for whoever also had the password. `totpLastUsedStep`
  now records the step of the last accepted code, claimed with a conditional
  update so two concurrent replays cannot both win.

Worth generalizing alongside the tenant-status finding above: both of these
are controls that were *present* and looked complete. "MFA is implemented" and
"the tenant status is enforced" were both true statements that stopped short
of the property anyone actually wanted.

### Accepted risk: the API is directly reachable, so per-IP keying is advisory

**Decision, 2026-08-01: accepted for the pilot, not fixed.** Recorded here so it
is a choice on the record rather than an oversight, and so the options are not
re-derived from scratch.

**The exposure.** The API answers on `vizitum-api-staging.onrender.com` (and
whatever the production service is named). Every per-IP limit in
`src/modules/rate-limit` keys on `request.ip`, which Express resolves from
`X-Forwarded-For` at `TRUST_PROXY_HOPS`. A caller who goes straight to that URL
writes the leftmost entry itself, so it chooses the identity it is limited
under and can take a fresh bucket per request. It also chooses the `ipHash`
stored on any session it opens, making that field unreliable for forensics on
traffic that did not come through the web layer. `src/common/trust-proxy.ts`
and `tests/trust-proxy-resolution.test.ts` already state and pin this.

**What still holds, which is why this is survivable.** The per-account backoff
keys on the address being signed into rather than on the network, so guessing
one account stays capped at roughly three attempts a minute however many source
addresses the caller invents. Turnstile still runs before any database work,
argon2 still costs what it costs, and platform login still needs a TOTP code.
What is lost is the *hard* per-IP ceiling — credential stuffing spread thinly
across many accounts is the case it stops bounding.

**Why not simply block direct access.** Checked against the actual hosting,
2026-08-01:

- **Render private service** — removes the public URL and serves only inside
  Render's private network. `apps/web` is on Vercel, which is not on it, so the
  product would stop working entirely.
- **Render inbound IP rules** — exist, but for individual web services they
  need the **Scale or Enterprise** plan.
- **Vercel egress IPs are not static.** Vercel documents that deployments can
  come from any address; fixed ones require Secure Compute / Static IPs, an
  **Enterprise** feature, and the Edge runtime that `apps/web/proxy.ts` runs on
  is excluded from it regardless. So there is no address list to allow even
  after paying for the Render side.
- **It would break the monitoring that exists.** UptimeRobot polls
  `/api/health/readiness` every five minutes, `npm run alerts:check` reads
  readiness and `/api/operations/summary`, and
  `docs/runbooks/expanded-staging-product-smoke.md` curls the API directly —
  including the readiness proxy diagnostic this plan tells operators to use to
  measure `TRUST_PROXY_HOPS`.

**The fix when this stops being acceptable.** Blocking is the wrong shape;
distinguishing callers is the right one. Have the web layer send a shared
secret header alongside the address, and have the API trust `X-Forwarded-For`
only when that secret verifies — otherwise ignore it and key on the address
Render's own edge supplies (`CF-Connecting-IP`, which its Cloudflare sets and a
direct caller cannot forge). Direct callers then get limited under their real
address instead of being refused, so the monitors above keep working, and local
development is untouched because no secret is configured there. This is the
same shape as `apps/web/lib/client-address.ts` and needs no plan upgrade.

**Revisit when** any of: the pilot opens to users outside a known set of
companies; a second API instance or a paid Render plan arrives for other
reasons; or auth audit events (3.5) land and show direct-to-API credential
traffic — which today would leave no trace at all, and is the reason 3.5 is the
item to do first if this one is ever reopened.

---

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
  - **Per-account must be progressive backoff (seconds→minutes), NOT a hard lockout.** A hard per-email lockout is itself a DoS vector — an attacker can deliberately lock a victim (including the platform owner) out by burning failed attempts against their email. Keep the per-IP limit hard; make the per-account control a growing delay that never fully denies the legitimate user. The earlier "progressive backoff / lockout" wording conflated the two — the choice is explicitly backoff.
  - **Counter storage:** `@nestjs/throttler` keeps counters in memory by default — they reset on every deploy and are not shared across instances. Acceptable while Render runs a single instance, but Redis is already in the stack, so wire `@nest-lab/throttler-storage-redis` (or equivalent) from the start rather than retrofitting it once a second instance appears.
  - Keep this independent of Turnstile — it is the always-on floor.
  - Requires `trust proxy` (item 3.3) for correct per-IP keying behind Render's proxy.
- **Verify:** New test asserting the Nth+1 rapid login attempt is rejected with 429; a test that repeated per-account failures add delay but never permanently deny; manual check that a valid login still succeeds after the window resets.

### 1.2 Turnstile: fail-closed on rejection, required in production
- **Risk (HIGH):** Captcha is the only brute-force control today, and it is a **silent no-op when `TURNSTILE_SECRET_KEY` is unset** — that misconfiguration is what carries the HIGH rating. Separately, it fails open on any non-2xx siteverify response (`src/modules/auth/turnstile.service.ts:36-77`). Note: the "attacker induces non-2xx by loading siteverify" framing is overstated — driving Cloudflare's global siteverify to failure is not a realistic vector. The fail-open path is worth fixing as hygiene, but the priority here is the no-op-without-secret case, not the induced-failure one.
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
- **Scope note — two distinct flows, only one is in this item:**
  - **(a) Authenticated change-password** — in scope here. Straightforward: verify current password, revoke other sessions.
  - **(b) Unauthenticated forgot/reset-via-email** — a *separate, security-sensitive* flow (reset-token issuance, single-use + short TTL, email-delivery dependency, its own enumeration/rate-limit surface). It is **not** covered by (a) and is **deliberately deferred to its own track** — do not fold it into this PR. Called out explicitly so "no self-service reset" isn't silently left half-addressed.
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
  - Set `app.set('case sensitive routing', true)` and `strict routing` — **but these must be applied before routes are registered**, i.e. on the underlying Express instance right after `NestFactory.create<NestExpressApplication>(...)` (via `app.set(...)` on the `NestExpressApplication`), not late in bootstrap. Set after route registration, they silently do nothing. The path-normalization fix above is the actual security control; treat the Express flags as defense-in-depth and verify they took effect.
  - Optionally add an `Origin`/`Sec-Fetch-Site` check as a second layer.
- **Verify:** Test that `/api/Platform/...` (mixed case) with a platform session now requires a CSRF token.

### 2.4 Backend length caps + explicit body limit (this PR) — global ValidationPipe/DTOs (separate track)
- **Risk (MEDIUM/LOW):** Most free-text fields have no backend length cap (all columns are unbounded `text`; only client-side `INPUT_LIMITS` guards them, trivially bypassed by calling the API directly). Separately, there is no global `ValidationPipe`/class-validator — mass-assignment safety rests on service discipline (`data: { tenantId, ...parsed }`, never `...body`).
- **Scope correction — do NOT ship a whitelist ValidationPipe in this item.** `new ValidationPipe({ whitelist: true })` strips every property not declared on a class-validator DTO. The codebase has **no DTOs** — `@Body()` handlers type against plain TypeScript interfaces. Enabling it globally would strip the *entire* request body on every DTO-less endpoint and break every controller at once. Making it safe means authoring class-validator DTOs for **all** modules simultaneously — that is the single largest item in this whole plan, larger than platform-MFA (1.3), and it is a refactor, not a security fix.
- **This item (small, ship now):**
  - Enforce backend length caps inside the existing `normalize*` helpers, mirroring `apps/web/lib/input-limits.ts` (keep the two in sync). The `normalize*` helpers already act as the anti-mass-assignment whitelist, so caps here close the real exposure (oversized rows / storage abuse) without any DTO work.
  - Set an explicit Express JSON body-size limit rather than relying on the accidental ~100 kB default.
- **Deferred to its own gradual track (or a conscious decision to skip):** the class-validator DTO migration + global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`. If pursued, do it module-by-module (add DTO → enable the pipe scoped to that controller), never as one global flip. Record explicitly whether this is being scheduled or intentionally declined.
- **Files:** the shared `normalize*` helpers, `src/main.ts` (body limit). (DTOs across `src/modules/*` + `package.json` only if/when the deferred track starts.)
- **Verify:** Test that an over-limit field is rejected and an oversized body is refused by the API.

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

### 3.2 Enforce upload size on presigned PUTs — **half done**
- **Risk (LOW/MEDIUM):** `s3-storage.client.ts:29-45` signs `contentType` + host but not `Content-Length`; the byte cap is validated only against the client-declared size at registration, so the actual PUT to R2 is uncapped.
- **Rated too low, because the write side is only half of it.** `downloadObject` buffers the whole object into memory and hands it to the transcription provider, so an upload that ignored its declared size was an out-of-memory kill on the API and an unbounded transcription bill, not merely wasted storage. **That half is done:** the cap is now one shared constant (`visits/visit-media-limits.ts`) applied both at registration and against the length the store reports on the read, before any of the body is read. `tests/storage-download-size-cap.test.ts` pins it.
- **Still open:** signing `Content-Length` (or a content-length-range POST policy) so R2 refuses the oversized PUT itself. Until then an oversized object can still land in the bucket and sit there until the cleanup worker's TTL collects it — it just can no longer be read back into the API. Doing it means making the declared size mandatory and exact, which is a client contract change (the field app's offline outbox re-uploads included), so it is its own piece of work rather than a line in a hardening batch.

### 3.3 Set `trust proxy`
- **Risk (LOW):** No `app.set('trust proxy', …)`; `request.ip` is the proxy address, degrading session forensics and undermining any IP-based rate limit (1.1).
- **Change:** Set `trust proxy` to the exact hop count; forward `x-forwarded-for` from the Next layer (`buildRequestHeaders`).

### 3.4 `__Host-` cookie prefix
- **Risk (LOW):** Session/CSRF cookies lack the `__Host-` prefix → cookie-tossing from a sibling subdomain.
- **Change:** Rename to `__Host-vizitum_session` / `__Host-vizitum_csrf` in production (requires `Secure`, `Path=/`, no `Domain` — all already true). Also drive the `secure` flag from an explicit `COOKIE_SECURE` env var rather than `NODE_ENV`.
- **Do not break the worktree dev scheme:** `SESSION_COOKIE_NAME` is a **per-slot env var** so parallel dev sessions on different ports don't clobber each other's cookies on `localhost` (see CLAUDE.md → worktree slots). The `__Host-` prefix requires `Secure`, which localhost HTTP dev cannot set, and a fixed prefixed name would also re-collide the slots. So apply `__Host-` **only in production** and keep the per-slot `SESSION_COOKIE_NAME` override intact for dev/worktrees — production hard-codes the prefixed name, non-production keeps reading the env var.

### 3.5 Auth audit events — **done**
- **Risk (LOW):** No audit record for login success/failure/logout on either domain, so the brute-force that 1.1 addresses can't be detected after the fact.
- **Shipped as** `auth.login_succeeded` / `auth.login_failed` / `auth.logged_out` (tenant, into `AuditEvent`) and `platform.login_succeeded` / `platform.login_failed` / `platform.logged_out` (platform, into `PlatformOperationEvent`), written by `src/modules/auth/auth-audit.service.ts`. The names use the underscore form the rest of the trail already uses (`password.reset_requested`), not the dotted `auth.login.success` this plan sketched.
- **Three decisions worth keeping on the record:**
  - **Failures record a reason** (`unknown_account`/`inactive_account`/`wrong_password`/`wrong_code`) and the address attempted. That is the distinction the login response deliberately refuses to make, and it is safe here only because nothing reads these rows back over the API — a read endpoint for them would need to weigh that again.
  - **Both failure paths write.** Auditing only the branch where the account exists would have put back, in the trail, the timing difference 3.1 exists to remove.
  - **The write is best-effort.** A failed audit write is logged as `auth_audit_write_failed` and swallowed: refusing to sign anyone in because the audit table is unavailable turns a degraded trail into an outage, and on the failure path it would answer a wrong password with a 500. The error log is what keeps a silently empty trail noticeable — an alert on it is the natural follow-up.
- **Where the alarm lives, and why not on the operations summary.** A
  swallowed write is the one failure nobody would notice — the symptom of a
  broken trail is an empty trail, which looks exactly like a quiet week. It is
  reported to Sentry (`errorCode=AUTH_AUDIT_WRITE_FAILED`) as well as logged,
  with an alert row in `docs/runbooks/production-alerts.md`. It is deliberately
  **not** a counter on `GET /operations/summary`: every counter there is a
  `count()` over rows carrying a failed status, and a write that never reached
  the database leaves no row to count. Counting it would mean writing the
  failure to the same database that just refused a write.
- **What this unblocks:** the accepted risk above ("the API is directly reachable, so per-IP keying is advisory") names this item as the one to do first if that decision is ever reopened, because direct-to-API credential traffic previously left no trace at all. It now leaves one.

### 3.6 Pin argon2 work factor + rehash-on-login
- **Risk (INFO):** `hash(password)` uses library defaults with no `needsRehash` path, so a dependency bump can silently change cost and existing users can never be upgraded.
- **Change:** Pin explicit argon2id parameters in a constant; on successful login, re-hash when `argon2.needsRehash(hash, options)`.

### 3.7 Dependency advisories — **done, as far as it goes**
- **Risk as originally written (LOW):** `npm audit` reports 5 high (postcss XSS/path-traversal, sharp/libvips CVEs), both transitive via `next@16`. Real exposure is low — the app avoids `next/image` (logos render via plain `<img>`) so no user bytes reach libvips at runtime, and postcss runs at build over first-party CSS only.
- **That assessment went stale before it was acted on.** By 2026-08-01 the count was 6 high and the composition had changed: `next@16.2.9` had picked up advisories **of its own**, not merely transitive ones, and `multer` had appeared via `@nestjs/platform-express`. Neither was covered by the "both transitive via next" reasoning above. Re-read `npm audit` rather than trusting a recorded verdict — it describes a moment, not a state.
- **Done:** `next` → `16.2.12` (patched from `16.2.11`) and `@nestjs/platform-express` → `11.1.28` (bringing `multer` `2.1.1` → `2.2.0`), plus `brace-expansion` in the lockfile. Both declared ranges were raised, not just the lock, so the vulnerable versions stop being resolvable at all. Of the Next advisories this closed, the one that actually applied here was **CVE-2026-64643** (Server Action / `use cache` endpoint ids disclosed through public client artifacts — a recon primitive; the app has 29 `"use server"` modules). The much louder **CVE-2026-64642** middleware/proxy bypass never applied: it needs `config.i18n.locales` with a single entry, and `next.config.ts` has no `i18n` block at all (App Router + next-intl). Worth knowing, since it would otherwise have bypassed `proxy.ts` — where item 2.1's CSP is set.
- **Still reported, and deliberately not fixed: 3 high.** `postcss` (3 advisories) and `sharp` (1), plus `next` itself flagged *only* for depending on them — its own `via` list is now empty. npm's sole offered remedy is downgrading to `next@9.3.3`, a breaking change to a release from 2020, so there is nothing to act on until Next bumps what it bundles. The original low-exposure reasoning still holds for these two: no `next/image` (verified — the only references are comments explaining why it is avoided), so no user bytes reach libvips, and postcss runs at build over first-party CSS.
- **How to check this is still true:** `npm audit --json` and look at `.vulnerabilities.next.via` — while it contains only `postcss` and `sharp`, Next carries no advisory of its own and the remaining three are the pinned-transitive pair. An entry that is an object rather than a string there means a new direct advisory and a real decision to make.

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
7. **PR 7 — Backend length caps + body limit** (2.4, the small in-scope half only).
8. **PR 8 — Session TTL/rotation** (2.5).
9. **PR 9 — Low-priority hardening batch** (3.1–3.8, split as convenient).

**Off this sequence (separate gradual tracks, scheduled or explicitly declined):**
- Class-validator DTO migration + global `ValidationPipe` (deferred half of 2.4) — module-by-module, the largest single effort in the plan.
- Unauthenticated forgot/reset-password-via-email flow (flow (b) of 2.2).

Keep `docs/reference/environment.md`, `permissions.md`, and `api-reference.md` updated in the same PRs where env vars, permissions, or endpoints change.
