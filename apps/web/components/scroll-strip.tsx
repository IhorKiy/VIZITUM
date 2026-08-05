"use client";

import { useEffect, useRef, type ReactNode } from "react";

type ScrollStripProps = {
  children: ReactNode;
  // Extra class on the scrolling viewport, for callers that need to size or
  // space its contents.
  viewportClassName?: string;
};

/**
 * A row that scrolls sideways, with a scrollbar we draw ourselves.
 *
 * The platform's own scrollbar cannot carry this: it is an overlay that fades
 * a second after the last scroll on desktop, and on iOS it is never painted at
 * all. On a strip whose whole design depends on the reader knowing there are
 * filters past the right edge, an indicator that is invisible most of the time
 * is the same as no indicator — the row simply looks finished.
 *
 * So the native bar is hidden and a track with a proportional thumb is drawn
 * under the row instead, always visible while there is anything to scroll to,
 * and absent when everything already fits (an unscrollable row with a
 * full-width line under it reads as a stray divider).
 *
 * The thumb is positioned by writing custom properties straight to the DOM
 * rather than through React state: this runs on every scroll frame, and a
 * re-render per frame to move a bar 3px tall is a bad trade.
 */
export function ScrollStrip({ children, viewportClassName }: ScrollStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const viewport = viewportRef.current;

    if (!strip || !viewport) {
      return;
    }

    const measure = () => {
      const { clientWidth, scrollLeft, scrollWidth } = viewport;
      // Sub-pixel layout leaves a fraction of overflow on rows that visibly
      // fit; a whole pill is worth far more than one pixel, so anything under
      // a couple of pixels counts as "nothing to reach".
      const overflow = scrollWidth - clientWidth;

      if (overflow < 2 || scrollWidth <= 0) {
        strip.dataset.scrollable = "false";
        return;
      }

      strip.dataset.scrollable = "true";
      strip.style.setProperty(
        "--strip-thumb-width",
        `${(clientWidth / scrollWidth) * 100}%`,
      );
      strip.style.setProperty(
        "--strip-thumb-offset",
        `${(scrollLeft / scrollWidth) * 100}%`,
      );
    };

    measure();

    // The row's width changes with the viewport, and its content's width with
    // the filters themselves (a count appearing turns "Overdue" into
    // "Overdue 2"), so both are watched.
    const resizeObserver = new ResizeObserver(measure);

    resizeObserver.observe(viewport);

    for (const child of viewport.children) {
      resizeObserver.observe(child);
    }

    viewport.addEventListener("scroll", measure, { passive: true });

    return () => {
      resizeObserver.disconnect();
      viewport.removeEventListener("scroll", measure);
    };
  }, []);

  return (
    <div className="scroll-strip" data-scrollable="false" ref={stripRef}>
      <div
        className={`scroll-strip-viewport${
          viewportClassName ? ` ${viewportClassName}` : ""
        }`}
        ref={viewportRef}
      >
        {children}
      </div>
      {/* Presentational: the row it describes is already reachable by keyboard
          and by swipe, and a screen reader gains nothing from a bar. */}
      <span aria-hidden="true" className="scroll-strip-track">
        <span className="scroll-strip-thumb" />
      </span>
    </div>
  );
}
