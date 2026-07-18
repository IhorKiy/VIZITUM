// Small parsing/normalization helpers shared by RoutesService and
// RouteTemplatesService so a fix — or a bug — in one can't silently diverge
// from the other.

export function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

export function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return null;
  }

  return value;
}

// Rejects both malformed strings ("not-a-date") and calendar-invalid ones
// ("2026-02-31"): the regex only checks the shape, and an out-of-range date
// component produces an Invalid Date object, which is still truthy — left
// unchecked it would reach Prisma and surface as an unhandled 500 instead of
// a 400.
export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}
