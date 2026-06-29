import type { RoleCode, UserStatus } from "@prisma/client";

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

export type UpdateUserRequestBody = {
  name?: unknown;
  phone?: unknown;
  status?: unknown;
};

export type AddUserRoleRequestBody = {
  roleCode?: unknown;
};
