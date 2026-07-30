import type { NavZone, RoleCode } from "@prisma/client";

import type { PermissionCode } from "../roles/permissions";

export type LoginRequestBody = {
  email?: unknown;
  password?: unknown;
  tenantSlug?: unknown;
};

export type SwitchRoleRequestBody = {
  roleCode?: unknown;
};

export type SwitchZoneRequestBody = {
  zone?: unknown;
};

export type AcceptInviteRequestBody = {
  token?: unknown;
  tenantSlug?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  password?: unknown;
  phone?: unknown;
};

export type AuthUserResponse = {
  id: string;
  email: string;
  firstName: string;
  // Null only on rows backfilled from a legacy one-word name.
  lastName: string | null;
  // Display value composed from the two above; see src/common/person-name.ts.
  name: string;
  status: string;
  lastSelectedRoleCode: RoleCode | null;
  lastSelectedZone: NavZone | null;
};

export type LoginResponse = {
  user: AuthUserResponse;
  roleCodes: RoleCode[];
  permissions: PermissionCode[];
};
