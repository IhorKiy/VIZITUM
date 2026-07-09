import type { SegmentTemplate, TenantStatus } from "@prisma/client";

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
  status?: TenantStatus;
  // A positive integer sets an explicit per-tenant override; null clears it so
  // the cap follows the plan tier again.
  adminLimit?: number | null;
  actorUserId?: string;
  requestId?: string;
};

export type PlatformRequestPurgeInput = {
  confirmSlug?: unknown;
  actorUserId?: string;
  requestId?: string;
};

export type PlatformInviteSuperadminInput = {
  email?: unknown;
  actorUserId?: string;
  requestId?: string;
};

export type PlatformPromoteSuperadminInput = {
  userId?: unknown;
  actorUserId?: string;
  requestId?: string;
};
