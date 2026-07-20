// Small parsing/normalization helpers for LocationPotentialService and
// LocationAssortmentService, kept local rather than imported from
// routes/route-parsing.ts — this codebase duplicates normalize* helpers per
// module rather than sharing them across feature boundaries.

import { BadRequestException } from "@nestjs/common";
import type { AssortmentStatus } from "@prisma/client";

// Postgres int4 max. An unchecked overflow would reach Prisma and surface as
// an unhandled 500 instead of a clean 400.
const MAX_INT32 = 2147483647;

export const MAX_COMMENT_LENGTH = 500;

const ASSORTMENT_STATUS_VALUES: AssortmentStatus[] = [
  "in_stock",
  "out_of_stock",
  "to_order",
  "not_relevant",
];

function invalidValue(field: string, message: string): never {
  throw new BadRequestException({
    code: "LOCATION_INSIGHTS_VALUE_INVALID",
    message,
    fieldErrors: { [field]: [message] },
  });
}

export function normalizeOptionalNonNegativeInteger(
  value: unknown,
  field: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_INT32
  ) {
    invalidValue(field, "Must be a non-negative whole number.");
  }

  return value;
}

export function normalizeOptionalComment(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    invalidValue("comment", "Must be text.");
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length > MAX_COMMENT_LENGTH) {
    invalidValue(
      "comment",
      `Must be ${MAX_COMMENT_LENGTH} characters or fewer.`,
    );
  }

  return normalizedValue || null;
}

// Rejects both malformed strings ("not-a-date") and calendar-invalid ones
// ("2026-02-31"). The regex only checks the shape — and unlike a month
// component out of range (which the Date constructor turns into NaN), an
// out-of-range day silently rolls over (2026-02-31 becomes 2026-03-03)
// instead of producing NaN, so a bare Number.isNaN check would miss it. The
// round-trip string comparison catches both cases uniformly.
export function normalizeOptionalDateOnly(
  value: unknown,
  field: string,
): Date | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalidValue(field, "Must be in YYYY-MM-DD format.");
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    invalidValue(field, "Must be a valid calendar date.");
  }

  return date;
}

export function normalizeOptionalBoolean(
  value: unknown,
  field: string,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    invalidValue(field, "Must be true or false.");
  }

  return value;
}

export function normalizeAssortmentStatus(
  value: unknown,
  defaultValue: AssortmentStatus,
): AssortmentStatus {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (
    typeof value !== "string" ||
    !ASSORTMENT_STATUS_VALUES.includes(value as AssortmentStatus)
  ) {
    invalidValue(
      "status",
      `Must be one of ${ASSORTMENT_STATUS_VALUES.join(", ")}.`,
    );
  }

  return value as AssortmentStatus;
}

// Shared by the assortment list envelope and the tenant-wide summary so the
// "0 when there are no required rows" rule can't drift between call sites.
export function computeCoveragePct(
  requiredCount: number,
  inStockCount: number,
): number {
  return requiredCount > 0
    ? Math.round((inStockCount / requiredCount) * 100)
    : 0;
}
