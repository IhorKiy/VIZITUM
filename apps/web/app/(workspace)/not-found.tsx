import { getLocale, getTranslations } from "next-intl/server";

import { workspaceEntryPath } from "../../lib/workspace-address";

/**
 * What a reader sees when a workspace address does not resolve.
 *
 * It sits at the `(workspace)` root rather than inside `[tenantSlug]`, and
 * that placement is the whole reason it works: the `notFound()` this exists
 * for is thrown by `[tenantSlug]/layout.tsx`, and a boundary renders *inside*
 * the layout of its own segment — so a `not-found.tsx` in that segment would
 * be wrapped by the very layout that threw and could never render. The nearest
 * boundary that can is the parent group's.
 *
 * That throw is a security check, not a typo handler:
 * `[tenantSlug]/layout.tsx` refuses any segment that is not slug-shaped, which
 * is what stopped `/acme.js` rendering the authenticated app with no CSP, and
 * `tests/web-tenant-slug-shape.test.ts` asserts readers land here. Until now
 * "here" was Next's built-in page — unstyled, English, no branding and no way
 * back — which on the primary device is served inside an installed
 * `display: "standalone"` app that has no address bar to retype an address
 * into (audit F26). The link out is therefore the load-bearing part.
 *
 * A plain `<a>`, not `next/link`: the entry screen lives in the `(public)`
 * group under its own root layout, so Next does a full page load for that move
 * either way (CLAUDE.md, "Two root layouts").
 *
 * `useTranslations` works here because this renders inside the `(workspace)`
 * root layout, which mounts the provider. For an address with no resolvable
 * tenant the locale falls back to the default rather than a tenant's own —
 * unavoidable, since the tenant is precisely what could not be resolved.
 */
export default async function WorkspaceNotFound() {
  const [t, locale] = await Promise.all([
    getTranslations("common.notFound"),
    getLocale(),
  ]);

  return (
    <main className="not-found-screen">
      <p className="eyebrow">{t("eyebrow")}</p>
      <h1>{t("title")}</h1>
      <p>{t("description")}</p>
      <a className="primary-button" href={workspaceEntryPath(locale)}>
        {t("action")}
      </a>
    </main>
  );
}
