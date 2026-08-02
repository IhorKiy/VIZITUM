import type { TenantStatus } from "@prisma/client";

// The statuses under which a tenant answers requests — the three plan tiers.
// Everything else is a tenant that must not be served: `draft`/`provisioning`/
// `ready`/`active` are not yet (or no longer) a plan, `suspended` is a
// deliberate block, and `archived` is on its way to purge.
//
// Shared rather than inlined because two places have to agree on it: the
// login-time resolution in `tenancy.service.ts` and the per-request check in
// `PermissionGuard`. They were out of step — login enforced the status and
// nothing revalidated it afterwards, so a session opened before a suspension
// kept full access until it expired.
const SERVING_TENANT_STATUSES: readonly TenantStatus[] = [
  "pilot",
  "team",
  "business",
];

export function canTenantServeRequests(status: TenantStatus): boolean {
  return SERVING_TENANT_STATUSES.includes(status);
}
