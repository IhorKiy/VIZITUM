import type { RoleCode } from "@prisma/client";

import type { PermissionCode } from "../roles/permissions";

export type RequestContext = {
  requestId: string;
  tenantId: string;
  tenantSlug: string;
  userId?: string;
  roleCodes: RoleCode[];
  permissions: PermissionCode[];
};
