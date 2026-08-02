import type { SegmentTemplate, TenantStatus } from "@prisma/client";

import type { RequestOrigin } from "../../common/request-origin";

export type CreateTenantInput = {
  name: string;
  slug: string;
  country?: string;
  timezone?: string;
  language?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  phoneCountry?: string;
  segmentTemplate: SegmentTemplate;
  primaryDomain?: string;
  actorUserId?: string;
  requestId?: string;
};

export type UpdateTenantInput = {
  name?: string;
  country?: string;
  timezone?: string;
  language?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  phoneCountry?: string;
  primaryDomain?: string | null;
  status?: TenantStatus;
  // A positive integer sets an explicit per-tenant override; null clears it so
  // the cap follows the plan tier again.
  adminLimit?: number | null;
  // Toggles the tenant's `products_enabled` setting (stored in tenantSetting,
  // not on the platformTenant row). Owner-only control over whether the tenant
  // tracks products/SKUs — it gates the admin "Products" nav area.
  productsEnabled?: boolean;
  actorUserId?: string;
  requestId?: string;
};

export type PlatformRequestPurgeInput = {
  confirmSlug?: unknown;
  // A code from the owner's authenticator, re-entered for this one action.
  // The slug echo proves the *right* tenant was chosen; this proves the person
  // choosing is still the one who signed in, on a session that lives for
  // twelve hours and can be left open on a borrowed machine.
  mfaCode?: unknown;
  actorUserId?: string;
  requestId?: string;
  // Extracted from the request by the controller, like `actorUserId` and
  // `requestId` are. A refused code here is credential traffic at an endpoint
  // that accepts a fresh TOTP code, so it is exactly what the trail's
  // direct-to-API measurement exists to see.
  origin?: RequestOrigin;
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
