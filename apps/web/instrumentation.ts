import type { Instrumentation } from "next";

import { assertClientAddressConfiguration } from "./lib/client-address";
import { reportError } from "./lib/error-reporting";

// Runs once per runtime as the server starts, before it serves anything. A
// production process that cannot name the header its client addresses arrive
// in should refuse to start rather than come up quietly unable to tell one
// caller from another — the same gate the API applies in
// src/modules/auth/security-config.ts, for the same class of silently
// degrading control.
export function register(): void {
  assertClientAddressConfiguration();
}

// Captures Next.js server-side errors (server components, server actions,
// route handlers) that never reach the browser handlers. Headers are
// deliberately ignored: events carry no cookies, no PII.
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  errorRequest,
  errorContext,
) => {
  await reportError({
    exception: error,
    mechanism: "server-request",
    platform: "node",
    tags: {
      module: "web-server",
      routerKind: errorContext.routerKind,
      routePath: errorContext.routePath,
      routeType: errorContext.routeType,
      renderSource: errorContext.renderSource,
      digest:
        typeof error === "object" && error !== null && "digest" in error
          ? String((error as { digest?: unknown }).digest)
          : undefined,
    },
    request: {
      method: errorRequest.method,
      url: errorRequest.path,
    },
  });
};
