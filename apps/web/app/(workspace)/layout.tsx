import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTimeZone } from "next-intl/server";

import "../globals.css";

import { ErrorMonitor } from "../../components/error-monitor";
import { rootMetadata } from "../../lib/root-metadata";

export const metadata = rootMetadata;

/**
 * Root layout for everything behind a workspace address: the tenant zones and
 * the platform screens.
 *
 * This is the previous single root layout, unchanged — the tenant-resolved
 * locale, the provider every screen's `useTranslations`/`useFormatter` reads
 * from, and the per-request `now` the relative formatters need. Its cost is
 * the same as before: these routes read cookies to decide what to serve, so
 * they could never have been prerendered anyway.
 *
 * What changed is only which routes it covers. See app/(public)/layout.tsx
 * for why the marketing half was lifted out from under it.
 *
 * Navigating between the two groups is a full page load rather than a
 * client-side transition (Next.js does this for any move across root
 * layouts). Every such move already was one: the entry screen reaches a
 * workspace through `openWorkspace`, a server action that redirects.
 */
export default async function WorkspaceRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, messages, timeZone] = await Promise.all([
    getLocale(),
    getMessages(),
    getTimeZone(),
  ]);

  return (
    <html lang={locale}>
      <body>
        <ErrorMonitor />
        <NextIntlClientProvider
          locale={locale}
          messages={messages}
          now={new Date()}
          timeZone={timeZone}
        >
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
