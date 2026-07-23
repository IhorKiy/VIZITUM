import {
  getCountries,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";

// Canonical phone handling for the three stored phone fields
// (PlatformTenant.contactPhone, User.phone, LocationContact.phone): the DB
// stores E.164, inputs are parsed against the tenant's phoneCountry, and
// display formatting is derived from the stored E.164 value.

export type PhoneNormalizationResult =
  | { ok: true; e164: string | null }
  | { ok: false; reason: "invalid" | "country_required" };

const COUNTRY_CODES = new Set<string>(getCountries());

// ISO 3166-1 alpha-2 country validation against the metadata actually shipped
// with the min bundle — anything accepted here is guaranteed to work as a
// parsing context later.
export function normalizePhoneCountry(value: unknown): CountryCode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  return COUNTRY_CODES.has(normalized) ? (normalized as CountryCode) : null;
}

export function listPhoneCountries(): readonly CountryCode[] {
  return getCountries();
}

// Input acceptance policy: a value starting with "+" is parsed as an
// international number of any country; anything else is parsed as a national
// number of `defaultCountry`. A tenant without a phoneCountry (legacy rows)
// can therefore only enter "+"-prefixed international numbers. Empty input is
// valid and normalizes to null (phone fields are optional unless the caller
// requires them).
export function normalizePhoneInput(
  raw: unknown,
  defaultCountry: string | null | undefined,
): PhoneNormalizationResult {
  if (raw === undefined || raw === null) {
    return { ok: true, e164: null };
  }

  if (typeof raw !== "string") {
    return { ok: false, reason: "invalid" };
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return { ok: true, e164: null };
  }

  const isInternational = trimmed.startsWith("+");
  const country = normalizePhoneCountry(defaultCountry);

  if (!isInternational && !country) {
    return { ok: false, reason: "country_required" };
  }

  const parsed = isInternational
    ? parsePhoneNumberFromString(trimmed)
    : parsePhoneNumberFromString(trimmed, country ?? undefined);

  if (!parsed || !parsed.isValid()) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, e164: parsed.number };
}

// Human-facing formatting for stored values: national format when the number
// belongs to the tenant's phoneCountry, international otherwise. Legacy values
// that never normalized (best-effort backfill leaves them as-is) pass through
// untouched so reads never break on old data.
export function formatPhoneForDisplay(
  stored: string | null | undefined,
  tenantPhoneCountry: string | null | undefined,
): string | null {
  if (!stored) {
    return null;
  }

  if (!stored.startsWith("+")) {
    return stored;
  }

  const parsed = parsePhoneNumberFromString(stored);

  if (!parsed || !parsed.isValid()) {
    return stored;
  }

  const country = normalizePhoneCountry(tenantPhoneCountry);

  return country && parsed.country === country
    ? parsed.formatNational()
    : parsed.formatInternational();
}
