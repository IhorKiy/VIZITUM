import { listPhoneCountries } from "../../../../lib/phone";

// English region names by design — the platform zone renders in en.
const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

export type PhoneCountryOption = { value: string; label: string };

export function phoneCountryOptions(): PhoneCountryOption[] {
  return [...listPhoneCountries()]
    .map((code) => ({
      value: code,
      label: `${REGION_NAMES.of(code) ?? code} (${code})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
