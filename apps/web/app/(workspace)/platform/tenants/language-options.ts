// UI languages the web frontend ships dictionaries for (apps/web/messages);
// mirrors SUPPORTED_TENANT_LANGUAGES in src/modules/settings/settings.types.ts.
// Platform screens stay English by design; only the option labels name the
// languages themselves.
export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English (en)" },
  { value: "uk", label: "Ukrainian (uk)" },
];

// Matches DEFAULT_LANGUAGE in src/modules/platform/platform.service.ts.
export const DEFAULT_TENANT_LANGUAGE = "uk";
