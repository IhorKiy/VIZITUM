export const PLATFORM_SESSION_COOKIE_NAME = "vizitum_platform_session";
export const PLATFORM_CSRF_COOKIE_NAME = "vizitum_platform_csrf";

// Hours, not the 30 days the platform session used to inherit from the tenant
// constants. One account reaches every tenant's data, and nothing about the
// platform console is a daily working tool — a session that outlives the
// sitting it was opened for is pure exposure.
export const PLATFORM_SESSION_TTL_HOURS = 12;

// Tighter than the tenant idle timeout for the same reason: platform work
// happens in a sitting, so an idle console is an abandoned one.
export const PLATFORM_SESSION_IDLE_TIMEOUT_HOURS = 2;
