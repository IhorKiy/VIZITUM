import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { buildSchemeStyle } from "../../../lib/branding";
import { resolveTenantBranding } from "../../../lib/tenant-branding";
import { normalizeTenantSlug } from "../../../lib/tenant-locale";

type TenantLayoutProps = {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
};

// The one deliberate exception to the "no per-zone layout.tsx" convention
// (see components/app-shell.tsx): this layout renders no chrome — it only
// injects the tenant's color-scheme CSS variables so every page under the
// slug (login, invites, choose-zone and all zones) is branded, including
// pre-auth ones. The inline <style> lands after the global stylesheet, so
// its equal-specificity `:root` overrides win by document order; the default
// scheme emits nothing and renders byte-identical to before.
export default async function TenantLayout({
  children,
  params,
}: TenantLayoutProps) {
  const { tenantSlug } = await params;

  // Nothing else constrained the shape of this segment, so anything at all
  // rendered the app underneath it. What is served is decided by the session
  // cookie rather than by the slug, so `/acme.js` or `/team.html` reached the
  // real authenticated screens — and those paths end in an extension the
  // proxy's matcher skips, so they arrived with no Content-Security-Policy
  // either. The same unconstrained segment fed the `redirect()` targets that
  // pages build from it.
  //
  // One check here covers every page under the slug. It is the shape the rest
  // of the frontend already requires of a workspace address (the entry
  // screen, the remembered workspace and the zone actions all use
  // `isTenantSlug`); this is the door that was left without it.
  if (!normalizeTenantSlug(tenantSlug)) {
    notFound();
  }

  // Passed raw, like every other caller: resolveTenantBranding does the
  // slug-shape check itself, and pre-filtering here would key its cache
  // entry differently from the pages' and cost the request a second fetch.
  const branding = await resolveTenantBranding(tenantSlug);
  const schemeStyle = buildSchemeStyle(branding.colorScheme);

  return (
    <>
      {schemeStyle ? <style>{schemeStyle}</style> : null}
      {children}
    </>
  );
}
