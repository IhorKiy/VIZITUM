import type { RoleCode } from "@prisma/client";

export type RequestContext = {
  requestId: string;
  tenantId: string;
  tenantSlug: string;
  userId?: string;
  roleCodes: RoleCode[];
  permissions: string[];
};
