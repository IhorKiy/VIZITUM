import type { RoleCode } from "@prisma/client";

import type { PermissionCode } from "../roles/permissions";

export type LoginRequestBody = {
  email?: unknown;
  password?: unknown;
  tenantSlug?: unknown;
};

export type SwitchRoleRequestBody = {
  roleCode?: unknown;
};

export type AcceptInviteRequestBody = {
  token?: unknown;
  name?: unknown;
  password?: unknown;
  phone?: unknown;
};

export type AuthUserResponse = {
  id: string;
  email: string;
  name: string;
  status: string;
  lastSelectedRoleCode: RoleCode | null;
};

export type LoginResponse = {
  user: AuthUserResponse;
  roleCodes: RoleCode[];
  permissions: PermissionCode[];
};
