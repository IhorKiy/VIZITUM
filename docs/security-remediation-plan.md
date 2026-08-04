# Security Remediation Plan

Status: waves 1, 2 and 3 implemented; 2.4's deferred DTO migration complete · Date: 2026-08-03 · Scope: NestJS API (`src/`) + Next.js web (`apps/web`)

## Implementation status

All three waves are done, and so is the class-validator DTO migration
deliberately deferred out of 2.4 — a refactor rather than a security fix, run
as its own six-tier track and recorded in the row at the foot of the table.
Nothing in this plan is open. Each item below is marked; the reference docs
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
| 1.3 Platform-owner hardening | Done for TOTP MFA and the shortened session TTL. Login alerting landed as 3.5; re-auth for destructive tenant operations is **done** — see the item below |
| 2.1 Security response headers | Done — verified live, including Turnstile under the CSP |
| 2.2 Password change + invite overwrite | Done, but **not by this branch**: PR #168 landed both halves — the authenticated change *and* the forgot-password flow the plan deferred — while this was open, so this branch dropped its duplicate change-password and kept only the invite-overwrite fix |
| 2.3 CSRF path normalization | Done, including the Express routing flags (applied before the router is built) |
| 2.4 Backend length caps + body limit | Done, both halves. The class-validator DTO migration ran as its own track and is now complete — last row of this table |
| 2.5 Session TTL, rotation and idle timeout | Done |
| 2.6 Raw invite tokens | Done |
| 3.1 Equalize login timing | Done — a dummy argon2 verify runs on the not-found/inactive path on both domains; see the item below |
| 3.2 Upload size | Done — the read side enforces the cap against the length the store reports, and the PUT itself now signs `Content-Length`. See the item below |
| 3.3 `trust proxy` | Done — `src/main.ts` sets it to the hop count read from `TRUST_PROXY_HOPS`, and the forwarded address comes from `CLIENT_IP_HEADER` rather than the raw chain. Both the `TRUST_PROXY_HOPS` deviation and the first follow-up below are about this item |
| 3.4 `__Host-` cookie prefix + `COOKIE_SECURE` | Done — see the item below |
| 3.5 Auth audit events | Done — login success/failure and logout on both domains, with the failure reason; see the item below |
| 3.6 Pin argon2 params + rehash-on-login | Done — see the item below |
| 3.7 Dependency advisories | Done — `next` → 16.3.0, `@nestjs/platform-express` → 11.1.28, and `npm run audit:check` gates CI on advisory id. As of 2026-08-04 nothing high or critical is open and the accepted list is empty. Re-read the item below rather than trusting this cell: the recorded verdict has been overtaken twice, once by advisories getting worse and once by them being fixed upstream |
| 3.8 Miscellaneous | Done — see the item below |
| 2.4 deferred half — class-validator DTO migration | **Done.** All 22 controllers taking a `@Body()` have migrated: `location-potential` (#204), `location-assortment` and `pilot-review` (#206), the whole flat-CRUD tier — `chains`, `location-categories`, `product-categories`, `products`, `announcements`, `tasks` (#217) and `locations` — and all of tier 3: `routes`, `route-templates`, then `visits`, whose eleven bodies were gated across two changes per [the design note](plans/visits-dto-migration-note.md); tier 4 — `admin-settings`, `admin-users`, `storage`, `platform`, `platform-tenant-superadmin`; tier 5 — `imports`, per [its design note](plans/imports-dto-migration-note.md); and tier 6 — `auth`, `password`, `platform-auth`. **There is still no global `ValidationPipe`, and that is now a decision rather than a pending step**: every gated route carries its own `@UsePipes(createStrictValidationPipe())`, which is visible at the handler a reader is already looking at, and a new controller written without one fails a `PIPES_METADATA` test rather than silently inheriting a whitelist no DTO was written for. See 2.4's own item below for what each tier found |

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

Wave 3 was tracked here as a running note while it was still in flight; by the
time it closed, the note named two things worth recording as history instead.
The 3.7 warning it carried — that `next` had picked up advisories of its own
beyond the transitive `postcss`/`sharp` ones, and that `multer` had appeared
via `@nestjs/platform-express` — was acted on and folded into 3.7's own entry
below (`next` → 16.2.12, `@nestjs/platform-express` → 11.1.28, and the
`audit:check` CI gate that now catches the next drift of this kind on its
own). And 1.3's re-auth for destructive tenant operations, noted here as done,
is recorded in 1.3's own row and item.

### Found outside this plan: the `[tenantSlug]` segment was unconstrained

Two of the findings above shared a root the review only noticed afterwards.
Nothing checked the shape of the tenant slug in a URL, and what gets served
under it is decided by the session cookie rather than by the slug — so any
string at all rendered the real, authenticated app. That is what made
`/acme.x/field` a page without a Content-Security-Policy, and it is what let a
crafted segment reach the `redirect()` targets pages build from it.

Fixing the proxy matcher closed the common case but not the whole shape: a
path whose last segment ends in a known extension (`/team.html`) is still
skipped, and a matcher cannot tell that apart from `sw.js`. The second line is
`apps/web/app/[tenantSlug]/layout.tsx`, which now answers `notFound()` for
anything that is not slug-shaped, so those paths render a 404 rather than the
app. `tests/web-tenant-slug-shape.test.ts` pins it.

Worth noting for the redirect half: the phishing value came from a victim
opening a crafted link, seeing a real login screen and being bounced
cross-origin on submit. With the page 404ing there is no screen and no form,
so the chain breaks at the first step.
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

### Found outside this plan: four smaller gaps, all closed

Recorded together because none is individually interesting and the pattern
across them is: a control that was applied on one path and not on its twin.

- **`/health/readiness` answered the hardening question anonymously.**
  `proxyResolution` was operator-gated from the start, with a comment calling
  the hop numbers a forgery recipe; `trustProxyHops`, `captchaEnabled` and
  `rateLimitEnabled` sat outside the gate saying half the same thing and
  naming the moment credential stuffing is unopposed. The whole
  `authHardening` block is now operator-only.
- **The import path bypassed the 2.4 length caps.** `POST /locations` stops a
  name at 120 characters; the same column reached through an import was
  bounded only by the 100 kB body limit. Caps are now declared on the template
  columns and enforced in one generic validation pass, so a new template gets
  them by declaring them.
- **Import confirm was a TOCTOU.** The status check ran outside the
  transaction that applies the rows, so two confirms of one job both applied
  it. Now claimed with a conditional update inside the transaction.
- **Creatorless visit artifacts were readable by any representative.** The
  *write* path had already been fixed to stop treating "no creator" as
  "unowned, so yours" — the AI worker writes `temporary_transcript` rows with
  no creator — and the read path was left as it was. It is now the mirror of
  the write path.
- **`EMAIL_PROVIDER=console` was not refused in production.** That driver
  writes every email, including one-time invite and reset tokens, to the
  application log; its own comment says never to deploy it, which is not a
  place a deploy looks. `security-config.ts` now refuses it, alongside the
  controls it already guards.

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
reasons; or the sign-in trail shows direct-to-API credential traffic.

**That last condition is now measurable, and was not when it was written.**
3.5 shipped recording who and why, but nothing about where a request came
from — so "show direct-to-API traffic" had nothing to read. Sign-in events now
carry `ipHash` (SHA-256 of the resolved address, matching `sessions.ipHash` so
the two join) and `forwardedHopCount`. Traffic through the web layer arrives
with a characteristic chain length — that layer forwards exactly one entry and
the edges in front of the API append theirs — so failures clustering at a
count the web layer cannot produce are the signal. `npm run auth:trail` prints
the split; it reports counts only, never an address or a hash.

Both fields are attacker-influenced — a caller can pad the chain — so this is
evidence, not proof, and deliberately so: the question the plan asks is
whether such traffic *exists*, not whether it can be blocked. Someone
imitating the web layer's shape will not stand out, and closing that needs the
shared-secret header described above.

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
  - Shorten the platform session TTL (hours, not 30 days) and require re-auth for destructive tenant operations (pairs with 2.4). **Both done.** Re-auth applies to `POST /platform/tenants/:tenantId/purge` — the one action that ends in data being gone. It reuses the login step's `acceptTotpCode`, so the code is spent and cannot be replayed, and it is the *last* gate: every refusal decidable without a code happens first, or a mistyped slug would cost the owner a code and a thirty-second wait. A refused code earns the same per-account backoff and audit row the login code step does — review caught that the first version had neither, which would have left a stolen session free to guess codes at a destructive endpoint under nothing but the global per-IP throttle, invisibly to 3.5. The route also carries its own 5/min throttle. Archive is deliberately not gated — it is reversible by unarchive, and a confirmation nobody can act on quickly stops being read.
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
- **Deferred to its own gradual track:** the class-validator DTO migration + global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`. Pursued module-by-module (add DTO → enable the pipe scoped to that controller), never as one global flip.
- **Decision, 2026-08-03: scheduled, not declined.** Starts with `LocationPotentialController` (`PUT /locations/:locationId/potential/:productCategoryId`) rather than `auth` — the smallest controller surface that still has a real length-capped field to migrate, and one where a whitelist/DTO mismatch costs a sales-potential edit rather than every session in the tenant. See [api-reference.md](reference/api-reference.md) for the shipped shape.
- **Order for the rest of `src/modules/*`, by ascending blast radius.** Ported here from #204 so it is not read out of a merged PR description. The tiers are the point; the sequence within a tier is not. All 22 controllers taking a `@Body()` appear exactly once.
  1. **Single `@Body()` route, no session surface — done.** `location-potential` (#204), `location-assortment` and `pilot-review` (#206). One route each and nothing auth-critical: enough to prove `createStrictValidationPipe()` generalizes before anything expensive depends on it.
  2. **Flat CRUD — done.** `chains`, `location-categories`, `product-categories`, `products`, `announcements`, `tasks` shipped together (#217); `locations` (six `@Body()` routes against those twelve, across three resources, and the module the two category vocabularies and chains all hang off) followed as its own change. More fields per DTO, still no nesting and no auth surface. Three things this tier taught, all now in [api-reference.md](reference/api-reference.md): a cap declared on the DTO reports an over-length value *as* over-length, where several normalizers folded it into the same answer as a missing one; an enum-ish field the service did not recognise was being coerced rather than refused — worst on `PATCH /tasks`, where an unrecognised status was read as `in_progress`, so a typo reopened a finished task under a 200; and, from `locations`, a value of the wrong *type* meant "clear this field" rather than "ignore it", because on a PATCH the field is present — `{"chainId": 0}` unlinked a location's chain and `{"email": 42}` erased a contact's email, both with a 200. All three are silent wrong writes, which is the class of defect this track is worth doing for, quite apart from mass assignment.
  3. **Nested or opaque bodies:** `routes`, `route-templates`, then `visits`. The first two shipped together — thirteen write routes, twelve DTO classes — and **the premise of this tier's name turned out to be wrong for them.** Route items do arrive as arrays, but of *ids*: an item is created one request at a time, and `itemIds` on the two reorder routes is the only array on either controller. So neither needed `@ValidateNested`/`@Type`, just `@IsString({ each: true })`, and the tier was no harder than tier 2. What it did surface is the same wrong-type-clears-the-field shape `locations` found (a non-string `skipReason` cleared it) and the same dropped-enum shape (a plan or item status outside the recognised set, and a non-integer `sequence`, were nulled and spread away under a 200). It also turned up a defect *behind* the gate rather than in front of it, which is worth recording as the track's first of that kind: `parseDateOnly` checked only `Number.isNaN`, and an out-of-range day rolls over instead of producing NaN, so `POST /routes {"planDate": "2026-02-31"}` answered 201 for a plan quietly filed on March 3rd. Its own comment already claimed the calendar check, and both sibling implementations (`location-insights-parsing.ts`, `visits/shelf-check.ts`) had it — this one was the odd one out, and drawing the shape/semantics line explicitly for the DTO is what made the missing half visible. Generalizable: writing down which layer owns which half of a check is itself a way of finding a half nobody owns. The opaque-body concern was always really about `visits`, which is where it now sits alone. It goes last of the three and is the hardest thing in this track: eleven `@Body()` routes, the field app's entire reporting path (a false rejection is a rep who cannot file a visit), and `confirmedData` — the structured report whose shape is the AI extraction schema rather than a field list, so a whitelist cannot reach inside it without duplicating that schema. **The design note this asked for is written, and `visits` has since shipped in the two halves it proposed: [visits-dto-migration-note.md](plans/visits-dto-migration-note.md).** Its answer on `confirmedData` is to gate the envelope and leave the payload opaque, and the deciding argument is not the duplication this plan predicted — it is that `apps/web/lib/report-outbox.ts` stores a queued confirm on the rep's device and replays it after a deploy, never retrying one the server refused. A whitelist that rejects a payload an older build produced therefore destroys a finished report rather than merely refusing a request, which is a worse failure than the one this row warns about. Its two upload-registration routes also carry the `sizeBytes` that 3.2 made *mandatory*: a DTO that fails to declare it makes the presigned PUT unsignable.
  4. **Administrative surfaces — done.** `admin-settings`, `admin-users`, `storage`, `platform`, `platform-tenant-superadmin` shipped together: thirteen write routes, twelve DTO classes. A mismatch costs an admin action rather than a tenant's sessions, and the tier found the same two shapes the earlier ones did — a dropped enum (`PATCH /admin/users/:userId` nulled an unrecognised `status` and wrote nothing, so a typo left a suspended admin active under a 200) and a cap folded into a "required" message (the tenant `name`, both name parts). One new variant, worth recording because a filter is quieter than a coercion: `normalizeRoleCodes` *filtered* unrecognised entries out of an array rather than refusing it, so `["field_representative", "compny_admin"]` invited someone with fewer roles than the admin asked for — an array of nothing but typos did surface, which is why the mixed case survived. **Two decisions here are the reusable ones.** First, `@IsOptional()` was wrong for the platform tenant bodies: it admits `null`, and `platform.service.ts` reads a present field as a string, so `{"name": null}` was a 500 rather than a clear — those fields use `@ValidateIf(value !== undefined)` and only `primaryDomain`/`adminLimit`, where `null` genuinely clears something, keep `@IsOptional()`. Second, and the one tier 6 should start from: **`mfaCode` on `POST /platform/tenants/:tenantId/purge` carries `@Allow()` and no type check at all.** A pipe runs before the service, and the service is what charges the shared `platform-login` backoff and records the `platform.reauth_failed` audit event — so an `@IsString()` there would have turned `{"mfaCode": 123456}` into an unlogged, unpenalized 400 while buying nothing (`verifyTotpCode` already takes `unknown`). That is exactly the trap this plan flags for the login routes, met one tier early: **on any route whose refusal is itself a recorded security event, the DTO must not be the layer that refuses.**
  5. **`imports` — done.** Deliberately late: `csvText` is a large, intentionally loose body (bounded only by the JSON body limit), and `templateType`/`fileName` are the only fields that fit a DTO cleanly. **The design note this asked for is written: [imports-dto-migration-note.md](plans/imports-dto-migration-note.md)**, and its answer rhymes with the `visits` one — gate the envelope, leave the blob opaque — while reaching it by a completely different route, which is why it was worth writing rather than citing. `confirmedData` is an *object*, so declaring its properties was at least conceivable and the decision turned on offline replay; `csvText` is a *scalar*, so there is nothing for a whitelist to walk and the only choice is whether to declare the field. The genuinely useful part of the note is Q2, the honest statement of what the gate does **not** buy: everything that actually defends an import sits behind the pipe — `assertApprovedHeader` refusing any CSV column the template does not declare (the real anti-mass-assignment control on this path; a column is what could otherwise smuggle a field), the per-column `TEXT_LIMITS` caps, the formula guard, the per-template row validators, and the fact that this route only produces a *preview* with nothing written until the body-less confirm. `templateType` is gated because it is the discriminator selecting both of the first two; `fileName` is deliberately uncapped, because `parseFileName` truncates at 255 by design and a cap would invent a refusal rather than surface one. Worth generalizing: **where a service deliberately tolerates a value, the DTO must not be the layer that stops tolerating it** — the same rule that kept `phone` uncapped in `locations` and `admin-users`.
  6. **`auth`, `password`, `platform-auth` — done, and the track is closed with them.** These were the ones this repo could least afford a false rejection on: a whitelist mismatch on `/auth/login`, `/auth/password/*` or the platform login's TOTP step is a lockout, not a bug report. **So this tier's DTOs do the least of any on the track: they declare which properties may exist and the type of each, and make no other judgement** — no length cap on a password or a token, no `@IsIn` on a role or a zone. Three reasons, one per shape of route, and each is a rule worth keeping: a refusal that is *deliberately uniform* (`INVALID_CREDENTIALS` answers a missing account, an inactive one and a wrong password alike — 3.1 equalized even the timing) must not gain a second kind of answer; a refusal that is *deliberately non-enumerating* (`forgot` acknowledges everything) must not gain a distinguishable one; and a refusal that is *recorded* must not move in front of the layer that records it. The last is why `platform-auth`'s two code steps validate nothing at all (`@Allow()`): `claimChallengeAudited` audits every claim it cannot honour, malformed included, and a wrong code is charged to the shared backoff — so `@IsString()` would have made `{"code": 123456}`, the shape a naive scripted guess produces, the one attempt that leaves no trace. The single exception across all ten routes is `firstName`/`lastName` on the invite acceptance, ordinary profile text that gets the track's usual caps-moved-earlier correction.

     **The ordering question this plan asked to settle, settled by measurement rather than reading.** Nest runs guards before pipes, so the per-IP throttle charges for a body the DTO refuses — ten malformed platform logins in a row answer `400 × 9` then `429`. And a refused body cannot become an unlogged login attempt, because `AuthService.login` already refuses the same class of body (missing, blank or non-string credentials) *before* the captcha, the backoff and `recordTenantLoginFailed`: a malformed login has never been a recorded attempt, so the DTO changes only the status code, and only for a body no client sends. An empty string is not such a body — it is what a blank form posts, `@IsString()` accepts it, and it still comes back `INVALID_CREDENTIALS`.

     **One defect found by the tracing this tier required**, of the same family as the follow-up below: `PlatformAuthService.login` read its password as `typeof body.password === "string" ? body.password : ""` and applied **no length cap**, though the tenant login's `normalizePassword` does and says why — argon2 hashes whatever it is given, so an unbounded password is an unbounded amount of work per request, spent before any account is known. Fixed to the same `TEXT_LIMITS.password` bound. That is the third copy of this helper to drift from the original, which is the argument for the shared modules this track kept creating.
- **Files:** the shared `normalize*` helpers, `src/main.ts` (body limit). (DTOs across `src/modules/*` + `package.json` land module-by-module as the deferred track proceeds, per the decision above.)
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

### 3.1 Equalize login timing (user enumeration) — **done**
- **Risk (LOW):** Argon2 ran only when the user existed, so response timing distinguished a valid email/tenant from an invalid one (`auth.service.ts`, `platform-auth.service.ts`).
- **Shipped:** the not-found branch on both domains (`!user`, an inactive user, and — tenant-side only — a user with no `passwordHash` set) now runs one argon2 verify against `DUMMY_PASSWORD_HASH`, a hash of an arbitrary unused password precomputed once and committed as a literal in `password.service.ts`, before penalizing and auditing exactly as the wrong-password branch already did. A literal rather than a hash computed at boot or per request: it costs nothing at startup and cannot vary between processes, so the not-found path's cost is identical everywhere it runs. `tests/auth-login-timing-equalization.test.ts` pins the structural property — exactly one `verifyPassword` call per login attempt, against the fixed hash when there is no real account to check and the account's own hash when there is — rather than measuring wall-clock time, which would be flaky and would not pin the actual guarantee.
- **Deliberately not done:** the plan's secondary suggestion of a generic error for unknown tenant slugs on the login route. That is a different enumeration surface (the tenant-resolution step, ahead of the user lookup) and a larger behavior change than a timing fix; left for its own review if the tenant-slug case is ever prioritized.
- **Left alone on purpose:** `password-reset.service.ts`'s forgot-password flow already avoids this class of leak differently — the response never depends on whether the address matched, since the reset email is sent out-of-band — so it needed no change here.
- **Found in review, coupled to 3.6:** `DUMMY_PASSWORD_HASH` was originally generated under argon2's library defaults, and 3.6 separately pinned `PASSWORD_HASH_OPTIONS` to a cheaper profile. Landed as two independent PRs off the same base, each was internally consistent and each passed its own tests — but combined, a real account's wrong password would verify under the cheaper pinned profile while the not-found path still paid the (more expensive, differently-shaped) default-profile cost, reopening the exact gap this item exists to close with the sign flipped. Neither PR's own tests could have caught it: each checks its own hash structurally (which hash was passed), not the other's cost. Fixed by regenerating `DUMMY_PASSWORD_HASH` under `PASSWORD_HASH_OPTIONS` and adding a test (`tests/password-service.test.ts`) asserting `needsRehash(DUMMY_PASSWORD_HASH, PASSWORD_HASH_OPTIONS) === false`, so the two can't drift apart again without a failing build. Worth generalizing: two independently-correct changes to the same cost parameter, reviewed apart, are not the same claim as one correct combined change — review them together whenever a security fix's cost has to match another one's.

### 3.2 Enforce upload size on presigned PUTs — **done**
- **Risk (LOW/MEDIUM):** `s3-storage.client.ts:29-45` signed `contentType` + host but not `Content-Length`; the byte cap was validated only against the client-declared size at registration, so the actual PUT to R2 was uncapped.
- **Rated too low at the time, because the write side was only half of it.** `downloadObject` buffers the whole object into memory and hands it to the transcription provider, so an upload that ignored its declared size was an out-of-memory kill on the API and an unbounded transcription bill, not merely wasted storage. **That half landed first:** the cap is one shared constant (`visits/visit-media-limits.ts`) applied both at registration and against the length the store reports on the read, before any of the body is read. `tests/storage-download-size-cap.test.ts` pins it.
- **The remaining half, shipped separately (own PR, since it changes the client contract):** `createPresignedObjectUrl` now signs `Content-Length` for a PUT (`s3-storage.client.ts`), so R2 itself refuses a body of any other length. This required making the declared size **mandatory**, not merely capped, at every registration path (`registerTemporaryAudioUpload`, `registerProblemPhotoUpload`, `registerLogoUpload`) — a missing `sizeBytes` is now refused the same way an invalid one already was, since a size that was never declared can't be signed. `StorageService.createPresignedUploadUrl` refuses to sign an object that somehow has none (`400 STORAGE_OBJECT_SIZE_UNKNOWN`) rather than silently falling back to an unsigned PUT — reachable only for an object registered before this requirement existed, not for anything registered going forward.
- **Not returned to the client.** `Content-Length` is signed but stripped from the `headers` object the caller receives (`omitBrowserManagedHeaders`, alongside `Host`) — a browser's fetch/XHR computes both from the request itself (the URL's origin, and the actual body length) and won't let a caller override either. The signature holds as long as the browser's own computed value matches what was signed, which is exactly the property being enforced: the client doesn't set anything new, it just has to PUT the exact bytes it declared.
- **Verified the field app's retry path needed no change.** `apps/web`'s resend/retry flow (`createStorageObjectUploadUrl` → `POST /storage/objects/:id/upload-url`) re-signs the PUT for an *already-registered* object rather than registering again, reusing the `sizeBytes` stored at the original registration — and the retry always re-sends the same captured `Blob`/`File` (`field-visit-report-form.tsx` keeps it in `pendingAudio`/equivalent state for exactly this), so the byte length signed at registration always matches what the retry actually sends.
- **Verify:** `tests/storage-signed-url.test.ts` (Content-Length is signed when declared, absent when not), `tests/storage-service.test.ts` (the size is read from the object and passed through; an object with no size is refused), and the three registration test files (`tests/visit-audio-upload-registration.test.ts`, `tests/visit-problem-photo-registration.test.ts`, `tests/branding-logo-upload.test.ts`) each pin the missing-size rejection at their own registration path.

### 3.3 Set `trust proxy` — **done**
- **Risk (LOW):** No `app.set('trust proxy', …)`; `request.ip` is the proxy address, degrading session forensics and undermining any IP-based rate limit (1.1).
- **Shipped:** `src/main.ts` sets `trust proxy` to the hop count `resolveTrustProxyHops()` reads from `TRUST_PROXY_HOPS` (`src/common/trust-proxy.ts`), on the Express instance the adapter is built from. A count and never `true`: `true` trusts the whole chain, and since a client can send `X-Forwarded-For` itself, that lets anyone pick the address they are limited under — worse than not trusting it at all. There is no production default and the process refuses to start without one; measure each environment with the readiness diagnostic rather than deriving it, per the deviation at the top of this file.
- **The plan's second half was rewritten in the doing.** It said to forward `x-forwarded-for` from the Next layer, which is exactly the caller-controlled entry the follow-up above found to be resting on the host rather than on the code. The address now comes from the header named per deployment by `CLIENT_IP_HEADER` (`apps/web/lib/client-address.ts`), with nothing forwarded at all when that header is absent. `tests/trust-proxy-resolution.test.ts` and `tests/web-client-address.test.ts` pin the two halves.

### 3.4 `__Host-` cookie prefix — **done**
- **Risk (LOW):** Session/CSRF cookies lacked the `__Host-` prefix → cookie-tossing from a sibling subdomain. Separately, the `Secure` flag was inferred from `NODE_ENV` rather than set explicitly — and production had at one point run with `NODE_ENV` unset, which silently sent the session cookie without `Secure` and nothing noticed.
- **Shipped:** `src/common/cookie-naming.ts`'s `resolveCookieName` is shared by both domains' constants (`auth.constants.ts`, `platform-auth.constants.ts`) so the rule can't drift between them — production always returns `__Host-`-prefixed names (`__Host-vizitum_session`, `__Host-vizitum_csrf`, `__Host-vizitum_platform_session`, `__Host-vizitum_platform_csrf`); outside production it returns the plain name, or a dev override where one is given. The `secure` flag on `COOKIE_OPTIONS`/`CSRF_COOKIE_OPTIONS` now reads a new `COOKIE_SECURE` env var instead of `NODE_ENV`, and `COOKIE_SECURE` is added to `security-config.ts`'s production-required list — an unset or non-`"true"` value now refuses to start rather than repeating the silent-no-`Secure` incident. `tests/cookie-naming.test.ts` and `tests/security-config.test.ts` pin both.
- **The two twins, resolved:**
  1. **Cookie names hardcoded in both the backend and `apps/web`.** `apps/web/lib/api-client.ts` cannot import `src/common/cookie-naming.ts` (separate workspace), so it carries a duplicated copy of the same function and computes the same four names the same way. This matters concretely: `session-actions.ts`'s `logoutAction` and `platform/tenants/page.tsx`'s sign-out both clear cookies by name directly rather than trusting the API's `Set-Cookie` response (deliberately — see their own comments), so a name computed differently on the two sides would leave a stale, revoked-but-still-present cookie in the browser after a production `__Host-` rollout.
  2. **The per-slot `SESSION_COOKIE_NAME` dev var was dead.** Chose to wire it up (option (a) in the prompt) rather than document it as permanently dead: `auth.constants.ts` now reads `process.env.SESSION_COOKIE_NAME` outside production, and `apps/web/lib/api-client.ts` reads the *same-named* variable from its own environment (server actions run in a separate process from the API, so it can't read the API's copy) — both must be set to the same value for a given worktree slot. `docs/reference/environment.md` and `CLAUDE.md` → worktree slots are updated accordingly; existing `wt-N` slots' `apps/web/.env.local` files pick up the variable the next time someone sets it there (not touched by this change, to avoid clobbering another session's in-flight worktree). The CSRF cookie names get no equivalent override, matching today's reality that no slot varies them.

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

### 3.6 Pin argon2 work factor + rehash-on-login — **done**
- **Risk (INFO):** `hash(password)` used library defaults with no `needsRehash` path, so a dependency bump could silently change cost and existing users could never be upgraded.
- **Shipped:** `PASSWORD_HASH_OPTIONS` in `password.service.ts` pins `type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1` — OWASP's own low-memory Argon2id profile, chosen deliberately over the library defaults (`memoryCost: 65536, timeCost: 3, parallelism: 4`) for what production actually runs on: Render's free tier, 512 MB RAM and 0.1 CPU shared across the whole process. Parallelism above 1 buys nothing without real spare cores — on a tenth of one core the lanes just take turns — and memoryCost is charged per concurrent hash, so the default's 64 MiB leaves little of 512 MB once more than a couple of logins overlap. Measured locally (not representative of the Render instance, but directionally telling): the pinned profile hashed in ~22ms against ~34ms for the library default in this environment — cheaper *and* lighter, not merely safer for memory.
- **Rehash-on-login:** `PasswordService.rehashIfNeeded(currentHash, password)` returns a fresh hash when `needsRehash` flags the stored one, `null` otherwise. Both `AuthService.login` and `PlatformAuthService.login` call it immediately once the password itself verifies — for the tenant login this is folded into the existing `lastLoginAt` update (one write, not two); for the platform login it runs right after `clearFailures`, independent of whatever the MFA step decides next, since the password was already proven correct at that point and rehashing doesn't grant anything by itself. `tests/password-service.test.ts` pins the hashing/rehash logic directly (including the encoded parameter string); `tests/auth-password-rehash.test.ts` pins that both login paths persist the rehashed value.

### 3.7 Dependency advisories — **done, as far as it goes**
- **Risk as originally written (LOW):** `npm audit` reports 5 high (postcss XSS/path-traversal, sharp/libvips CVEs), both transitive via `next@16`. Real exposure is low — the app avoids `next/image` (logos render via plain `<img>`) so no user bytes reach libvips at runtime, and postcss runs at build over first-party CSS only.
- **That assessment went stale before it was acted on.** By 2026-08-01 the count was 6 high and the composition had changed: `next@16.2.9` had picked up advisories **of its own**, not merely transitive ones, and `multer` had appeared via `@nestjs/platform-express`. Neither was covered by the "both transitive via next" reasoning above. Re-read `npm audit` rather than trusting a recorded verdict — it describes a moment, not a state.
- **Done:** `next` → `16.2.12` (patched from `16.2.11`) and `@nestjs/platform-express` → `11.1.28` (bringing `multer` `2.1.1` → `2.2.0`), plus `brace-expansion` in the lockfile. Both declared ranges were raised, not just the lock, so the vulnerable versions stop being resolvable at all. Of the Next advisories this closed, the one that actually applied here was **CVE-2026-64643** (Server Action / `use cache` endpoint ids disclosed through public client artifacts — a recon primitive; the app has 29 `"use server"` modules). The much louder **CVE-2026-64642** middleware/proxy bypass never applied: it needs `config.i18n.locales` with a single entry, and `next.config.ts` has no `i18n` block at all (App Router + next-intl). Worth knowing, since it would otherwise have bypassed `proxy.ts` — where item 2.1's CSP is set.
- **Was: still reported, and deliberately not fixed — 3 high.** `postcss` (3 advisories) and `sharp` (1), plus `next` itself flagged *only* for depending on them. npm's sole offered remedy was downgrading to `next@9.3.3`, a breaking change to a release from 2020, so there was nothing to act on until Next bumped what it bundles. The low-exposure reasoning that made waiting acceptable: no `next/image` (verified — the only references are comments explaining why it is avoided), so no user bytes reach libvips, and postcss runs at build over first-party CSS.
- **Now closed, 2026-08-04 — 0 high, and the accepted list is empty.** Next bumped what it bundles. `next` `16.2.12` → `16.3.0` brings `postcss` `8.4.31` → `8.5.23` and `sharp` `0.34.5` → `0.35.3`, which clears all four of the above; `fast-uri` `3.1.4` → `3.1.5` (under the `prisma` CLI, via `ajv`) clears a fifth that surfaced the same week. Every one was in-range of a declared `^` version, so this is `package-lock.json` only — no `package.json` edit, no `--force`, nothing resolved outside the ranges already reviewed. What made this land as its own change rather than riding along on whatever PR happened to go red: the gate is time-based, so it turns a green `main` red with no commit involved, and the fix is a framework minor that deserves its own build and full e2e run.
- **The reason to re-read rather than trust this entry.** Twice now the recorded verdict has been overtaken — once by advisories getting *worse* (the 2026-08-01 bullet above), once by them getting fixed upstream. "No fix short of downgrading next" was true when written and false four weeks later, and nothing announces that transition; `npm audit fix --dry-run` reporting an *upgrade* rather than a downgrade is what surfaced it. The accepted list being empty today is likewise a moment, not a state.
- **How to check this is still true: CI does it now.** `npm run audit:check` (`scripts/audit-check.mjs`, wired into Backend Checks) fails on any high or critical advisory that is not on an explicit accepted list, keyed on advisory id rather than package name — so while postcss was accepted for three findings, a *fourth* still blocked, which is exactly what happened on 2026-08-04 and is what prompted the upgrade above. `next` is accepted only while its `via` contains nothing but package names; an object there means it carries a finding of its own, which is the exact tripwire this bullet used to describe in prose. A bare `npm audit --audit-level=high` was rejected as the gate: it goes red for advisories with no fix — four sat open for two days short of a month — and a permanently red check is one nobody reads. That reasoning holds even now the list is empty, since the next unfixable advisory restores the condition. The script also names any accepted entry that has stopped matching, which is how the four were found to be retirable rather than left as furniture. `tests/audit-allowlist.test.ts` pins the accept/block rules, against its own fixtures rather than the live list — pointing at real accepted ids made the suite depend on the app *having* open advisories, and three of its cases failed the moment the list emptied.

### 3.8 Miscellaneous — **done**
- **(a) Hand-rolled cookie parsing.** `readCookieToken` (`src/common/cookie-token.ts`) now parses via the `cookie` package's `parse()` instead of a manual `split(";")`/`decodeURIComponent`. Pinned to the `^0.7` line already resolved transitively via Express in this tree, rather than the newer `cookie@2.x` line, which requires Node ≥22 — nothing in this repo commits to a minimum Node version, so taking on that constraint for a parsing-hygiene change wasn't worth the risk. This wasn't purely cosmetic: the hand-rolled version called `decodeURIComponent` directly, so a cookie value with a stray, malformed percent-encoding (`%` not followed by two hex digits) threw an uncaught `URIError` out of every session/CSRF cookie read on the request. `cookie`'s `parse()` catches that and falls back to the raw value. `tests/cookie-token.test.ts` pins both the parsing behavior and that specific crash fix. `writeCookieToken`/`clearCookieToken` were already going through Express's own `response.cookie()`/`clearCookie()` (which use `cookie` internally already) and needed no change.
- **(b) Session resolution called inline four times in `auth.service.ts`.** Evaluated routing through `PermissionGuard` as the plan suggested and rejected it: the guard resolves whichever of a platform session, tenant session or operations bearer token is present and builds a full `RequestContext` (tenant + user + role lookup) to answer a permission check, while `getCurrentUser`/`switchRole`/`switchZone` already know they want the tenant session specifically and each has its own different follow-up query — routing through the guard would mean building a `RequestContext` none of them use, to reach the one field they actually need. Extracted a private `requireActiveSession(request)` instead, used by those three (which shared the exact same "read token, throw if missing; look up session, throw if missing" shape). `logout` — the fourth call site — was deliberately left as its own inline call: it doesn't throw on a missing token/session (sign-out is meant to succeed either way) and uses the raw token to revoke regardless of whether a session was found, a genuinely different shape that forcing into the same helper would have obscured rather than simplified. Pure refactor, no behavior change; the full existing suite (which already covers the missing-token/invalid-session paths for all three methods through their public API) passes unchanged.
- **(c) Server-side email format validation.** The plan's own text was stale here: `isValidEmail` already existed (`src/common/normalize.ts`) and was already used for tenant contact email (`platform.service.ts`). Two real gaps closed instead: location contact create/update (`locations.service.ts`) validated only length, not shape — fixed with a `normalizeContactEmail` helper mirroring the existing phone field's shape exactly, including passing an *unchanged* email through without re-validation on update, so a contact whose stored email predates this check stays editable. And `imports.service.ts` carried its own byte-for-byte duplicate of `isValidEmail` instead of importing the shared one — replaced with the import; behavior is identical since the regex was identical, confirmed by the existing `EMAIL_INVALID` test passing unchanged. `tests/location-contact-email.test.ts` pins the new location-contact behavior.

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

**Off this sequence (separate gradual track):**
- Class-validator DTO migration + global `ValidationPipe` (deferred half of 2.4) — module-by-module, the largest single effort in the plan. See 2.4's own item for the scheduling decision and the tiered order for the remaining controllers, and the last row of the status table for where it has got to.

Keep `docs/reference/environment.md`, `permissions.md`, and `api-reference.md` updated in the same PRs where env vars, permissions, or endpoints change.
