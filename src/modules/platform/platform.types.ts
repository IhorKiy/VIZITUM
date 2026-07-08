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
  adminLimit?: number;
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
