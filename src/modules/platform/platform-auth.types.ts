import type { PermissionCode } from "../roles/permissions";
import type { PlatformRoleCode } from "../roles/role-permission.matrix";

export const PLATFORM_OWNER_ROLE_CODE: PlatformRoleCode = "platform_owner";

export type PlatformLoginRequestBody = {
  email?: string;
  password?: string;
  captchaToken?: unknown;
};

export type PlatformSessionResponse = {
  platformUser: {
    id: string;
    email: string;
    name: string;
    status: string;
  };
  roleCodes: PlatformRoleCode[];
  permissions: PermissionCode[];
};
