import type { SegmentTemplate, TenantStatus } from "@prisma/client";
import type { UserStatus } from "@prisma/client";
import type { InviteUserRequestBody } from "../users/users.types";

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
  actorUserId?: string;
  requestId?: string;
};

export type PlatformInviteTenantUserInput = InviteUserRequestBody & {
  actorUserId?: string;
  requestId?: string;
};

export type PlatformUpdateTenantAdminStatusInput = {
  status: UserStatus;
  actorUserId?: string;
  requestId?: string;
};
