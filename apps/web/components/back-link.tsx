import { ArrowLeftIcon } from "./icons";

type BackLinkProps = {
  href: string;
  /** Announced through aria-label/title — the control itself is icon-only. */
  label: string;
  /**
   * Drop the block wrapper when the caller already positions the link inside
   * its own layout (a flex column of sections, a compact header row). The
   * default wrapper aligns the link with the 1180px content column the rest
   * of the page headers use.
   */
  inline?: boolean;
};

/**
 * The single "return to the previous screen" affordance for the whole app: a
 * round icon button sitting at the top-left of the screen, above the header.
 *
 * **A plain `<a>`, deliberately — do not convert this to `next/link`.**
 * `public/sw.js` gates its offline fallback on
 * `event.request.mode === "navigate"`. An anchor produces a document
 * navigation, which is one; a `next/link` click produces a client-side RSC
 * fetch, which is not — so a rep with no signal would stop getting the cached
 * shell when they tap back. This control is on every screen in the product,
 * so converting this one file would lose that everywhere at once. Nothing
 * else would notice: typecheck, lint and `field-offline-shell.spec.ts` all
 * stay green, the last because it exercises a reload. `tests/web-field-zone-
 * anchors.test.ts` is what notices (audit F32).
 * Screens used to mix three variants (this circle, a bare "‹" glyph and a
 * "Back to X" toolbar button) — everything routes through here now, so the
 * toolbars stay reserved for real actions.
 */
export function BackLink({ href, inline = false, label }: BackLinkProps) {
  const link = (
    <a aria-label={label} className="back-link" href={href} title={label}>
      <ArrowLeftIcon size={20} />
    </a>
  );

  return inline ? link : <div className="page-back">{link}</div>;
}
