// IANA time zone list for platform-side timezone pickers. Built from the
// runtime's own zone database so every option is guaranteed to pass the
// backend's Intl-based validation.
const FALLBACK_TIMEZONES = [
  "Europe/Kyiv",
  "Europe/Warsaw",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

// The zone database version varies per runtime: newer ICU lists the canonical
// "Europe/Kyiv", older ones only its legacy "Europe/Kiev" alias.
const DEFAULT_TIMEZONE_PREFERENCE = ["Europe/Kyiv", "Europe/Kiev"];

export function listTimezones(): string[] {
  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone");
  }

  return FALLBACK_TIMEZONES;
}

export function defaultTimezoneOption(timezones: string[]): string {
  return (
    DEFAULT_TIMEZONE_PREFERENCE.find((zone) => timezones.includes(zone)) ??
    timezones[0]
  );
}

// The picker options come from the runtime zone database, but a tenant may
// hold a value recorded under a different database version (e.g. the legacy
// "Europe/Kiev" alias for "Europe/Kyiv"). Keep the stored value selectable so
// the form renders it correctly and "unchanged" detection keeps working.
export function timezoneOptionsWith(current?: string): string[] {
  const timezones = listTimezones();

  if (current && !timezones.includes(current)) {
    return [current, ...timezones];
  }

  return timezones;
}
