import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getCurrentSession } from "../lib/api-client";
import {
  buildTenantNav,
  normalizeTenantName,
  type RoleArea,
} from "../lib/navigation";

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
  const [sessionResult, tNav, tCommon] = await Promise.all([
    getCurrentSession(),
    getTranslations("common.nav"),
    getTranslations("common"),
  ]);
  const navItems = buildTenantNav(
    tenantSlug,
    sessionResult.ok ? sessionResult.data.permissions : undefined,
    sessionResult.ok ? sessionResult.data.productsEnabled : true,
  );

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
      </header>

      <aside className="sidebar" aria-label={tNav("ariaPrimary")}>
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">{tCommon("appName")}</p>
            <p className="tenant-name">{normalizeTenantName(tenantSlug)}</p>
          </div>
        </div>

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
