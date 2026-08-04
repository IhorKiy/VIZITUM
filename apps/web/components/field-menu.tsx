"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { withBackOrigin } from "../lib/back-navigation";
import type { FieldMenuLink, Zone } from "../lib/navigation";
import { clearDrafts } from "../lib/offline-drafts";
import { deleteRouteSnapshot } from "../lib/route-snapshot";
import { logoutAction } from "../lib/session-actions";
import { selectZoneAction } from "../lib/zone-actions";
import { CloseIcon, LogOutIcon, MenuIcon } from "./icons";
import { NavIcon } from "./nav-icon";
import { PendingLabel } from "./pending-label";
import { PendingSubmitButton } from "./pending-submit-button";

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
 * working day is made of (today's route, planning, tasks, history). Those four
 * own the bottom nav; building the reusable routes themselves, the catalogue
 * screens, help and the session controls live behind this button, which is why
 * the field zone has no fifth tab.
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
  const logoutFormRef = useRef<HTMLFormElement>(null);
  const draftsClearedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [clearingDrafts, setClearingDrafts] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Signing out hands the phone to whoever holds it next, so the half-typed
  // reports cached on it go with the session, and so does the route snapshot
  // — see `deleteRouteSnapshot`'s own comment for why that one can't be left
  // behind the way pending media is: it has no user in its key at all, so a
  // stale row is reachable by anyone who opens this tenant's field zone
  // offline next, not just the next person who happens to sign in as this
  // same rep. The clear has to finish *before* the sign-out navigation, not
  // alongside it: firing it off and letting the request race the delete
  // loses that race, and the next person inherits what should have gone with
  // this session.
  //
  // Unsent recordings are deliberately left alone — see the note on
  // `clearDrafts`. They belong to the rep who captured them, are keyed to that
  // rep, and cannot be recreated from anything.
  //
  // The ref means "this submit has already had its drafts cleared", and the
  // pass-through consumes it rather than latching. Sign-out is the one action a
  // rep with no signal still expects to work, and if the action cannot be
  // reached they stay on this screen and tap again — a latched flag would let
  // that second attempt sign out without clearing anything. `clearDrafts`
  // itself is bounded, so this cannot hold the navigation for long, and the
  // button is disabled while it runs: without that, a double-tap inside the
  // clear reaches the action through the same pass-through and re-opens the
  // exact race the wait exists to close.
  async function handleLogoutSubmit(event: FormEvent<HTMLFormElement>) {
    if (draftsClearedRef.current) {
      draftsClearedRef.current = false;
      return;
    }

    event.preventDefault();
    draftsClearedRef.current = true;
    setClearingDrafts(true);

    await Promise.all([clearDrafts(), deleteRouteSnapshot(tenantSlug)]);

    // Submit first, then drop the flag: releasing it beforehand leaves a frame
    // where the clear is done but the form has not started, and the button
    // flicks back to "Sign out" mid-sign-out. Ordered this way both updates
    // land in the same batch and the spinner never breaks.
    logoutFormRef.current?.requestSubmit();
    setClearingDrafts(false);
  }

  // This menu hangs off every field screen, so a link out of it has no single
  // opener to return to: help opened from tasks must go back to tasks, not to
  // the home route. The screen the menu is currently sitting on states itself
  // as the origin, and the target resolves it (lib/back-navigation.ts).
  // Anything not on the RETURNABLE_SCREENS allowlist falls back there instead.
  const query = searchParams.toString();
  const tenantPrefix = `/${tenantSlug}`;
  const currentPath = pathname.startsWith(`${tenantPrefix}/`)
    ? pathname.slice(tenantPrefix.length)
    : null;
  const origin = currentPath
    ? `${currentPath}${query ? `?${query}` : ""}`
    : null;

  // Navigating away is what closes the menu: with client-side routing the
  // dialog element survives the transition and would otherwise still be open
  // on the screen the user just landed on.
  useEffect(() => {
    dialogRef.current?.close();
    setOpen(false);
  }, [pathname]);

  function openDialog() {
    dialogRef.current?.showModal();
    setOpen(true);
  }

  function closeDialog() {
    dialogRef.current?.close();
    setOpen(false);
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("open")}
        className="field-menu-button"
        data-active={active ? "true" : undefined}
        onClick={openDialog}
        title={t("open")}
        type="button"
      >
        <MenuIcon size={22} />
      </button>

      <dialog
        aria-label={t("title")}
        className="field-menu-dialog"
        // A native <dialog> ignores backdrop clicks, and tapping beside a
        // drawer is the expected way to dismiss one on a phone. Both conditions
        // are needed. The backdrop is reported against the dialog element
        // itself, so a click on any child is never a dismissal — including the
        // (0, 0) click a keyboard Enter/Space synthesizes, which the point test
        // alone would read as landing left of a right-pinned drawer. And a
        // click that *is* on the element can still be inside its own padding,
        // which the point test rejects.
        onClick={(event) => {
          const bounds = dialogRef.current?.getBoundingClientRect();

          if (
            bounds &&
            event.target === dialogRef.current &&
            (event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom)
          ) {
            closeDialog();
          }
        }}
        onClose={() => setOpen(false)}
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
            onClick={closeDialog}
            title={tCommon("close")}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <nav aria-label={t("title")} className="field-menu-links">
          {links.map((link) => (
            <Link
              className="field-menu-link"
              href={origin ? withBackOrigin(link.href, origin) : link.href}
              key={link.key}
            >
              <span className="field-menu-link-icon nav-icon">
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
            </Link>
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
                <PendingSubmitButton
                  className="field-menu-zone-button"
                  pendingLabel={zoneNames[zone] ?? zone}
                >
                  {zoneNames[zone] ?? zone}
                </PendingSubmitButton>
              </form>
            ))}
          </div>
        ) : null}

        {user ? (
          <form
            action={logoutAction}
            className="field-menu-logout"
            onSubmit={handleLogoutSubmit}
            ref={logoutFormRef}
          >
            <input name="tenantSlug" type="hidden" value={tenantSlug} />
            {/* Clearing the drafts happens before the submit, so `pending` is
                still false through it — the same spinner is shown by hand for
                that stretch, or the first (and on a slow phone the longer)
                half of signing out would look like nothing happened. */}
            <PendingSubmitButton
              aria-busy={clearingDrafts}
              className={`field-menu-logout-button${
                clearingDrafts ? " is-pending" : ""
              }`}
              disabled={clearingDrafts}
              pendingLabel={tCommon("signingOut")}
            >
              {clearingDrafts ? (
                <PendingLabel label={tCommon("signingOut")} />
              ) : (
                <>
                  <LogOutIcon size={18} />
                  <span>{tCommon("signOut")}</span>
                </>
              )}
            </PendingSubmitButton>
          </form>
        ) : null}
      </dialog>
    </>
  );
}
