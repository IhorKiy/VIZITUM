"use client";

import { useSyncExternalStore } from "react";

function subscribeNever() {
  return () => {};
}

// True once hydrated on the client, false on the server and on the client's
// first render — the standard way to gate a portal (document.body does not
// exist during SSR). For a component whose subtree is part of the SSR
// payload this still costs one re-render after hydration, same as a
// useState+useEffect flag — React reconciles getServerSnapshot against
// getSnapshot in its own passive effect and forces that render if they
// differ. What this buys instead: it's a React-sanctioned primitive that
// satisfies react-hooks/set-state-in-effect (the setState happens inside
// React's internals, not in code the linter can flag), and a component that
// mounts *after* hydration — not part of the initial payload — has nothing
// to reconcile and skips the extra render entirely.
export function useIsMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
