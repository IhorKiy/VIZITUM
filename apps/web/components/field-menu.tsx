"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import type { FieldMenuLink, Zone } from "../lib/navigation";
import { logoutAction } from "../lib/session-actions";
import { selectZoneAction } from "../lib/zone-actions";
import { CloseIcon, LogOutIcon, MenuIcon } from "./icons";
import { NavIcon } from "./nav-icon";

type FieldMenuProps = {
  tenantSlug: string;
  companyName: string;
  user: { name: string; email: string } | null;
  links: FieldMenuLink[];
  /**
   * Zones the user can switch to besides the field one. Rendered here rather
   * than in the topbar (where every other zone keeps them) so the phone frame's
   * header holds only the brand and this button.
   */
  otherZones: Zone[];
  /** Translated zone names, keyed by zone — `common.zone.names` is a server dictionary. */
  zoneNames: Record<string, string>;
  /** Highlights the button while one of the menu's own screens is open. */
  active: boolean;
};

/**
 * The representative's menu: everything that isn't one of the four things a
 * working day is made of (route, planning, tasks, history). Those four own the
 * bottom nav; the catalogue screens, help and the session controls live behind
 * this button, which is why the field zone has no fifth tab.
 *
 * A native <dialog> rather than a hand-rolled panel: it brings the focus trap,
 * Esc-to-close and inert background that a drawer needs, and its ::backdrop is
 * the scrim.
 */
export function FieldMenu({
  active,
  companyName,
  links,
  otherZones,
  tenantSlug,
  user,
  zoneNames,
}: FieldMenuProps) {
  const t = useTranslations("field.menu");
  const tCommon = useTranslations("common");
  const tZoneSwitcher = useTranslations("common.zone.switcher");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  // Navigating away is what closes the menu: the links are plain <a>-style
  // Next links, and without this the dialog would still be open on the screen
  // the user just landed on.
  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={t("open")}
        className="field-menu-button"
        data-active={active ? "true" : undefined}
        onClick={() => dialogRef.current?.showModal()}
        title={t("open")}
        type="button"
      >
        <MenuIcon size={22} />
      </button>

      <dialog
        aria-label={t("title")}
        className="field-menu-dialog"
        ref={dialogRef}
      >
        <div className="field-menu-header">
          <div className="field-menu-identity">
            <p className="field-menu-company">{companyName}</p>
            {user ? (
              <>
                <p className="field-menu-user-name">{user.name}</p>
                <p className="field-menu-user-email">{user.email}</p>
              </>
            ) : null}
          </div>
          <button
            aria-label={tCommon("close")}
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            title={tCommon("close")}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <nav aria-label={t("title")} className="field-menu-links">
          {links.map((link) => (
            <a className="field-menu-link" href={link.href} key={link.key}>
              <span className="field-menu-link-icon">
                <NavIcon name={link.icon} />
              </span>
              <span className="field-menu-link-text">
                <span className="field-menu-link-label">{t(link.key)}</span>
                <span className="field-menu-link-hint">
                  {t(`${link.key}Hint`)}
                </span>
              </span>
              <span aria-hidden="true" className="field-menu-link-chevron">
                ›
              </span>
            </a>
          ))}
        </nav>

        {otherZones.length > 0 ? (
          <div
            aria-label={tZoneSwitcher("ariaLabel")}
            className="field-menu-zones"
          >
            <p className="field-menu-section-label">{tZoneSwitcher("label")}</p>
            {otherZones.map((zone) => (
              <form action={selectZoneAction} key={zone}>
                <input name="tenantSlug" type="hidden" value={tenantSlug} />
                <input name="zone" type="hidden" value={zone} />
                <button className="field-menu-zone-button" type="submit">
                  {zoneNames[zone] ?? zone}
                </button>
              </form>
            ))}
          </div>
        ) : null}

        {user ? (
          <form action={logoutAction} className="field-menu-logout">
            <input name="tenantSlug" type="hidden" value={tenantSlug} />
            <button className="field-menu-logout-button" type="submit">
              <LogOutIcon size={18} />
              <span>{t("signOut")}</span>
            </button>
          </form>
        ) : null}
      </dialog>
    </>
  );
}
