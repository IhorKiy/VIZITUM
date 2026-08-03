import { resolveCookieName } from "../../common/cookie-naming";

// Neither cookie takes a dev-only override: unlike the tenant session
// cookie, no worktree slot varies these per port today. Both still get the
// __Host- prefix in production, same as the tenant pair.
export const PLATFORM_SESSION_COOKIE_NAME = resolveCookieName(
  "vizitum_platform_session",
);
export const PLATFORM_CSRF_COOKIE_NAME = resolveCookieName(
  "vizitum_platform_csrf",
);

// Hours, not the 30 days the platform session used to inherit from the tenant
// constants. One account reaches every tenant's data, and nothing about the
// platform console is a daily working tool — a session that outlives the
// sitting it was opened for is pure exposure.
export const PLATFORM_SESSION_TTL_HOURS = 12;

// Tighter than the tenant idle timeout for the same reason: platform work
// happens in a sitting, so an idle console is an abandoned one.
export const PLATFORM_SESSION_IDLE_TIMEOUT_HOURS = 2;

// Shown in the authenticator app's entry, so it should read as the product.
export const MFA_TOTP_ISSUER = "Vizitum";

// Tolerance either side of the current 30-second step, for the clock drift
// between the owner's phone and the server that RFC 6238 expects. One step
// each way: wider trades a real security margin for a problem NTP solves.
export const MFA_TOTP_WINDOW_SECONDS = 30;

// How long the half-authenticated state between "password accepted" and
// "code accepted" may sit around. Long enough to find a phone, install an
// authenticator app and scan; short enough that an abandoned attempt is not
// a lingering credential.
export const MFA_CHALLENGE_TTL_MINUTES = 10;

export const MFA_CHALLENGE_TOKEN_BYTES = 32;

// Enough that losing a couple to mistyping is not a crisis, few enough to
// print on one line each.
export const MFA_RECOVERY_CODE_COUNT = 10;
