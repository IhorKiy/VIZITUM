import type { NavZone, RoleCode } from "@prisma/client";

import type { PermissionCode } from "../roles/permissions";

export type LoginRequestBody = {
  email?: unknown;
  password?: unknown;
  tenantSlug?: unknown;
  captchaToken?: unknown;
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

export type ChangePasswordRequestBody = {
  currentPassword?: unknown;
  newPassword?: unknown;
};

export type ChangePasswordResponse = {
  ok: true;
  // How many *other* sessions were signed out. Surfaced so the confirmation
  // can tell the user their other devices were logged out, which is the
  // visible half of the security guarantee.
  revokedOtherSessions: number;
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
