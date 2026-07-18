"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import { GripIcon, MapPinIcon, TrashIcon } from "../../../../components/icons";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";

type StopItem = {
  id: string;
  location: {
    id: string;
    name: string;
    addressLine: string;
    city: string;
  };
};

type RouteStopDragListProps = {
  tenantSlug: string;
  templateId: string;
  stops: StopItem[];
  removeAction: (formData: FormData) => Promise<void>;
  reorderAction: (templateId: string, itemIds: string[]) => Promise<void>;
};

// Counts how many *other* items currently sit above `pointerY` (by their
// midpoint) to get the dragged item's target index — simpler and more
// robust than comparing against the dragged item's own shifting position.
function targetIndexForPointer(
  pointerY: number,
  order: StopItem[],
  draggingId: string,
  itemEls: Map<string, HTMLLIElement>,
): number {
  let index = 0;

  for (const item of order) {
    if (item.id === draggingId) {
      continue;
    }

    const el = itemEls.get(item.id);

    if (!el) {
      continue;
    }

    const rect = el.getBoundingClientRect();

    if (pointerY > rect.top + rect.height / 2) {
      index += 1;
    }
  }

  return index;
}

function moveItem<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function RouteStopDragList({
  tenantSlug,
  templateId,
  stops,
  removeAction,
  reorderAction,
}: RouteStopDragListProps) {
  const t = useTranslations("field.planning");
  const [order, setOrder] = useState(stops);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const orderRef = useRef(order);
  const itemEls = useRef(new Map<string, HTMLLIElement>());
  const stopsKey = stops.map((stop) => stop.id).join(",");

  orderRef.current = order;

  // Resyncs only when the server's own item set/order actually changes
  // (add/remove, or a redirect after a persisted reorder) — not on every
  // incidental re-render, which would otherwise stomp a drag in progress.
  useEffect(() => {
    setOrder(stops);
  }, [stopsKey]);

  function commitOrder(nextOrder: StopItem[]) {
    const changed = nextOrder.some(
      (item, index) => item.id !== stops[index]?.id,
    );

    if (changed) {
      startTransition(() => {
        void reorderAction(
          templateId,
          nextOrder.map((item) => item.id),
        );
      });
    }
  }

  // Listens on window rather than relying on setPointerCapture redirecting
  // events back to the handle: capture only engages for trusted (real
  // mouse/touch) input, and a window-level listener tracks the pointer
  // wherever it actually is once the drag has moved off the small handle.
  useEffect(() => {
    if (!draggingId) {
      return;
    }

    const activeId = draggingId;

    function handleMove(event: PointerEvent) {
      const currentOrder = orderRef.current;
      const currentIndex = currentOrder.findIndex(
        (item) => item.id === activeId,
      );
      const targetIndex = targetIndexForPointer(
        event.clientY,
        currentOrder,
        activeId,
        itemEls.current,
      );

      if (targetIndex !== currentIndex) {
        setOrder(moveItem(currentOrder, currentIndex, targetIndex));
      }
    }

    function handleEnd() {
      setDraggingId(null);
      commitOrder(orderRef.current);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }, [draggingId]);

  function handlePointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    id: string,
  ) {
    event.preventDefault();
    setDraggingId(id);
  }

  function handleHandleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();

    const currentOrder = orderRef.current;
    const index = currentOrder.findIndex((item) => item.id === id);
    const targetIndex = event.key === "ArrowUp" ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= currentOrder.length) {
      return;
    }

    const nextOrder = moveItem(currentOrder, index, targetIndex);
    setOrder(nextOrder);
    commitOrder(nextOrder);
  }

  return (
    <ol className="route-stop-list">
      {order.map((stop, index) => (
        <li
          className={`route-stop${draggingId === stop.id ? " dragging" : ""}`}
          key={stop.id}
          ref={(el) => {
            if (el) {
              itemEls.current.set(stop.id, el);
            } else {
              itemEls.current.delete(stop.id);
            }
          }}
        >
          <button
            aria-label={t("dragHandleAria", { name: stop.location.name })}
            className="route-stop-handle"
            onKeyDown={(event) => handleHandleKeyDown(event, stop.id)}
            onPointerDown={(event) => handlePointerDown(event, stop.id)}
            type="button"
          >
            <GripIcon />
          </button>

          <a
            className="route-stop-summary"
            href={`/${tenantSlug}/field/locations/${stop.location.id}`}
            aria-label={t("viewLocationAria", { name: stop.location.name })}
          >
            <span className="route-stop-index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="route-stop-body">
              <h3>{stop.location.name}</h3>
              <p className="route-stop-address">
                <MapPinIcon />
                <span>
                  {[stop.location.addressLine, stop.location.city]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </p>
            </span>
            <span className="route-stop-chevron" aria-hidden="true">
              ›
            </span>
          </a>

          <form action={removeAction} className="route-stop-remove-form">
            <input name="templateId" type="hidden" value={templateId} />
            <input name="itemId" type="hidden" value={stop.id} />
            <PendingSubmitButton
              aria-label={t("removeAria", { name: stop.location.name })}
              className="icon-button"
              pendingLabel={<TrashIcon />}
            >
              <TrashIcon />
            </PendingSubmitButton>
          </form>
        </li>
      ))}
    </ol>
  );
}
