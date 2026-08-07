import { ChevronDownIcon } from "./icons";

type PeriodPillProps = {
  // Names the control for a screen reader — the pill's own text is the current
  // value ("30 days"), which alone never says what it sets.
  ariaLabel: string;
  // The screen with `period=picker` added, and every other filter kept.
  href: string;
  // The window on screen, short form (see periodShortLabel).
  label: string;
};

/**
 * How far back the list reads, as one pill beside the screen's title.
 *
 * This is a *setting on the list*, not one of the filters that decide which
 * list is on screen — so it stays out of the filter row entirely and sits in
 * the header, where a phone's screens carry their one screen-level control. The
 * window is named on the pill rather than behind it: "which period am I
 * looking at?" is a question the list cannot answer on its own, and a control
 * that has to be opened to be read leaves it unanswered.
 *
 * A link, not a button: the picker it opens is a URL (see PeriodSheet), so this
 * needs no JavaScript to work and no client component to render.
 */
export function PeriodPill({ ariaLabel, href, label }: PeriodPillProps) {
  return (
    <a
      aria-label={`${ariaLabel}: ${label}`}
      className="period-pill"
      href={href}
    >
      {/* Its own element so it can trail off inside the pill rather than
          widening it — the accessible name above carries the label in full
          whatever the width does to it. */}
      <span className="period-pill-label">{label}</span>
      <span aria-hidden="true" className="period-pill-chevron">
        <ChevronDownIcon />
      </span>
    </a>
  );
}
