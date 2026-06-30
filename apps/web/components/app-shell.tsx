import Link from "next/link";

import { buildTenantNav, normalizeTenantName } from "../lib/navigation";

type AppShellProps = {
  tenantSlug: string;
  activeArea: "field" | "admin" | "manager" | "operations";
  children: React.ReactNode;
};

export function AppShell({ tenantSlug, activeArea, children }: AppShellProps) {
  const navItems = buildTenantNav(tenantSlug);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">Vizitum</p>
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
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <main className="main-surface">{children}</main>

      <nav className="mobile-nav" aria-label="Primary mobile">
        {navItems.map((item) => (
          <Link
            aria-current={item.area === activeArea ? "page" : undefined}
            className="mobile-nav-link"
            href={item.href}
            key={item.href}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
