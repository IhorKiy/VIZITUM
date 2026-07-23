import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";

// Web-side mirror of src/common/phone.ts (the two workspaces don't share
// code): same input acceptance policy — "+"-prefixed input parses as an
// international number, anything else as a national number of the tenant's
// phoneCountry — and the same display rules for stored E.164 values.

export type PhoneNormalizationResult =
  | { ok: true; e164: string | null }
  | { ok: false; reason: "invalid" | "country_required" };

const COUNTRY_CODES = new Set<string>(getCountries());

export function normalizePhoneCountry(
  value: string | null | undefined,
): CountryCode | null {
  const normalized = value?.trim().toUpperCase();

  return normalized && COUNTRY_CODES.has(normalized)
    ? (normalized as CountryCode)
    : null;
}

export function listPhoneCountries(): readonly CountryCode[] {
  return getCountries();
}

// Dial code hint for a phone input, e.g. "+380" for "UA".
export function dialCodeForCountry(
  value: string | null | undefined,
): string | null {
  const country = normalizePhoneCountry(value);

  return country ? `+${getCountryCallingCode(country)}` : null;
}

export function normalizePhoneInput(
  raw: string | null | undefined,
  defaultCountry: string | null | undefined,
): PhoneNormalizationResult {
  const trimmed = raw?.trim();

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

// National format when the number belongs to the tenant's phoneCountry,
// international otherwise. Legacy values that never normalized pass through
// untouched so old data still renders.
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

// tel: href target: raw E.164 dials cleanly; legacy values fall back to the
// old strip-whitespace behavior.
export function phoneHref(stored: string): string {
  return `tel:${stored.replace(/\s+/g, "")}`;
}
