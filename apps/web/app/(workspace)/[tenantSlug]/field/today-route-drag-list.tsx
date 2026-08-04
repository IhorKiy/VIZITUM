"use client";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  CheckIcon,
  GripIcon,
  MapPinIcon,
  TrashIcon,
} from "../../../../components/icons";
import { withBackOrigin } from "../../../../lib/back-navigation";
import { useSerializedReorder } from "../../../../lib/use-serialized-reorder";

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
  markVisitedAction: (formData: FormData) => Promise<void>;
  removeAction: (formData: FormData) => Promise<void>;
};

export function TodayRouteDragList({
  tenantSlug,
  stops,
  isDemoMode,
  reorderAction,
  markVisitedAction,
  removeAction,
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
          markVisitedAction={markVisitedAction}
          removeAction={removeAction}
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
  markVisitedAction: (formData: FormData) => Promise<void>;
  removeAction: (formData: FormData) => Promise<void>;
  routePlanId: string;
  stops: TodayStop[];
  tenantSlug: string;
};

function TodayRouteGroup({
  indexById,
  isDemoMode,
  reorderAction,
  markVisitedAction,
  removeAction,
  routePlanId,
  stops,
  tenantSlug,
}: TodayRouteGroupProps) {
  const t = useTranslations("field.home");
  const [order, setOrder] = useState(stops);
  const commitReorder = useSerializedReorder((itemIds) =>
    reorderAction(routePlanId, itemIds),
  );
  const orderRef = useRef(order);
  const stopsKey = stops.map((stop) => stop.id).join(",");

  // A passive effect flushes in its own scheduler task after commit, which
  // leaves a real gap between paint and the ref actually updating; a native
  // event (a second, fast ArrowDown on the handle) landing in that gap would
  // read orderRef.current stale and compute the reorder from the wrong array.
  // useLayoutEffect runs synchronously in the commit, before the browser can
  // dispatch the next event, so it closes that gap the way the render-time
  // assignment this replaced always did.
  useLayoutEffect(() => {
    orderRef.current = order;
  }, [order]);

  // Resyncs only when the server's own item set/order actually changes
  // (a redirect after a persisted reorder) — not on every incidental
  // re-render, which would otherwise stomp a drag in progress.
  // Adjusted during render (React's documented pattern for state that must
  // follow a derived key) rather than in an effect, so the corrected order is
  // what actually paints instead of flashing the stale one for a frame.
  const [prevStopsKey, setPrevStopsKey] = useState(stopsKey);
  if (stopsKey !== prevStopsKey) {
    setPrevStopsKey(stopsKey);
    setOrder(stops);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  );

  // dnd-kit's default screen-reader strings are English-only regardless of
  // tenant locale, and reference raw stop ids rather than a name a listener
  // would recognize — both replaced with translated, name-based text.
  function nameById(id: UniqueIdentifier): string {
    return orderRef.current.find((item) => item.id === id)?.name ?? "";
  }

  const accessibility = {
    screenReaderInstructions: { draggable: t("dragInstructions") },
    announcements: {
      onDragStart: ({ active }: { active: { id: UniqueIdentifier } }) =>
        t("dragStartedAnnouncement", { name: nameById(active.id) }),
      onDragOver: ({
        active,
        over,
      }: {
        active: { id: UniqueIdentifier };
        over: { id: UniqueIdentifier } | null;
      }) =>
        over
          ? t("dragOverAnnouncement", {
              name: nameById(active.id),
              overName: nameById(over.id),
            })
          : t("dragAwayAnnouncement", { name: nameById(active.id) }),
      onDragEnd: ({ active }: { active: { id: UniqueIdentifier } }) =>
        t("dragDroppedAnnouncement", { name: nameById(active.id) }),
      onDragCancel: ({ active }: { active: { id: UniqueIdentifier } }) =>
        t("dragCancelledAnnouncement", { name: nameById(active.id) }),
    },
  };

  function commitOrder(nextOrder: TodayStop[]) {
    const changed = nextOrder.some(
      (item, index) => item.id !== stops[index]?.id,
    );

    if (changed) {
      commitReorder(nextOrder.map((item) => item.id));
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
      accessibility={accessibility}
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
            markVisitedAction={markVisitedAction}
            onHandleKeyDown={handleHandleKeyDown}
            removeAction={removeAction}
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
  markVisitedAction: (formData: FormData) => Promise<void>;
  onHandleKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) => void;
  removeAction: (formData: FormData) => Promise<void>;
  stop: TodayStop;
  tenantSlug: string;
};

// Width (px) of a single revealed swipe action button — must match
// .route-stop-action in globals.css.
const ACTION_WIDTH = 92;
// A touch has to travel this far before we commit to a horizontal swipe (and
// stop treating it as a tap or a vertical scroll).
const SWIPE_AXIS_THRESHOLD = 8;

function TodayRouteStopRow({
  index,
  isDemoMode,
  markVisitedAction,
  onHandleKeyDown,
  removeAction,
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

  const href = withBackOrigin(
    `/${tenantSlug}/field/locations/${stop.locationId}?routePlanId=${stop.routePlanId}&routeItemId=${stop.id}${stop.visited ? "&visited=1" : ""}${
      isDemoMode
        ? `&demoName=${encodeURIComponent(stop.name)}&demoAddress=${encodeURIComponent(stop.address)}`
        : ""
    }`,
    "/field",
  );

  // Swipe is a mobile-only convenience wired to real server actions, so it
  // stays off in the offline demo (where there is no plan to mutate). A
  // visited stop has no swipe actions at all: it can't be re-marked visited,
  // and the backend refuses to remove a visited stop (ROUTE_ITEM_NOT_REMOVABLE),
  // so both actions ("visited" + "remove") only apply to an unvisited stop.
  const swipeEnabled = !isDemoMode && !stop.visited;
  const actionsWidth = 2 * ACTION_WIDTH;

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  // While a finger is dragging, transforms must track it 1:1 (no CSS easing);
  // easing is re-enabled only for the release snap.
  const [snapping, setSnapping] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const offsetRef = useRef(0);
  const swipedRef = useRef(false);

  // See the orderRef comment above: offsetRef is read from handleStart, a
  // native touchstart handler, so it needs the same synchronous-in-commit
  // guarantee — a passive effect would leave a gap where a fast re-touch
  // after a snap could read a stale startOffset.
  useLayoutEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  // A remove needs a second, deliberate tap; closing the row cancels that
  // pending confirmation so it never lingers — reopening the same row later
  // must start unconfirmed too, or one stray tap on a row that was confirmed
  // (but never submitted) in an earlier open would remove the stop straight
  // away. That means confirmRemove itself has to go back to false here, not
  // just a display value derived from it while leaving it stuck true
  // underneath. Adjusted during render (React's documented pattern for state
  // that must follow a derived condition) rather than in an effect: offset
  // changes on every touchmove of an active swipe, so the tracked "previous
  // offset" differs on nearly every render, but the render body here is cheap
  // enough that the extra invocation isn't worth an effect and a disable.
  const [prevOffset, setPrevOffset] = useState(offset);
  if (offset !== prevOffset) {
    setPrevOffset(offset);
    if (offset === 0) setConfirmRemove(false);
  }

  // Touch listeners are attached imperatively so touchmove can be non-passive
  // (preventDefault stops the page from scrolling mid-swipe — React's synthetic
  // touch handlers are passive and cannot).
  useEffect(() => {
    const el = surfaceRef.current;

    if (!el || !swipeEnabled) {
      return;
    }

    let startX = 0;
    let startY = 0;
    let startOffset = 0;
    let axis: "none" | "x" | "y" = "none";
    let active = false;

    function handleStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        return;
      }

      active = true;
      axis = "none";
      swipedRef.current = false;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      startOffset = offsetRef.current;
      setSnapping(false);
    }

    function handleMove(event: TouchEvent) {
      if (!active) {
        return;
      }

      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (axis === "none") {
        if (
          Math.abs(dx) > Math.abs(dy) &&
          Math.abs(dx) > SWIPE_AXIS_THRESHOLD
        ) {
          axis = "x";
        } else if (Math.abs(dy) > SWIPE_AXIS_THRESHOLD) {
          // Vertical intent — let the page scroll, bow out of this gesture.
          active = false;
          setSnapping(true);
          return;
        } else {
          return;
        }
      }

      if (axis === "x") {
        event.preventDefault();
        swipedRef.current = true;
        const next = Math.max(-actionsWidth, Math.min(0, startOffset + dx));
        setOffset(next);
      }
    }

    function handleEnd() {
      if (!active) {
        return;
      }

      active = false;
      setSnapping(true);
      // Snap fully open past the halfway point, otherwise fully closed.
      setOffset((current) => (current < -actionsWidth / 2 ? -actionsWidth : 0));
    }

    el.addEventListener("touchstart", handleStart, { passive: true });
    el.addEventListener("touchmove", handleMove, { passive: false });
    el.addEventListener("touchend", handleEnd);
    el.addEventListener("touchcancel", handleEnd);

    return () => {
      el.removeEventListener("touchstart", handleStart);
      el.removeEventListener("touchmove", handleMove);
      el.removeEventListener("touchend", handleEnd);
      el.removeEventListener("touchcancel", handleEnd);
    };
  }, [actionsWidth, swipeEnabled]);

  function handleSummaryClick(event: React.MouseEvent) {
    // A swipe ends in a click; if the row is open (or just swiped), that click
    // closes it instead of following the link to the location.
    if (swipedRef.current || offsetRef.current !== 0) {
      event.preventDefault();
      setSnapping(true);
      setOffset(0);
    }
  }

  return (
    <li
      className={`route-stop${swipeEnabled ? " route-stop-swipeable" : ""}${isDragging ? " dragging" : ""}${stop.visited ? " visited" : ""}${offset !== 0 ? " swiped" : ""}`}
      ref={setNodeRef}
      style={style}
    >
      {swipeEnabled ? (
        <div className="route-stop-actions" aria-hidden={offset === 0}>
          <form action={markVisitedAction} className="route-stop-action-form">
            <input type="hidden" name="routePlanId" value={stop.routePlanId} />
            <input type="hidden" name="routeItemId" value={stop.id} />
            <button
              aria-label={t("swipeMarkVisitedAria", { name: stop.name })}
              className="route-stop-action is-visit"
              tabIndex={offset === 0 ? -1 : undefined}
              type="submit"
            >
              <CheckIcon />
              <span>{t("swipeMarkVisited")}</span>
            </button>
          </form>
          <form action={removeAction} className="route-stop-action-form">
            <input type="hidden" name="routePlanId" value={stop.routePlanId} />
            <input type="hidden" name="routeItemId" value={stop.id} />
            <button
              aria-label={t("swipeRemoveAria", { name: stop.name })}
              className={`route-stop-action is-remove${confirmRemove ? " is-confirm" : ""}`}
              onClick={(event) => {
                if (!confirmRemove) {
                  event.preventDefault();
                  setConfirmRemove(true);
                }
              }}
              tabIndex={offset === 0 ? -1 : undefined}
              type={confirmRemove ? "submit" : "button"}
            >
              <TrashIcon />
              <span>
                {confirmRemove ? t("swipeRemoveConfirm") : t("swipeRemove")}
              </span>
            </button>
          </form>
        </div>
      ) : null}

      <div
        className="route-stop-surface"
        ref={surfaceRef}
        style={{
          // Guard on swipeEnabled so a row that was swiped open and then
          // marked visited (the server action redirects but React keeps this
          // instance, so `offset` persists) snaps back flush instead of
          // leaving the now-actionless row shifted.
          transform: `translateX(${swipeEnabled ? offset : 0}px)`,
          transition: snapping ? undefined : "none",
        }}
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
          onClick={handleSummaryClick}
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
      </div>
    </li>
  );
}
