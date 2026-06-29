import { SetMetadata } from "@nestjs/common";

import type { PermissionCode } from "../roles/permissions";

export const REQUIRED_PERMISSIONS_METADATA = "requiredPermissions";
export const REQUIRED_ANY_PERMISSIONS_METADATA = "requiredAnyPermissions";

export function RequirePermissions(...permissions: PermissionCode[]) {
  return SetMetadata(REQUIRED_PERMISSIONS_METADATA, permissions);
}

export function RequireAnyPermissions(...permissions: PermissionCode[]) {
  return SetMetadata(REQUIRED_ANY_PERMISSIONS_METADATA, permissions);
}
