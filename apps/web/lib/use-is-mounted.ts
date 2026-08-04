import { useSyncExternalStore } from "react";

function subscribeNever() {
  return () => {};
}

// True once hydrated on the client, false on the server and on the client's
// first render — the standard way to gate a portal (document.body does not
// exist during SSR) without the extra setState-in-effect render pass a
// useState+useEffect "mounted" flag costs.
export function useIsMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
