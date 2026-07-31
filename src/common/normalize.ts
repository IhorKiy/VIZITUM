import { TEXT_LIMITS } from "./input-limits";

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();

  // Over-length is treated as "not an email" rather than as its own error:
  // every caller already rejects a null here, and nothing beyond the RFC 5321
  // practical ceiling is a deliverable address anyway.
  if (!email || email.length > TEXT_LIMITS.email) {
    return null;
  }

  return email;
}

// Deliberately lenient shape check ("something@something.something", no
// whitespace) — enough to reject obvious garbage like "not-an-email" without
// trying to fully model RFC 5322. Callers still normalize first.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

// IANA validation via the runtime's own time zone database: anything Intl
// rejects here would also break every later date formatting done in that zone.
export function normalizeTimezone(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    // resolvedOptions().timeZone canonicalizes casing and legacy aliases
    // (e.g. "europe/kyiv" or "Europe/Kiev") to one consistent stored form,
    // instead of persisting whatever string variant the caller typed.
    return new Intl.DateTimeFormat("en-US", {
      timeZone: trimmed,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
