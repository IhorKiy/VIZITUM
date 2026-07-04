import type { PlanCode, SegmentTemplate, TenantStatus } from "@prisma/client";

export type CreateTenantInput = {
  name: string;
  slug: string;
  country?: string;
  timezone?: string;
  language?: string;
  segmentTemplate: SegmentTemplate;
  primaryDomain?: string;
  actorUserId?: string;
  requestId?: string;
};

export type UpdateTenantInput = {
  name?: string;
  timezone?: string;
  language?: string;
  primaryDomain?: string | null;
  planCode?: PlanCode;
  status?: TenantStatus;
  actorUserId?: string;
  requestId?: string;
};
