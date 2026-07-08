import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  DEFAULT_LOCALE,
  extractTenantSlugFromPathname,
  resolveTenantLocale,
} from "../lib/tenant-locale";

type Messages = Record<string, unknown>;

// English is the canonical dictionary: other locales are deep-merged over it
// so a missing translation renders the English string instead of a raw key.
function mergeWithFallback(fallback: Messages, override: Messages): Messages {
  const merged: Messages = { ...fallback };

  for (const [key, value] of Object.entries(override)) {
    const fallbackValue = merged[key];

    merged[key] =
      value &&
      typeof value === "object" &&
      fallbackValue &&
      typeof fallbackValue === "object"
        ? mergeWithFallback(fallbackValue as Messages, value as Messages)
        : value;
  }

  return merged;
}

export default getRequestConfig(async () => {
  const headerStore = await headers();
  const pathname = headerStore.get("x-pathname") ?? "";
  const tenantSlug = extractTenantSlugFromPathname(pathname);
  const { locale, timeZone } = await resolveTenantLocale(tenantSlug);

  const defaultMessages = (await import("../messages/en.json"))
    .default as Messages;
  const messages =
    locale === DEFAULT_LOCALE
      ? defaultMessages
      : mergeWithFallback(
          defaultMessages,
          (await import(`../messages/${locale}.json`)).default as Messages,
        );

  return { locale, timeZone, messages };
});
