import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentSession, listActiveAnnouncements } from "../lib/api-client";
import { resolveTenantBranding } from "../lib/tenant-branding";
import { BrandMark } from "./brand-mark";
import { FieldMenu } from "./field-menu";
import { LogOutIcon } from "./icons";
import { NavIcon } from "./nav-icon";
import { PendingSubmitButton } from "./pending-submit-button";
import {
  availableZones,
  buildFieldMenuLinks,
  buildTenantNav,
  resolveZoneLanding,
  zoneForArea,
  zoneHomePath,
  ZONE_ORDER,
  type RoleArea,
  type Zone,
} from "../lib/navigation";
import { logoutAction } from "../lib/session-actions";
import { selectZoneAction } from "../lib/zone-actions";

type AppShellProps = {
  tenantSlug: string;
  activeArea: RoleArea;
  children: React.ReactNode;
  // Lets a screen give up the pinned brand row and take the top edge for
  // itself. Only the field task list does: it collapses its own header into a
  // bar that has to sit at the very top of the phone, and two pinned rows would
  // spend a third of the screen naming the app rather than showing the work.
  // Everywhere else the brand row stays where a reader expects it.
  scrollingTopbar?: boolean;
};

export async function AppShell({
  tenantSlug,
  activeArea,
  children,
  scrollingTopbar = false,
}: AppShellProps) {
  const currentZone = zoneForArea(activeArea);

  const [
    sessionResult,
    branding,
    tNav,
    tCommon,
    tAccount,
    tZoneNames,
    tZoneSwitcher,
    activeAnnouncementsResult,
  ] = await Promise.all([
    getCurrentSession(),
    resolveTenantBranding(tenantSlug),
    getTranslations("common.nav"),
    getTranslations("common"),
    getTranslations("account"),
    getTranslations("common.zone.names"),
    getTranslations("common.zone.switcher"),
    // Feeds the unread badge on the "Home" nav item. Fetched here (rather than
    // per-page) since the bottom nav is the one thing every field page renders;
    // gated on zone, not on session, so it stays a single parallel round-trip
    // instead of a second await once the session resolves. The board lives on
    // the home screen, so the count has to be visible from wherever in the
    // field zone the rep currently is.
    currentZone === "field" ? listActiveAnnouncements() : Promise.resolve(null),
  ]);

  const unreadAnnouncementCount =
    activeAnnouncementsResult && activeAnnouncementsResult.ok
      ? activeAnnouncementsResult.data.unreadCount
      : 0;

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
  const productsEnabled = sessionResult.ok
    ? sessionResult.data.productsEnabled
    : true;
  // The field zone's catalogue/help screens and its session controls hang off
  // the menu button instead of a fifth bottom tab — see components/field-menu.tsx.
  const fieldMenuLinks =
    currentZone === "field"
      ? buildFieldMenuLinks(
          tenantSlug,
          sessionResult.ok ? sessionResult.data.permissions : undefined,
          productsEnabled,
        )
      : [];

  // A count hanging off a field nav item, sidebar and mobile alike:
  // announcements not yet acknowledged, on "Home". Null for every other item,
  // and for that one once its own count reaches zero.
  //
  // "Tasks" carried one too, until the list itself started saying it: its
  // filter row opens on "In progress" with the same number on the pill, and now
  // repeats it in the collapsed bar at any scroll depth. A badge that only ever
  // agreed with the screen it points at is a number to keep in sync, not
  // information.
  const navBadge = (area: RoleArea) => {
    if (area === "field" && unreadAnnouncementCount > 0) {
      return (
        <span
          aria-label={tNav("announcementBadgeAria", {
            count: unreadAnnouncementCount,
          })}
          className="nav-badge"
        >
          {unreadAnnouncementCount > 99 ? "99+" : unreadAnnouncementCount}
        </span>
      );
    }

    return null;
  };

  // The field (representative) zone is phone-only: it always renders the
  // mobile layout, framed in a centered phone-width column on wider screens.
  const shellClassName = [
    "app-shell",
    currentZone === "field" ? "app-shell--mobile-only" : null,
    scrollingTopbar ? "app-shell--topbar-scrolls" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClassName}>
      <header className="mobile-topbar" aria-label={tNav("ariaBrand")}>
        <div className="mobile-topbar-inner">
          <div className="brand-block">
            <BrandMark logoUrl={branding.logoUrl} />
            <div>
              <p className="topbar-company-name">{branding.name}</p>
              <p className="topbar-app-name">{tCommon("appName")}</p>
            </div>
          </div>

          <div className="topbar-aside">
            {currentZone === "field" ? (
              <FieldMenu
                active={activeArea === "field-menu"}
                companyName={branding.name}
                links={fieldMenuLinks}
                otherZones={otherZones}
                tenantSlug={tenantSlug}
                user={
                  currentUser
                    ? { name: currentUser.name, email: currentUser.email }
                    : null
                }
                zoneNames={Object.fromEntries(
                  ZONE_ORDER.map((zone) => [zone, tZoneNames(zone)]),
                )}
              />
            ) : null}

            {currentUser && currentZone !== "field" ? (
              // The field zone shows the signed-in name in its page greeting
              // ("Hi, {firstName}!"), so the topbar name would just duplicate it
              // — and its own sign-out lives behind the menu button above.
              <div className="topbar-identity">
                <p className="topbar-user-name">{currentUser.name}</p>
                {/* Icon-only: this end of the topbar already carries the name
                    and, below it, the zone pills, and a labelled button would
                    crowd both off a narrow phone. `pendingLabel={null}` leaves
                    the spinner as the whole pending state; the aria-label is
                    what a screen reader reads either way. */}
                <form action={logoutAction}>
                  <input name="tenantSlug" type="hidden" value={tenantSlug} />
                  <PendingSubmitButton
                    aria-label={tCommon("signOut")}
                    className="topbar-logout-button"
                    pendingLabel={null}
                    title={tCommon("signOut")}
                  >
                    <LogOutIcon size={16} />
                  </PendingSubmitButton>
                </form>
              </div>
            ) : null}

            {otherZones.length > 0 && currentZone !== "field" ? (
              <div
                aria-label={tZoneSwitcher("ariaLabel")}
                className="zone-switcher-mobile"
              >
                {otherZones.map((zone) => (
                  <form action={selectZoneAction} key={zone}>
                    <input name="tenantSlug" type="hidden" value={tenantSlug} />
                    <input name="zone" type="hidden" value={zone} />
                    <PendingSubmitButton
                      className="zone-switcher-link"
                      pendingLabel={tZoneNames(zone)}
                    >
                      {tZoneNames(zone)}
                    </PendingSubmitButton>
                  </form>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <aside className="sidebar" aria-label={tNav("ariaPrimary")}>
        <div className="brand-block">
          <BrandMark logoUrl={branding.logoUrl} />
          <div>
            <p className="brand-name">{tCommon("appName")}</p>
            <p className="tenant-name">{branding.name}</p>
          </div>
        </div>

        {currentUser ? (
          // The identity block doubles as the way into account settings, which
          // is where every desktop zone reaches the password change — the field
          // zone has no sidebar and uses its menu entry instead.
          <Link
            aria-label={tAccount("open")}
            className="current-user"
            href={`/${tenantSlug}/account`}
            title={tAccount("open")}
          >
            <p className="current-user-name">{currentUser.name}</p>
            <p className="current-user-email">{currentUser.email}</p>
          </Link>
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
                {/* Switching zones is a full navigation, so the spinner takes
                    the arrow's place while it runs and the zone keeps its
                    name — same shape, so nothing around it moves. */}
                <PendingSubmitButton
                  className="zone-switcher-link"
                  pendingLabel={tZoneNames(zone)}
                >
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
                </PendingSubmitButton>
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
              <span className="nav-icon">
                <NavIcon name={item.icon} />
                {navBadge(item.area)}
              </span>
              <span>{tNav(item.area)}</span>
            </Link>
          ))}
        </nav>

        {currentUser && currentZone !== "field" ? (
          // Until this existed, the manager/admin/operations areas had no way
          // out of a session at all: the sidebar ends at the nav, and typing
          // /{tenantSlug}/login is no longer an escape now that an already-valid
          // session is redirected back to its landing zone — an installed
          // workspace has no address bar to type it into either.
          //
          // Last in the sidebar, but sized to sit right under the nav rather
          // than at the foot of the rail — see .sidebar-logout in globals.css
          // for why the field menu's `margin-top: auto` is wrong here.
          //
          // Gated on the zone, not left to CSS: the field zone hides the
          // sidebar, but its sign-out has to clear on-device drafts and the
          // route snapshot first (field-menu.tsx), and a second, plainer
          // control that skipped that must not be one stylesheet edit away
          // from being reachable.
          <form action={logoutAction} className="sidebar-logout">
            <input name="tenantSlug" type="hidden" value={tenantSlug} />
            <PendingSubmitButton
              className="sidebar-logout-button"
              pendingLabel={tCommon("signingOut")}
            >
              <LogOutIcon size={16} />
              <span>{tCommon("signOut")}</span>
            </PendingSubmitButton>
          </form>
        ) : null}
      </aside>

      <main className="main-surface">{children}</main>

      <nav className="mobile-nav" aria-label={tNav("ariaPrimaryMobile")}>
        <div className="mobile-nav-inner">
          {navItems.map((item) => (
            <Link
              aria-current={item.area === activeArea ? "page" : undefined}
              className="mobile-nav-link"
              href={item.href}
              key={item.href}
            >
              <span className="mobile-nav-icon">
                <NavIcon name={item.icon} />
                {navBadge(item.area)}
              </span>
              <span className="mobile-nav-label">{tNav(item.area)}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
