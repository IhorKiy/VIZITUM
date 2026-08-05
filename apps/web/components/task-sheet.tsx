"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type TaskSheetProps = {
  // Names the dialog for a screen reader — the task's own title.
  ariaLabel: string;
  children: ReactNode;
  // Where the list lives without this sheet open. Closing replaces the current
  // history entry with it (see close below).
  closeHref: string;
  closeLabel: string;
  // Sits opposite the close button on the drag row: the priority tag, or
  // nothing at all for a task that carries no flag.
  eyebrow?: ReactNode;
};

// How far the sheet has to be dragged before letting go dismisses it. Short
// enough to feel like a flick, long enough that a thumb that slips while
// reading never throws the sheet away.
const DISMISS_THRESHOLD_PX = 110;

/**
 * The task detail sheet: it slides up over the list, and the list stays exactly
 * where it was underneath.
 *
 * The sheet is a URL, not a piece of component state — the row links to
 * `?open=<taskId>` and this renders because the server saw it. That is what
 * makes the phone's own back gesture close it, which is the one control every
 * reader already knows and the first one they will try. Deep links, refreshes
 * and the browser's history keep working for free.
 *
 * Closing from inside (the button, the backdrop, a swipe) *replaces* that entry
 * rather than pushing the list again: the sheet was pushed on open, so
 * replacing it on close leaves history holding one entry for this screen, and a
 * back press afterwards goes wherever the reader came from instead of
 * re-opening what they just dismissed.
 */
export function TaskSheet({
  ariaLabel,
  children,
  closeHref,
  closeLabel,
  eyebrow,
}: TaskSheetProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Set while a finger is on the drag row; null the rest of the time.
  const dragRef = useRef<{
    offset: number;
    pointerId: number;
    startY: number;
  } | null>(null);

  const close = useCallback(() => {
    router.replace(closeHref, { scroll: false });
  }, [closeHref, router]);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (!dialog.open) {
      dialog.showModal();
    }

    // One frame later, so the browser has the closed position to animate from
    // rather than painting the sheet already in place.
    const frame = requestAnimationFrame(() => {
      dialog.dataset.open = "true";
    });

    // Escape reaches a dialog as `cancel`. Route it through the same close as
    // everything else, or the dialog would shut with `?open=` still in the URL
    // and the sheet would be back on the next render.
    const onCancel = (event: Event) => {
      event.preventDefault();
      close();
    };
    // A click that lands on the dialog itself is a click on the backdrop: the
    // panel inside covers every other pixel of it.
    const onClick = (event: MouseEvent) => {
      if (event.target === dialog) {
        close();
      }
    };

    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(frame);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("click", onClick);
    };
  }, [close]);

  const setDragOffset = (offset: number) => {
    panelRef.current?.style.setProperty("--sheet-drag", `${offset}px`);
  };

  return (
    <dialog aria-label={ariaLabel} className="task-sheet" ref={dialogRef}>
      <div className="task-sheet-panel" ref={panelRef}>
        {/* The drag surface is the top of the sheet — the handle and the row
            beside it, where a thumb reaching to dismiss already is. The body
            below scrolls instead, so a long history stays readable. */}
        <div
          className="task-sheet-grab"
          onPointerCancel={() => {
            dragRef.current = null;
            panelRef.current?.removeAttribute("data-dragging");
            setDragOffset(0);
          }}
          onPointerDown={(event) => {
            // A mouse drag is not a gesture anyone makes on a desktop, and
            // capturing one would swallow text selection. The close button is
            // excluded too: a capture started on it can send the resulting
            // click somewhere other than the button.
            if (
              event.pointerType === "mouse" ||
              (event.target instanceof Element &&
                event.target.closest("a, button"))
            ) {
              return;
            }

            dragRef.current = {
              offset: 0,
              pointerId: event.pointerId,
              startY: event.clientY,
            };
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // A pointer the browser will not hand over (already captured,
              // already gone) simply means no drag: the sheet still closes by
              // button, backdrop and back gesture.
              dragRef.current = null;
              return;
            }

            panelRef.current?.setAttribute("data-dragging", "true");
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;

            if (!drag || drag.pointerId !== event.pointerId) {
              return;
            }

            // Downward only: dragging up would lift the sheet off the bottom of
            // the screen and show the backdrop underneath it.
            drag.offset = Math.max(0, event.clientY - drag.startY);
            setDragOffset(drag.offset);
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;

            dragRef.current = null;
            panelRef.current?.removeAttribute("data-dragging");

            if (!drag || drag.pointerId !== event.pointerId) {
              return;
            }

            if (drag.offset >= DISMISS_THRESHOLD_PX) {
              // Let it finish falling before the navigation unmounts it.
              dialogRef.current?.removeAttribute("data-open");
              close();
              return;
            }

            // Under the threshold the sheet goes back where it was: that drag
            // was a hesitation, not a decision.
            setDragOffset(0);
          }}
        >
          <span aria-hidden="true" className="task-sheet-handle" />
          <div className="task-sheet-grab-row">
            <div className="task-sheet-eyebrow">{eyebrow}</div>
            <button className="task-sheet-close" onClick={close} type="button">
              {closeLabel}
            </button>
          </div>
        </div>
        {children}
      </div>
    </dialog>
  );
}
