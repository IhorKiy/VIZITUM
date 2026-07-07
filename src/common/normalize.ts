export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();

  return email || null;
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
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });

    return trimmed;
  } catch {
    return null;
  }
}
