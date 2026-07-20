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

import { GripIcon, MapPinIcon } from "../../../components/icons";

type TodayStop = {
  id: string;
  routePlanId: string;
  locationId: string;
  name: string;
  address: string;
  chain: { id: string; name: string } | null;
  sequence: number;
  visited: boolean;
};

type TodayRouteDragListProps = {
  tenantSlug: string;
  stops: TodayStop[];
  isDemoMode: boolean;
  reorderAction: (routePlanId: string, itemIds: string[]) => Promise<void>;
};

export function TodayRouteDragList({
  tenantSlug,
  stops,
  isDemoMode,
  reorderAction,
}: TodayRouteDragListProps) {
  const groups = groupByRoutePlan(stops);
  const indexById = new Map<string, number>();

  stops.forEach((stop, index) => {
    indexById.set(stop.id, index);
  });

  return (
    <ol className="route-stop-list">
      {groups.map((group) => (
        <TodayRouteGroup
          indexById={indexById}
          isDemoMode={isDemoMode}
          key={group.routePlanId}
          reorderAction={reorderAction}
          routePlanId={group.routePlanId}
          stops={group.stops}
          tenantSlug={tenantSlug}
        />
      ))}
    </ol>
  );
}

// A viewer with team-wide access sees every representative's plan for today
// merged into one list (see getTodayRoutes), so each plan gets its own drag
// context here — a stop can never be dragged into someone else's route.
function groupByRoutePlan(
  stops: TodayStop[],
): Array<{ routePlanId: string; stops: TodayStop[] }> {
  const order: string[] = [];
  const byPlan = new Map<string, TodayStop[]>();

  for (const stop of stops) {
    let planStops = byPlan.get(stop.routePlanId);

    if (!planStops) {
      planStops = [];
      byPlan.set(stop.routePlanId, planStops);
      order.push(stop.routePlanId);
    }

    planStops.push(stop);
  }

  return order.map((routePlanId) => ({
    routePlanId,
    stops: byPlan.get(routePlanId) as TodayStop[],
  }));
}

type TodayRouteGroupProps = {
  indexById: Map<string, number>;
  isDemoMode: boolean;
  reorderAction: (routePlanId: string, itemIds: string[]) => Promise<void>;
  routePlanId: string;
  stops: TodayStop[];
  tenantSlug: string;
};

function TodayRouteGroup({
  indexById,
  isDemoMode,
  reorderAction,
  routePlanId,
  stops,
  tenantSlug,
}: TodayRouteGroupProps) {
  const [order, setOrder] = useState(stops);
  const [, startTransition] = useTransition();
  const orderRef = useRef(order);
  const stopsKey = stops.map((stop) => stop.id).join(",");

  orderRef.current = order;

  // Resyncs only when the server's own item set/order actually changes
  // (a redirect after a persisted reorder) — not on every incidental
  // re-render, which would otherwise stomp a drag in progress.
  useEffect(() => {
    setOrder(stops);
  }, [stopsKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  );

  function commitOrder(nextOrder: TodayStop[]) {
    const changed = nextOrder.some(
      (item, index) => item.id !== stops[index]?.id,
    );

    if (changed) {
      startTransition(() => {
        void reorderAction(
          routePlanId,
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
      id={routePlanId}
      sensors={sensors}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={order.map((stop) => stop.id)}
        strategy={verticalListSortingStrategy}
      >
        {order.map((stop) => (
          <TodayRouteStopRow
            index={indexById.get(stop.id) ?? 0}
            isDemoMode={isDemoMode}
            key={stop.id}
            onHandleKeyDown={handleHandleKeyDown}
            stop={stop}
            tenantSlug={tenantSlug}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

type TodayRouteStopRowProps = {
  index: number;
  isDemoMode: boolean;
  onHandleKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) => void;
  stop: TodayStop;
  tenantSlug: string;
};

function TodayRouteStopRow({
  index,
  isDemoMode,
  onHandleKeyDown,
  stop,
  tenantSlug,
}: TodayRouteStopRowProps) {
  const t = useTranslations("field.home");
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

  const href = `/${tenantSlug}/field/locations/${stop.locationId}?routePlanId=${stop.routePlanId}&routeItemId=${stop.id}${stop.visited ? "&visited=1" : ""}${
    isDemoMode
      ? `&demoName=${encodeURIComponent(stop.name)}&demoAddress=${encodeURIComponent(stop.address)}`
      : ""
  }`;

  return (
    <li
      className={`route-stop${isDragging ? " dragging" : ""}${stop.visited ? " visited" : ""}`}
      ref={setNodeRef}
      style={style}
    >
      <div className="route-stop-drag-cell">
        <span className="route-stop-index" aria-hidden="true">
          {stop.visited ? "✓" : index + 1}
        </span>

        <button
          aria-label={t("dragHandleAria", { name: stop.name })}
          className="route-stop-handle"
          type="button"
          {...attributes}
          {...listeners}
          onKeyDown={(event) => onHandleKeyDown(event, stop.id)}
        >
          <GripIcon />
        </button>
      </div>

      <a
        className="route-stop-summary"
        href={href}
        aria-label={t("viewLocationAria", { name: stop.name })}
      >
        <span className="route-stop-body">
          <h3>{stop.name}</h3>
          <p className="route-stop-address">
            <MapPinIcon />
            <span>{stop.address}</span>
          </p>
          <span className="route-stop-chain">
            {stop.chain?.name ?? t("stopChainNone")}
          </span>
        </span>
      </a>
    </li>
  );
}
