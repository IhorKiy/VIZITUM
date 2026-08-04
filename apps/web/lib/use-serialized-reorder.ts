"use client";

import { useLayoutEffect, useRef, useTransition } from "react";

// True when both orders name the same items in the same sequence — the
// exact comparison commitReorder uses to decide whether an incoming move is
// a genuine change. Kept standalone and pure (no refs, no timing) so it can
// be pinned with a plain unit test — see tests/web-serialized-reorder.test.ts
// — rather than only through e2e coverage that can't force the window this
// guards open any more reliably than the request race below.
export function ordersMatch(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// Sends the full item order to the server on every move, but never more than
// one call at a time: a move that lands while a send is still in flight
// replaces whatever was queued, and goes out the moment the in-flight call
// settles. Two independent full-order-replacement requests in flight
// together race at the server with no guarantee of completing in send
// order, so without this, a fast second move's request can resolve before
// the first and get silently overwritten by it. Serializing sends
// guarantees the opposite: the last request sent is always the last to
// commit, for a single client (this doesn't arbitrate two tabs or devices
// editing the same route at once — see #226).
//
// A move is compared against the last order this hook actually accepted —
// sent, in flight, or merely queued — never against the caller's own
// server-derived prop. A move-then-revert before the first send settles
// (order A,B,C; move to B,A,C; move back to A,B,C) computes a final order
// equal to that prop, which is still stale at that point; comparing against
// it would read the corrective second move as a no-op and drop it, leaving
// the server holding B,A,C with nothing left client-side to ever correct
// it. `initialOrder` seeds only the very first comparison, when nothing has
// been sent or queued yet to compare against instead — every comparison
// after that is against this hook's own record of what it has already
// committed to sending, which tracks client intent, not server catch-up.
export function useSerializedReorder(
  send: (itemIds: string[]) => Promise<void>,
  initialOrder: string[],
): (itemIds: string[]) => void {
  const [, startTransition] = useTransition();
  const sendingRef = useRef(false);
  const pendingRef = useRef<string[] | null>(null);
  const lastOrderRef = useRef(initialOrder);
  // A queued send's eventual `send` call happens inside a `.finally` that
  // can fire renders after flush() itself ran, so it has to read whichever
  // `send` is current at that point — not the one closed over when flush()
  // was called, which callers so far always keep stable but a future one
  // might not. Same always-fresh-mirror need as the drag lists' own
  // orderRef, and the same fix: a synchronous, every-render effect (no deps
  // array — `send` is a fresh closure identity every render for both
  // current callers, so a dependency array here would never actually skip
  // a run) rather than mutating the ref during render, which a discarded
  // concurrent render pass could do without ever committing.
  const sendRef = useRef(send);

  useLayoutEffect(() => {
    sendRef.current = send;
  });

  function flush() {
    const itemIds = pendingRef.current;

    if (!itemIds) {
      return;
    }

    pendingRef.current = null;
    sendingRef.current = true;

    startTransition(() => {
      sendRef
        .current(itemIds)
        .catch(() => {
          // Transport failure before the action could redirect either way.
          // The client keeps showing the order it already applied
          // optimistically, which the server never received — nothing here
          // reconciles that divergence; it stands until whatever triggers
          // the next successful send or a fresh server read (a reload, or
          // the stopsKey resync after some other move does land).
        })
        .finally(() => {
          sendingRef.current = false;
          flush();
        });
    });
  }

  return function commitReorder(itemIds: string[]) {
    if (ordersMatch(lastOrderRef.current, itemIds)) {
      return;
    }

    lastOrderRef.current = itemIds;
    pendingRef.current = itemIds;

    if (!sendingRef.current) {
      flush();
    }
  };
}
