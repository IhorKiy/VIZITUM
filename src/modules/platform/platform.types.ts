import { SegmentTemplate } from "@prisma/client";

import type { RequestOrigin } from "../../common/request-origin";

// The segment templates a new tenant may be created with — Prisma's own enum,
// read once here so the class-validator DTO in front of `POST /platform/tenants`
// and platform.service.ts gate on the same list rather than each building it.
export const SEGMENT_TEMPLATES = Object.values(SegmentTemplate);

// Every field optional, matching what createTenant actually accepts: it
// validates name, slug and segmentTemplate itself and answers TENANT_INVALID
// with a per-field error for each missing one. Typing the three as required
// described a call the endpoint never guaranteed — the request body is
// whatever the caller sent.
export type CreateTenantInput = {
  name?: string;
  slug?: string;
  country?: string;
  timezone?: string;
  language?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  phoneCountry?: string;
  segmentTemplate?: SegmentTemplate;
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
  // A plain string, not TenantStatus: updateTenant refuses anything outside
  // ASSIGNABLE_STATUSES with a message that explains *why* each excluded
  // status is excluded, which is worth more than a whitelist rejection, so
  // the DTO in front of this route does not narrow it either.
  status?: string;
  // A positive integer sets an explicit per-tenant override; null clears it so
  // the cap follows the plan tier again.
  adminLimit?: number | null;
  // Toggles the tenant's `products_enabled` setting (stored in tenantSetting,
  // not on the platformTenant row). Owner-only control over whether the tenant
  // tracks products/SKUs — it gates the admin "Products" nav area. `null` is
  // not "clear it" (there is nothing to clear), so updateTenant reports it as
  // a field error like any other non-boolean.
  productsEnabled?: boolean | null;
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
