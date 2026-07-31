import { BadRequestException } from "@nestjs/common";

// Backend length caps for free-text input.
//
// The web app caps the same fields with `maxLength` from
// `apps/web/lib/input-limits.ts`, but that is a courtesy to the person
// typing, not a control: every one of these endpoints is reachable directly
// with curl. Without a server-side cap the columns are unbounded `text`, so a
// scripted caller can write megabyte rows until the database fills.
//
// The two maps are deliberately kept in sync, key for key. When you change a
// cap here, change it there — and vice versa; `tests/input-limits.test.ts`
// fails if they drift.
export const TEXT_LIMITS = {
  name: 120,
  email: 254,
  password: 128,
  phone: 24,
  slug: 64,
  code: 64,
  country: 56,
  domain: 253,
  addressLine: 200,
  city: 120,
  search: 100,
  title: 200,
  notes: 2000,
  comment: 500,
  token: 200,
  quantity: 9,
} as const;

export type TextLimitKey = keyof typeof TEXT_LIMITS;

// Matches body-parser's own default, which the API relied on by accident
// until now. Stated explicitly so the ceiling is a decision rather than a
// library detail that a dependency bump could move.
//
// The largest legitimate body is a CSV import posted as JSON
// (`POST /imports/jobs/validate`), which is why this is not smaller.
export const JSON_BODY_LIMIT = "100kb";

export function withinLimit(
  value: string,
  limit: TextLimitKey | number,
): boolean {
  return value.length <= resolveLimit(limit);
}

export function resolveLimit(limit: TextLimitKey | number): number {
  return typeof limit === "number" ? limit : TEXT_LIMITS[limit];
}

/**
 * Rejects an over-long field rather than truncating it.
 *
 * Truncating would be the quieter option and the wrong one: quietly storing
 * half of what someone typed is a data-loss bug wearing a security fix's
 * clothes. The caller supplies the module's own error code so the response
 * matches every other validation failure from that endpoint.
 */
export function assertTextWithinLimit(
  value: string,
  limit: TextLimitKey | number,
  field: string,
  code: string,
): string {
  const maximum = resolveLimit(limit);

  if (value.length <= maximum) {
    return value;
  }

  throw new BadRequestException({
    code,
    message: `${field} must be at most ${maximum} characters.`,
    fieldErrors: {
      [field]: [`Keep this to ${maximum} characters or fewer.`],
    },
  });
}
