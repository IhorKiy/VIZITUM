import type { RoleCode } from "@prisma/client";
import type { Request } from "express";

import type { PermissionCode } from "../roles/permissions";

export type RequestContext = {
  requestId: string;
  tenantId: string;
  tenantSlug: string;
  userId?: string;
  roleCodes: RoleCode[];
  permissions: PermissionCode[];
};

/**
 * The resolved tenant context for a request, or a thrown error.
 *
 * Read this from the request rather than from a body or a param: the tenant is
 * resolved once, by `TenancyService`, and taking it from anything the client
 * supplied is the one invariant this backend cannot afford to lose.
 *
 * **The throw is the load-bearing part, not the return.** `Request.context` is
 * declared optional (`src/types/express.ts`), because it genuinely is absent
 * until the guards have run — so a handler that lost its permission decorator
 * reaches here with nothing, and this throw is the entire reason it answers 500
 * instead of running a query. `where: { tenantId: undefined }` is not an empty
 * result set in Prisma; it is *no filter at all*, so the cheapest way past the
 * compiler — `return request.context as RequestContext` — would turn a missing
 * decorator into a cross-tenant read.
 *
 * It lived as nineteen byte-identical copies, one per controller, each of which
 * already imported `RequestContext` from this file. All nineteen agreed; the
 * risk was the twentieth, written by someone who had to satisfy the optional
 * type themselves (audit F25). `tests/request-context.test.ts` pins both
 * halves: the throw, and that no controller declares its own copy again.
 */
export function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}
