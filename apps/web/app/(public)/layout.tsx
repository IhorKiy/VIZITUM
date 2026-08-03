import "../globals.css";

import { ErrorMonitor } from "../../components/error-monitor";
import { rootMetadata } from "../../lib/root-metadata";

export const metadata = rootMetadata;

/**
 * Root layout for the public pages: the two marketing landings and the two
 * workspace entry screens.
 *
 * It exists to be the half of the app that touches nothing request-scoped.
 * The single root layout this replaced called next-intl's `getLocale()` /
 * `getMessages()` / `getTimeZone()`, all of which reach `headers()` through
 * i18n/request.ts, and one `headers()` read anywhere above a route opts that
 * route out of prerendering. Every route in the app was therefore rendered
 * per request — including `/` and `/en`, which are pure marketing pages with
 * no per-request input at all, are the two URLs app/sitemap.ts advertises,
 * and are the ones crawlers actually hit. Each crawl booked a serverless
 * invocation to re-render a page whose HTML never varies.
 *
 * Nothing here needs the provider: `Landing` and `WorkspaceEntry` are handed
 * their dictionary as a prop by the page (see app/(public)/page.tsx for why
 * they pin it rather than resolving it) and set `lang` on their own `<main>`,
 * so no descendant reads a next-intl hook.
 *
 * `lang="en"` is what these pages already rendered: with no tenant slug in
 * the path, resolveTenantLocale falls back to English, so the Ukrainian
 * landing has always carried `<html lang="en">` with `<main lang="uk">`
 * inside it. Pinning the same value here changes no output. Correcting it
 * needs the group split by language and is left to its own change.
 *
 * The entry screens stay dynamic — they read the remembered-workspace cookie
 * — which is fine and expected: they are `noindex`, so no crawler is paying
 * for them.
 */
export default function PublicRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ErrorMonitor />
        {children}
      </body>
    </html>
  );
}
