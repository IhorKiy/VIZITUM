import { SetMetadata } from "@nestjs/common";

import type { PermissionCode } from "../roles/permissions";

export const REQUIRED_PERMISSIONS_METADATA = "requiredPermissions";

export function RequirePermissions(...permissions: PermissionCode[]) {
  return SetMetadata(REQUIRED_PERMISSIONS_METADATA, permissions);
}
