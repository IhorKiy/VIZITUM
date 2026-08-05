"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type StickyFilterChip = {
  // Stable identity for the row — the filter this chip selects, not its label.
  key: string;
  label: string;
  // Absent where the list behind it failed to load; a chip with no count says
  // less than one with a wrong count (mirrors FilterCount on the full row).
  count?: number | undefined;
  href: string;
  // Whether this filter is currently on. Mirrors the full row's checked state
  // exactly — one filter state, two places it is drawn.
  active: boolean;
  // Colours an active chip after the signal it selects, the way the full row's
  // toggle pills are coloured.
  tone?: "overdue" | "priority";
};

type TaskStickyBarProps = {
  ariaLabel: string;
  chips: StickyFilterChip[];
  // The full filter row this bar stands in for. Wrapped rather than merely
  // sitting next to it: the row's own position is what decides when the bar is
  // due, so holding it is how the bar knows without a scroll offset to keep in
  // sync with the header's height.
  children: ReactNode;
  // Names what tapping the title does, since the title is the control.
  scrollTopLabel: string;
  title: string;
};

/**
 * The task list's collapsed header: a 56px bar carrying the screen name and the
 * same filters as the full header, shown once the real filter row has scrolled
 * out of reach.
 *
 * Why a second copy rather than pinning the real row: the full header is the
 * screen's first impression — brand row, title, the create action — and pinning
 * any part of it would either freeze all of it (a phone screenful spent on
 * furniture) or leave the row floating away from the heading it belongs to. The
 * copy costs one small element and lets the collapsed state be designed as its
 * own thing: title inline, filters inline, nothing else.
 *
 * The two copies never disagree because neither holds state — the URL does. The
 * header's row is the form that writes it; this one is links that write the same
 * thing, which is also what makes a filter change from here land at the top of
 * the new list (a full navigation) rather than halfway down the old scroll
 * position.
 *
 * Appearance is driven by watching the real row rather than by a scroll offset.
 * The spec's threshold ("110px, recalculate when the header's height changes")
 * is really "once the filter row is gone", which the row itself can say — no
 * number to keep in sync, and no work on the scroll thread, which a listener at
 * 60fps would be. The pinned top bar is what the row is measured against, so
 * the bar arrives exactly as the row disappears under it rather than 69px
 * early. (An empty sentinel element would read better than a wrapper, but an
 * observed target with no height never reports at all.)
 */
export function TaskStickyBar({
  ariaLabel,
  chips,
  children,
  scrollTopLabel,
  title,
}: TaskStickyBarProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  // The spec's "collapsed" state, named for what it does here: the header is
  // collapsed exactly when this bar stands in for it.
  const [barShown, setBarShown] = useState(false);

  useEffect(() => {
    const row = rowRef.current;

    if (!row) {
      return;
    }

    const root = document.documentElement;
    let observer: IntersectionObserver | null = null;

    // The shell's two fixed edges, measured rather than hardcoded: the top bar
    // grows with a long tenant name, and the bottom nav carries the device's
    // own safe-area inset. Everything that has to clear them — this bar, the
    // sticky group headings, the FAB — reads these two variables.
    const measure = () => {
      const topBar = document.querySelector(".mobile-topbar");
      const bottomNav = document.querySelector(".mobile-nav");
      // Only a *pinned* brand row is an inset. On this screen it scrolls away
      // with the header (AppShell's scrollingTopbar), so the top edge is the
      // viewport's own and the bar sits at 0 — but the same component has to
      // keep working on a shell that pins it.
      const topBarPinned =
        topBar !== null &&
        ["fixed", "sticky"].includes(getComputedStyle(topBar).position);
      const top =
        topBar && topBarPinned
          ? Math.round(topBar.getBoundingClientRect().height)
          : 0;
      const bottom = bottomNav
        ? Math.round(bottomNav.getBoundingClientRect().height)
        : 0;

      root.style.setProperty("--field-top-inset", `${top}px`);
      root.style.setProperty("--field-bottom-inset", `${bottom}px`);

      return top;
    };

    const observe = () => {
      observer?.disconnect();
      observer = new IntersectionObserver(
        ([entry]) => {
          // Only an exit through the *top* collapses the header. A row that
          // left through the bottom edge — a short list, an over-scrolled
          // pull-to-refresh — is one the reader has not passed yet.
          setBarShown(
            !entry.isIntersecting && entry.boundingClientRect.top < 0,
          );
        },
        { rootMargin: `-${measure()}px 0px 0px 0px`, threshold: 0 },
      );
      observer.observe(row);
    };

    observe();

    // rootMargin is fixed at construction, so a changed top inset needs a new
    // observer rather than a new margin.
    const handleResize = () => observe();

    window.addEventListener("resize", handleResize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <>
      <div className="task-sticky-bar-source" ref={rowRef}>
        {children}
      </div>

      <div
        // Hidden from assistive tech while it is off screen, so the filters are
        // announced once rather than twice. `visibility: hidden` (in CSS) does
        // the same for focus: the copy must not be tabbable while collapsed.
        aria-hidden={barShown ? undefined : "true"}
        aria-label={ariaLabel}
        className={`task-sticky-bar${barShown ? " is-visible" : ""}`}
        role="region"
      >
        <div className="task-sticky-bar-inner">
          <button
            className="task-sticky-bar-title"
            onClick={() =>
              window.scrollTo({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "auto"
                  : "smooth",
                top: 0,
              })
            }
            title={scrollTopLabel}
            type="button"
          >
            {title}
          </button>

          <div className="task-sticky-bar-pills filter-pills">
            {chips.map((chip) => (
              <Link
                aria-current={chip.active ? "true" : undefined}
                className={chip.tone ? `filter-pill--${chip.tone}` : undefined}
                href={chip.href}
                key={chip.key}
              >
                {chip.label}
                {chip.count === undefined ? null : (
                  <b className="filter-pill-count">{chip.count}</b>
                )}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
