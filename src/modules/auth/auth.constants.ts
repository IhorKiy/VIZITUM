export const SESSION_COOKIE_NAME = "vizitum_session";
export const CSRF_COOKIE_NAME = "vizitum_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

// Absolute lifetime of a tenant session. Was 30 days, which meant a stolen
// cookie stayed a working credential for a month. A week still spares a rep
// a daily login while bounding the damage to something a person would
// plausibly notice.
export const SESSION_TTL_DAYS = 7;

// The idle deadline, checked against `lastSeenAt` — which the code already
// wrote on every authenticated request but never read for expiry.
//
// Sized around a working week rather than a working day: a rep who finishes
// on Friday evening and opens the app on Monday morning has been idle for
// about 64 hours, and logging every one of them out over a normal weekend
// would be a self-inflicted outage every Monday. Three days clears that with
// margin while still ending a session abandoned on a lost phone well before
// the absolute TTL would.
export const SESSION_IDLE_TIMEOUT_HOURS = 72;

export const SESSION_TOKEN_BYTES = 32;
export const CSRF_TOKEN_BYTES = 24;
export const HASH_ALGORITHM = "sha256";

// Shortest password the product accepts, on every path that sets one: invite
// acceptance, reset and self-service change all read this.
export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_RESET_TOKEN_BYTES = 32;
// Short by design. A reset link is a bearer credential sitting in an inbox, and
// the cost of it lapsing is one more trip through the forgot form.
export const PASSWORD_RESET_TTL_MINUTES = 60;
// Live (unused, unexpired) reset tokens one account may hold at once. Past this
// the request is dropped without sending, so repeatedly submitting someone
// else's address can't flood their inbox. Above 1 so a person who lost the
// first mail to a spam filter can ask again.
export const PASSWORD_RESET_MAX_ACTIVE_TOKENS = 3;
// Per-client-IP ceiling on forgot-password submissions, independent of which
// address each one names.
export const PASSWORD_RESET_IP_LIMIT = 10;
export const PASSWORD_RESET_IP_WINDOW_MS = 15 * 60 * 1000;

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
