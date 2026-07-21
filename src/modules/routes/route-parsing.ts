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
