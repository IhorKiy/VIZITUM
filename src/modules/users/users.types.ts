import type { RoleCode, UserStatus } from "@prisma/client";

// PlatformTenant.adminLimit is non-nullable with a DB default, but reads
// through a raw `select` (not the full row) come back typed as optional —
// this is the fallback for that case, shared so users.service.ts and
// auth.service.ts can't drift apart on what "no limit configured" means.
export const DEFAULT_ADMIN_LIMIT = 2;

export type UserResponse = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  status: UserStatus;
  lastSelectedRoleCode: RoleCode | null;
  roleCodes: RoleCode[];
  createdAt: string;
  updatedAt: string;
};

export type InviteUserRequestBody = {
  email?: unknown;
  roleCodes?: unknown;
};

export type InviteUserResponse = {
  id: string;
  email: string;
  roleCodes: RoleCode[];
  status: string;
  expiresAt: string;
  token: string;
};

export type InviteHistoryItem = {
  id: string;
  email: string;
  roleCodes: RoleCode[];
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  acceptedBy: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type UpdateUserRequestBody = {
  name?: unknown;
  phone?: unknown;
  status?: unknown;
};

export type AddUserRoleRequestBody = {
  roleCode?: unknown;
};

export type DeleteUserResponse = {
  id: string;
  status: "deleted";
};
