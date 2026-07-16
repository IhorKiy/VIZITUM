import type { ReactNode } from "react";

import { buildSchemeStyle } from "../../lib/branding";
import { resolveTenantBranding } from "../../lib/tenant-branding";
import { isTenantSlug } from "../../lib/tenant-locale";

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
  const branding = await resolveTenantBranding(
    isTenantSlug(tenantSlug) ? tenantSlug : null,
  );
  const schemeStyle = buildSchemeStyle(branding.colorScheme);

  return (
    <>
      {schemeStyle ? <style>{schemeStyle}</style> : null}
      {children}
    </>
  );
}
