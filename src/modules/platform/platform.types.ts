import type { SegmentTemplate } from "@prisma/client";

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
