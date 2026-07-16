import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentSession } from "../lib/api-client";
import {
  availableZones,
  buildTenantNav,
  normalizeTenantName,
  resolveZoneLanding,
  zoneForArea,
  zoneHomePath,
  type RoleArea,
  type Zone,
} from "../lib/navigation";
import { selectZoneAction } from "../lib/zone-actions";

type AppShellProps = {
  tenantSlug: string;
  activeArea: RoleArea;
  children: React.ReactNode;
};

export async function AppShell({
  tenantSlug,
  activeArea,
  children,
}: AppShellProps) {
  const [sessionResult, tNav, tCommon, tZoneNames, tZoneSwitcher] =
    await Promise.all([
      getCurrentSession(),
      getTranslations("common.nav"),
      getTranslations("common"),
      getTranslations("common.zone.names"),
      getTranslations("common.zone.switcher"),
    ]);

  const currentZone = zoneForArea(activeArea);
  let otherZones: Zone[] = [];

  // Deep-link guard, implemented once here rather than per page (there are
  // no per-zone layout.tsx files — every zone page renders AppShell
  // directly). Unauthenticated requests are left untouched: each page
  // already has its own signed-out fallback UI/demo mode, and there is no
  // pre-existing redirect-to-login for tenant zones to preserve.
  if (sessionResult.ok) {
    const zones = availableZones(
      sessionResult.data.permissions,
      sessionResult.data.productsEnabled,
      sessionResult.data.pilotActive,
    );

    if (!zones.includes(currentZone)) {
      const landing = resolveZoneLanding(
        sessionResult.data.permissions,
        sessionResult.data.productsEnabled,
        sessionResult.data.user.lastSelectedZone,
        sessionResult.data.pilotActive,
      );

      if (landing.kind === "zone") {
        redirect(`/${tenantSlug}${zoneHomePath(landing.zone)}`);
      } else if (landing.kind === "choose") {
        redirect(`/${tenantSlug}/choose-zone`);
      } else {
        redirect(`/${tenantSlug}/no-access`);
      }
    }

    // The "Pilot" area is only reachable while the tenant is on the pilot plan.
    // The nav already hides it; this guards a direct URL after the tenant has
    // graduated so the retired section can't be opened by an old link.
    if (activeArea === "admin-pilot" && !sessionResult.data.pilotActive) {
      redirect(`/${tenantSlug}/admin/settings`);
    }

    otherZones = zones.filter((zone) => zone !== currentZone);
  }

  const navItems = buildTenantNav(
    tenantSlug,
    sessionResult.ok ? sessionResult.data.permissions : undefined,
    sessionResult.ok ? sessionResult.data.productsEnabled : true,
    sessionResult.ok ? sessionResult.data.pilotActive : true,
  ).filter((item) => item.zone === currentZone);

  const currentUser = sessionResult.ok ? sessionResult.data.user : null;

  return (
    <div className="app-shell">
      <header className="mobile-topbar" aria-label={tNav("ariaBrand")}>
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="topbar-company-name">
              {normalizeTenantName(tenantSlug)}
            </p>
            <p className="topbar-app-name">{tCommon("appName")}</p>
          </div>
        </div>

        {currentUser ? (
          <p className="topbar-user-name">{currentUser.name}</p>
        ) : null}

        {otherZones.length > 0 ? (
          <div
            aria-label={tZoneSwitcher("ariaLabel")}
            className="zone-switcher zone-switcher-mobile"
          >
            {otherZones.map((zone) => (
              <form action={selectZoneAction} key={zone}>
                <input name="tenantSlug" type="hidden" value={tenantSlug} />
                <input name="zone" type="hidden" value={zone} />
                <button className="zone-switcher-link" type="submit">
                  {tZoneNames(zone)}
                </button>
              </form>
            ))}
          </div>
        ) : null}
      </header>

      <aside className="sidebar" aria-label={tNav("ariaPrimary")}>
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">{tCommon("appName")}</p>
            <p className="tenant-name">{normalizeTenantName(tenantSlug)}</p>
          </div>
        </div>

        {currentUser ? (
          <div className="current-user">
            <p className="current-user-name">{currentUser.name}</p>
            <p className="current-user-email">{currentUser.email}</p>
          </div>
        ) : null}

        {otherZones.length > 0 ? (
          <div
            aria-label={tZoneSwitcher("ariaLabel")}
            className="zone-switcher"
          >
            <p className="zone-switcher-label">{tZoneSwitcher("label")}</p>
            {otherZones.map((zone) => (
              <form action={selectZoneAction} key={zone}>
                <input name="tenantSlug" type="hidden" value={tenantSlug} />
                <input name="zone" type="hidden" value={zone} />
                <button className="zone-switcher-link" type="submit">
                  <span aria-hidden="true" className="zone-switcher-icon">
                    <svg
                      fill="none"
                      height="16"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 16 16"
                      width="16"
                    >
                      <path d="M3 8h9" />
                      <path d="M8.5 4.5 12 8l-3.5 3.5" />
                    </svg>
                  </span>
                  <span>{tZoneNames(zone)}</span>
                </button>
              </form>
            ))}
          </div>
        ) : null}

        <nav className="nav-list">
          {navItems.map((item) => (
            <Link
              aria-current={item.area === activeArea ? "page" : undefined}
              className="nav-link"
              href={item.href}
              key={item.href}
            >
              <span aria-hidden="true" className="nav-icon">
                {item.icon}
              </span>
              <span>{tNav(item.area)}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <main className="main-surface">{children}</main>

      <nav className="mobile-nav" aria-label={tNav("ariaPrimaryMobile")}>
        {navItems.map((item) => (
          <Link
            aria-current={item.area === activeArea ? "page" : undefined}
            className="mobile-nav-link"
            href={item.href}
            key={item.href}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{tNav(item.area)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
