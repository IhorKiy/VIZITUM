"use client";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

export function RouteStopDragList({
  tenantSlug,
  templateId,
  stops,
  removeAction,
  reorderAction,
}: RouteStopDragListProps) {
  const [order, setOrder] = useState(stops);
  const [, startTransition] = useTransition();
  const orderRef = useRef(order);
  const stopsKey = stops.map((stop) => stop.id).join(",");

  orderRef.current = order;

  // Resyncs only when the server's own item set/order actually changes
  // (add/remove, or a redirect after a persisted reorder) — not on every
  // incidental re-render, which would otherwise stomp a drag in progress.
  useEffect(() => {
    setOrder(stops);
  }, [stopsKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  );

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const currentOrder = orderRef.current;
    const fromIndex = currentOrder.findIndex((item) => item.id === active.id);
    const toIndex = currentOrder.findIndex((item) => item.id === over.id);

    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const nextOrder = arrayMove(currentOrder, fromIndex, toIndex);
    setOrder(nextOrder);
    commitOrder(nextOrder);
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

    const nextOrder = arrayMove(currentOrder, index, targetIndex);
    setOrder(nextOrder);
    commitOrder(nextOrder);
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      id={templateId}
      sensors={sensors}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={order.map((stop) => stop.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol className="route-stop-list">
          {order.map((stop, index) => (
            <RouteStopRow
              index={index}
              key={stop.id}
              onHandleKeyDown={handleHandleKeyDown}
              removeAction={removeAction}
              stop={stop}
              templateId={templateId}
              tenantSlug={tenantSlug}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

type RouteStopRowProps = {
  index: number;
  onHandleKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) => void;
  removeAction: (formData: FormData) => Promise<void>;
  stop: StopItem;
  templateId: string;
  tenantSlug: string;
};

function RouteStopRow({
  index,
  onHandleKeyDown,
  removeAction,
  stop,
  templateId,
  tenantSlug,
}: RouteStopRowProps) {
  const t = useTranslations("field.planning");
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stop.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <li
      className={`route-stop${isDragging ? " dragging" : ""}`}
      ref={setNodeRef}
      style={style}
    >
      <button
        aria-label={t("dragHandleAria", { name: stop.location.name })}
        className="route-stop-handle"
        type="button"
        {...attributes}
        {...listeners}
        onKeyDown={(event) => onHandleKeyDown(event, stop.id)}
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
  );
}
