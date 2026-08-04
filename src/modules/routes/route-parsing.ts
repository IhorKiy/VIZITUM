// Small parsing/normalization helpers shared by RoutesService and
// RouteTemplatesService so a fix — or a bug — in one can't silently diverge
// from the other.

import { Prisma } from "@prisma/client";

// Both services convert a unique-index collision (a sequence slot, a
// (rep, date[, template]) pair, ...) into a 409 instead of letting Prisma's
// raw error surface as an unhandled 500 — this is the one check every one of
// those call sites shares.
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

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

export function normalizeIdList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const ids: string[] = [];

  for (const entry of value) {
    const id = normalizeId(entry);

    if (!id) {
      return null;
    }

    ids.push(id);
  }

  return ids;
}

// The two shapes this module's date fields take. Exported because the DTOs on
// the class-validator track (2.4 in docs/security-remediation-plan.md) check
// the same shapes one layer earlier: a pattern restated there could drift from
// the one enforced here, which is the whole reason those helpers live in a
// shared file to begin with. Neither pattern is the full check — see
// parseDateOnly below and normalizeMonth in route-templates.service.ts.
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_PATTERN = /^\d{4}-\d{2}$/;

// Rejects both malformed strings ("not-a-date") and calendar-invalid ones
// ("2026-02-31"). The regex only checks the shape — and unlike a month
// component out of range (which the Date constructor turns into NaN), an
// out-of-range day silently rolls over (2026-02-31 becomes 2026-03-03)
// instead of producing NaN, so a bare Number.isNaN check would miss it. The
// round-trip string comparison catches both cases uniformly.
//
// That NaN check on its own is what this function used to do, while its
// comment already claimed the calendar half — so `POST /routes` answered 201
// for a plan it had quietly moved to March 3rd. The two sibling
// implementations (`normalizeOptionalDateOnly` in
// location-insights-parsing.ts, `parseDateOnly` in visits/shelf-check.ts)
// both had the round trip; this one was the odd one out, found while putting
// a DTO in front of the routes controllers.
export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}
