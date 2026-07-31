// Rate-limit policy for the API, in one place so the numbers are reviewable
// without reading the guards that apply them.
//
// Two independent controls guard the credential endpoints, and they are
// deliberately different in kind:
//
//   * The per-IP throttle (this file's `*_THROTTLE` entries, enforced by
//     ApiThrottlerGuard) is HARD — past the limit the request is refused with
//     429. It bounds how fast one source can pump credentials at us.
//   * The per-account control (LOGIN_BACKOFF, enforced by LoginBackoffService)
//     is a growing DELAY that never refuses. A hard per-email lockout would
//     itself be a denial-of-service vector: anyone who knows an address —
//     including the platform owner's — could lock its owner out by burning
//     failed attempts against it. A delay slows a guesser without ever
//     stranding the real user.
//
// Correct per-IP keying depends on `trust proxy` being set (see
// resolveTrustProxy below); behind a proxy without it every request keys on
// the proxy's own address and the whole world shares one bucket.

export type ThrottlePolicy = {
  limit: number;
  ttlSeconds: number;
};

// Permissive catch-all so a single client cannot hammer arbitrary endpoints.
// Sized well above what any real screen produces (the heaviest page issues a
// handful of requests) but far below what a scripted loop does.
export const GLOBAL_THROTTLE: ThrottlePolicy = {
  limit: 300,
  ttlSeconds: 60,
};

// Tenant login. Generous enough for an office behind one NAT address — a
// shared egress IP is the normal case, not the attack case — while still
// capping a scripted attempt at ~2 tries/second sustained.
export const LOGIN_THROTTLE: ThrottlePolicy = {
  limit: 30,
  ttlSeconds: 60,
};

// Platform login is tighter: exactly one account exists, it controls every
// tenant's data, and no legitimate flow logs into it repeatedly.
export const PLATFORM_LOGIN_THROTTLE: ThrottlePolicy = {
  limit: 10,
  ttlSeconds: 60,
};

// Invite acceptance takes a 32-byte token, so guessing is hopeless anyway;
// the cap exists to stop the endpoint being used as a free argon2 oracle.
export const INVITE_ACCEPT_THROTTLE: ThrottlePolicy = {
  limit: 20,
  ttlSeconds: 60,
};

// Changing a password verifies the current one, so it is a credential
// endpoint too — bound it even though the caller is already authenticated.
export const PASSWORD_CHANGE_THROTTLE: ThrottlePolicy = {
  limit: 10,
  ttlSeconds: 60,
};

export const LOGIN_BACKOFF = {
  // The first few failures cost nothing: typos are ordinary.
  freeAttempts: 3,
  // Delay doubles per failure past the free ones: 1s, 2s, 4s, 8s, 16s, 20s...
  baseDelayMs: 1_000,
  // Capped rather than growing into minutes. The delay is paid by holding the
  // request open, so an unbounded ramp would let a guesser tie up connections
  // — the very resource exhaustion the control is meant to avoid. Twenty
  // seconds already reduces sustained guessing against one account to three
  // attempts a minute.
  maxDelayMs: 20_000,
  // Counter lifetime. Sliding: each further failure refreshes it, so a
  // persistent guesser stays slowed, while an honest user who gets it wrong a
  // few times is back to full speed a quarter-hour later.
  windowSeconds: 900,
} as const;

// Express's `trust proxy` must match the real number of hops in front of the
// app, and must never be a blanket `true`: one hop too many and any client can
// forge its own address with an `X-Forwarded-For` header, sidestepping every
// per-IP limit above.
//
// There is no safe default for production, which is why it has none and
// security-config.ts refuses to boot without TRUST_PROXY_HOPS set. Both ways
// of being wrong hurt:
//
//   * Too low and `request.ip` resolves to an infrastructure address, so all
//     production traffic shares one bucket and real users get 429s.
//   * Too high and the value is client-controlled, so the per-IP limits are
//     bypassable. (The per-account backoff keys on the email, not the
//     address, so it still applies — which is the reason both controls exist.)
//
// The count is deployment shape, not preference. For the documented setup —
// browser → hosting edge → Next server → hosting edge → API — the API sees
// two trusted hops: the edge that is its socket peer, plus the Next server's
// address appended to the forwarded chain. Non-production defaults to 0:
// nothing sits in front of a dev server, so no forwarded header is believed.
export function resolveTrustProxyHops(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.TRUST_PROXY_HOPS?.trim();

  if (raw) {
    const parsed = Number(raw);

    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
}

// Escape hatch for the Playwright suite, which drives many parallel logins
// from a single loopback address and would otherwise trip the per-IP caps.
// Never set in production — readiness reports it so a mistake is visible.
export function isRateLimitDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.RATE_LIMIT_DISABLED?.trim() === "true";
}
