import type {
  InviteEmailStatus,
  RoleCode,
  TenantStatus,
  UserStatus,
} from "@prisma/client";

// The number of active Company Admins a tenant may have derives from its plan
// tier (PlatformTenant.status doubles as the plan). The platform owner manages
// only the superadmin; how many Company Admins the tenant superadmin can then
// invite is a function of the plan. Statuses not listed here are transient or
// legacy (draft/provisioning/ready/active/archived) and fall back to
// DEFAULT_ADMIN_LIMIT so a status we never planned around can't silently lock a
// live tenant to zero.
const ADMIN_CAP_BY_PLAN: Partial<Record<TenantStatus, number>> = {
  pilot: 0,
  team: 1,
  business: 2,
  suspended: 0,
};

// Fallback cap for tenants on a non-plan status, and the last-resort value when
// a tenant row can't be read. Kept as the historical default so behavior on
// legacy statuses doesn't regress. Shared so users.service.ts, auth.service.ts
// and platform.service.ts can't drift apart on what "no plan cap" means.
export const DEFAULT_ADMIN_LIMIT = 2;

// The cap implied by a tenant's plan tier alone, ignoring any owner override.
export function adminCapForStatus(status: TenantStatus): number {
  return ADMIN_CAP_BY_PLAN[status] ?? DEFAULT_ADMIN_LIMIT;
}

// The effective Company Admin cap for a tenant: the owner's explicit override
// when set, otherwise the plan-derived cap. `adminLimit` is NULL for every
// tenant that hasn't been given a per-tenant exception.
export function resolveAdminCap(tenant: {
  status: TenantStatus;
  adminLimit: number | null;
}): number {
  return tenant.adminLimit ?? adminCapForStatus(tenant.status);
}

export type UserResponse = {
  id: string;
  email: string;
  firstName: string;
  // Null only on rows backfilled from a legacy one-word name.
  lastName: string | null;
  // Display value composed from the two above; see src/common/person-name.ts.
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
  emailStatus: InviteEmailStatus;
  expiresAt: string;
  // Present only when the invite email was not delivered (`skipped` or
  // `failed`), where the copyable link is the invited person's only way in.
  // Absent on a successful send — see createInvite.
  token?: string;
};

export type InviteHistoryItem = {
  id: string;
  email: string;
  roleCodes: RoleCode[];
  status: string;
  emailStatus: InviteEmailStatus;
  emailSentAt: string | null;
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
  firstName?: unknown;
  lastName?: unknown;
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
