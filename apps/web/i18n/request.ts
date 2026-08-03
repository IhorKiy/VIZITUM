import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  type AppLocale,
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

// The merge walks every key of the dictionary (1,665 of them) and produces the
// same result for every request in a given locale, yet it used to run once per
// render — on an app where no route is static, that is once per page view. The
// `import()`s were never the expensive half: the module registry already
// parsed each JSON file once per process. The merge is what repeated, so the
// merged dictionary is what gets held onto.
//
// The pending promise is what's stored, not the resolved value: requests
// arriving before the first merge settles would otherwise each start their
// own. A rejection drops the entry so a failed import is retried rather than
// cached as a permanent failure for the life of the process.
const messagesByLocale = new Map<AppLocale, Promise<Messages>>();

function loadMessages(locale: AppLocale): Promise<Messages> {
  const cached = messagesByLocale.get(locale);

  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const defaultMessages = (await import("../messages/en.json"))
      .default as Messages;

    if (locale === DEFAULT_LOCALE) {
      return defaultMessages;
    }

    return mergeWithFallback(
      defaultMessages,
      (
        (await import(`../messages/${locale}.json`)) as {
          default: Messages;
        }
      ).default,
    );
  })().catch((error: unknown) => {
    messagesByLocale.delete(locale);
    throw error;
  });

  messagesByLocale.set(locale, pending);

  return pending;
}

export default getRequestConfig(async () => {
  const headerStore = await headers();
  const pathname = headerStore.get("x-pathname") ?? "";
  const tenantSlug = extractTenantSlugFromPathname(pathname);
  const { locale, timeZone } = await resolveTenantLocale(tenantSlug);

  return { locale, timeZone, messages: await loadMessages(locale) };
});
