"use client";

import { useRef, useTransition } from "react";

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
export function useSerializedReorder(
  send: (itemIds: string[]) => Promise<void>,
): (itemIds: string[]) => void {
  const [, startTransition] = useTransition();
  const sendingRef = useRef(false);
  const pendingRef = useRef<string[] | null>(null);

  function flush() {
    const itemIds = pendingRef.current;

    if (!itemIds) {
      return;
    }

    pendingRef.current = null;
    sendingRef.current = true;

    startTransition(() => {
      send(itemIds)
        .catch(() => {
          // Transport failure before the action could redirect either way —
          // nothing to reconcile client-side; the next move retries with
          // whatever order is current then.
        })
        .finally(() => {
          sendingRef.current = false;
          flush();
        });
    });
  }

  return function commitReorder(itemIds: string[]) {
    pendingRef.current = itemIds;

    if (!sendingRef.current) {
      flush();
    }
  };
}
