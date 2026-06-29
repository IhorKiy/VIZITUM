import { Injectable } from "@nestjs/common";
import type { RoleCode } from "@prisma/client";

import { type PermissionCode } from "./permissions";
import { ROLE_PERMISSION_MATRIX } from "./role-permission.matrix";

@Injectable()
export class RolesService {
  getPermissionsForRoles(roleCodes: readonly RoleCode[]): PermissionCode[] {
    const permissions = new Set<PermissionCode>();

    for (const roleCode of roleCodes) {
      for (const permission of ROLE_PERMISSION_MATRIX[roleCode]) {
        permissions.add(permission);
      }
    }

    return [...permissions];
  }

  hasPermission(
    roleCodes: readonly RoleCode[],
    requiredPermission: PermissionCode,
  ): boolean {
    return this.getPermissionsForRoles(roleCodes).includes(requiredPermission);
  }
}
