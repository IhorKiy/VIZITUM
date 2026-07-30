import type { Instrumentation } from "next";

import { reportError } from "./lib/error-reporting";

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
