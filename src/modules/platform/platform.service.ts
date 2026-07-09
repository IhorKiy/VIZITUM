import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RoleCode, SegmentTemplate, TenantStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { normalizeTimezone } from "../../common/normalize";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import { resolveInviteStatus, UsersService } from "../users/users.service";
import { adminCapForStatus, resolveAdminCap } from "../users/users.types";
import type { InviteHistoryItem, UserResponse } from "../users/users.types";
import { TEAM_MODE_CAPABILITIES } from "./product-capabilities";
import type {
  CreateTenantInput,
  PlatformInviteSuperadminInput,
  PlatformPromoteSuperadminInput,
  PlatformRequestPurgeInput,
  UpdateTenantInput,
} from "./platform.types";
import { MILLISECONDS_PER_DAY } from "../../common/time";
import {
  DEFAULT_TENANT_PURGE_RETENTION_DAYS,
  resolveTenantPurgeRetentionDays,
} from "./tenant-purge.service";

const DEFAULT_COUNTRY = "UA";
const DEFAULT_LANGUAGE = "uk";
// Resolved through the same canonicalization as any explicit input (see
// normalizeTimezone) so a tenant created without a timezone ends up with
// exactly the same stored value as one explicitly given "Europe/Kyiv" or its
// legacy "Europe/Kiev" alias — whichever this runtime's zone database
// canonicalizes to.
const DEFAULT_TIMEZONE = normalizeTimezone("Europe/Kyiv") ?? "Europe/Kiev";
const DEFAULT_DATABASE_KEY = "shared-primary";
const SEGMENT_TEMPLATES = Object.values(SegmentTemplate);
// Statuses a platform owner may set directly via update. `archived` is reserved
// for the dedicated archive endpoint so archiving always stamps `archivedAt`.
// `draft`/`provisioning`/`ready`/`active` are excluded too: tenants are created
// straight into `pilot` (see createTenant), status doubles as the plan tier
// (`pilot`/`team`/`business`) instead of a separate planCode field, and
// nothing advances a tenant through those four legacy states anymore.
const NON_ASSIGNABLE_STATUSES = new Set<TenantStatus>([
  "draft",
  "provisioning",
  "ready",
  "active",
  "archived",
]);
const ASSIGNABLE_STATUSES: TenantStatus[] = Object.values(TenantStatus).filter(
  (status) => !NON_ASSIGNABLE_STATUSES.has(status),
);

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  async listTenants() {
    const tenants = await this.prisma.platformTenant.findMany({
      orderBy: { createdAt: "desc" },
    });

    if (!tenants.length) {
      return [];
    }

    const tenantIds = tenants.map((tenant) => tenant.id);
    // Archived tenants can't be managed (see assertTenantCanManageUsers), so
    // their superadmin summary is always empty — skip querying for them.
    const manageableTenantIds = tenants
      .filter((tenant) => tenant.status !== "archived")
      .map((tenant) => tenant.id);
    const [
      roleCounts,
      visitCounts,
      productCounts,
      locationCounts,
      activeSuperadmins,
      pendingSuperadminInvites,
    ] = await Promise.all([
      this.prisma.userRole.groupBy({
        by: ["tenantId", "roleCode"],
        where: {
          tenantId: { in: tenantIds },
          user: { deletedAt: null },
        },
        _count: { _all: true },
      }),
      this.prisma.visit.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: tenantIds } },
        _count: { _all: true },
      }),
      this.prisma.product.groupBy({
        by: ["tenantId"],
        where: {
          tenantId: { in: tenantIds },
          deletedAt: null,
        },
        _count: { _all: true },
      }),
      this.prisma.location.groupBy({
        by: ["tenantId"],
        where: {
          tenantId: { in: tenantIds },
          deletedAt: null,
        },
        _count: { _all: true },
      }),
      manageableTenantIds.length
        ? this.prisma.user.findMany({
            where: {
              tenantId: { in: manageableTenantIds },
              status: "active",
              deletedAt: null,
              roles: { some: { roleCode: "tenant_superadmin" } },
            },
            include: { roles: true },
          })
        : Promise.resolve([]),
      manageableTenantIds.length
        ? this.prisma.invite.findMany({
            where: {
              tenantId: { in: manageableTenantIds },
              status: "pending",
              roleCodes: { has: "tenant_superadmin" },
            },
            include: {
              createdBy: { select: { id: true, email: true, name: true } },
              acceptedBy: { select: { id: true, email: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
    ]);

    const metricsByTenantId = new Map<
      string,
      {
        companyAdminCount: number;
        teamManagerCount: number;
        fieldRepresentativeCount: number;
        visitCount: number;
        productCount: number;
        locationCount: number;
      }
    >(
      tenantIds.map((tenantId) => [
        tenantId,
        {
          companyAdminCount: 0,
          teamManagerCount: 0,
          fieldRepresentativeCount: 0,
          visitCount: 0,
          productCount: 0,
          locationCount: 0,
        },
      ]),
    );

    for (const roleCount of roleCounts) {
      const metrics = metricsByTenantId.get(roleCount.tenantId);

      if (!metrics) {
        continue;
      }

      if (roleCount.roleCode === RoleCode.company_admin) {
        metrics.companyAdminCount = roleCount._count._all;
      }

      if (roleCount.roleCode === RoleCode.team_manager) {
        metrics.teamManagerCount = roleCount._count._all;
      }

      if (roleCount.roleCode === RoleCode.field_representative) {
        metrics.fieldRepresentativeCount = roleCount._count._all;
      }
    }

    for (const visitCount of visitCounts) {
      const metrics = metricsByTenantId.get(visitCount.tenantId);
      if (metrics) {
        metrics.visitCount = visitCount._count._all;
      }
    }

    for (const productCount of productCounts) {
      const metrics = metricsByTenantId.get(productCount.tenantId);
      if (metrics) {
        metrics.productCount = productCount._count._all;
      }
    }

    for (const locationCount of locationCounts) {
      const metrics = metricsByTenantId.get(locationCount.tenantId);
      if (metrics) {
        metrics.locationCount = locationCount._count._all;
      }
    }

    const retentionDays = this.resolveRetentionDaysForDisplay();

    const activeSuperadminByTenantId = new Map<
      string,
      (typeof activeSuperadmins)[number]
    >();
    for (const user of activeSuperadmins) {
      // Invariant: at most one active tenant_superadmin per tenant.
      activeSuperadminByTenantId.set(user.tenantId, user);
    }

    const pendingInviteByTenantId = new Map<
      string,
      (typeof pendingSuperadminInvites)[number]
    >();
    for (const invite of pendingSuperadminInvites) {
      // Already ordered by createdAt desc, so the first hit per tenant is the
      // most recent pending superadmin invite.
      if (!pendingInviteByTenantId.has(invite.tenantId)) {
        pendingInviteByTenantId.set(invite.tenantId, invite);
      }
    }

    return tenants.map((tenant) => ({
      ...withEffectiveAdminLimit(tenant),
      metrics: metricsByTenantId.get(tenant.id),
      // When the worker may purge this tenant on retention alone. Display
      // hint for the platform console — the worker recomputes eligibility
      // itself (including the purgeRequestedAt override) at run time.
      purgeEligibleAt:
        tenant.status === "archived" && tenant.archivedAt
          ? new Date(
              tenant.archivedAt.getTime() +
                retentionDays * MILLISECONDS_PER_DAY,
            )
          : null,
      superadmin:
        tenant.status === "archived"
          ? null
          : formatSuperadminSummary(
              activeSuperadminByTenantId.get(tenant.id) ?? null,
              pendingInviteByTenantId.get(tenant.id) ?? null,
            ),
    }));
  }

  // Unlike the worker (which refuses to run on a misconfigured retention
  // env var), the read-only console falls back to the default: showing an
  // approximate eligibility date is harmless, breaking the tenant list is
  // not — and nothing is deleted based on this value.
  private resolveRetentionDaysForDisplay(): number {
    try {
      return resolveTenantPurgeRetentionDays(
        process.env.TENANT_PURGE_RETENTION_DAYS,
      );
    } catch {
      return DEFAULT_TENANT_PURGE_RETENTION_DAYS;
    }
  }

  async getTenant(tenantId: string) {
    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException({
        code: "TENANT_NOT_FOUND",
        message: "Tenant was not found.",
      });
    }

    const provisioningJob = await this.prisma.platformProvisioningJob.findFirst(
      {
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      },
    );

    return { tenant: withEffectiveAdminLimit(tenant), provisioningJob };
  }

  async listTenantUsers(tenantId: string) {
    const tenant = await this.assertTenantCanManageUsers(tenantId);

    return this.usersService.listUsers(createPlatformTenantContext(tenant), {
      pageSize: 100,
    });
  }

  /**
   * Invites a tenant's first superadmin, or replaces the current one. Any
   * existing *pending* superadmin invite is revoked first, which collapses
   * "resend to the same person" and "send to a different person" into one
   * code path. A currently *active* superadmin (if any) is left untouched
   * until the new invite is accepted — see AuthService.acceptInvite for the
   * automatic demotion that happens at that point.
   */
  async inviteOrReplaceTenantSuperadmin(
    tenantId: string,
    input: PlatformInviteSuperadminInput,
  ) {
    const tenant = await this.assertTenantCanManageUsers(tenantId);

    await this.prisma.invite.updateMany({
      where: {
        tenantId,
        status: "pending",
        roleCodes: { has: "tenant_superadmin" },
      },
      data: { status: "revoked" },
    });

    const context = createPlatformTenantContext(tenant, input.requestId);
    const invite = await this.usersService.inviteSuperadmin(
      context,
      typeof input.email === "string" ? input.email : "",
    );

    await this.prisma.platformOperationEvent.create({
      data: {
        tenantId,
        actorUserId: input.actorUserId,
        eventType: "tenant.superadmin_invited",
        metadata: { email: invite.email, inviteId: invite.id },
        requestId: input.requestId,
      },
    });

    await this.auditService.recordEvent(context, {
      entityType: "user",
      entityId: invite.id,
      eventType: "superadmin.invited",
      metadata: { email: invite.email, actorPlatformUserId: input.actorUserId },
    });

    return invite;
  }

  /**
   * Bootstrap/migration path for tenants that already have Company Admins
   * but no superadmin yet: promotes an existing active Company Admin
   * in-place instead of going through an invite/accept cycle.
   */
  async promoteToSuperadmin(
    tenantId: string,
    input: PlatformPromoteSuperadminInput,
  ) {
    const userId = typeof input.userId === "string" ? input.userId : "";

    if (!userId) {
      throw new BadRequestException({
        code: "SUPERADMIN_CANDIDATE_INVALID",
        message: "A user id is required to promote a Company Admin.",
        fieldErrors: { userId: ["A user id is required."] },
      });
    }

    const tenant = await this.assertTenantCanManageUsers(tenantId);
    const context = createPlatformTenantContext(tenant, input.requestId);
    const promoted = await this.usersService.promoteToSuperadmin(
      context,
      userId,
    );

    await this.prisma.platformOperationEvent.create({
      data: {
        tenantId,
        actorUserId: input.actorUserId,
        eventType: "tenant.superadmin_promoted",
        metadata: { userId: promoted.id, email: promoted.email },
        requestId: input.requestId,
      },
    });

    await this.auditService.recordEvent(context, {
      entityType: "user",
      entityId: promoted.id,
      eventType: "superadmin.promoted",
      metadata: {
        email: promoted.email,
        actorPlatformUserId: input.actorUserId,
      },
    });

    return promoted;
  }

  async getTenantSuperadmin(tenantId: string): Promise<{
    activeSuperadmin: UserResponse | null;
    pendingInvite: InviteHistoryItem | null;
  }> {
    await this.assertTenantCanManageUsers(tenantId);

    const [activeSuperadmin, pendingInvite] = await Promise.all([
      this.prisma.user.findFirst({
        where: {
          tenantId,
          status: "active",
          deletedAt: null,
          roles: { some: { tenantId, roleCode: "tenant_superadmin" } },
        },
        include: { roles: true },
      }),
      this.prisma.invite.findFirst({
        where: {
          tenantId,
          status: "pending",
          roleCodes: { has: "tenant_superadmin" },
        },
        include: {
          createdBy: { select: { id: true, email: true, name: true } },
          acceptedBy: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return formatSuperadminSummary(activeSuperadmin, pendingInvite);
  }

  async updateTenant(tenantId: string, input: UpdateTenantInput) {
    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true },
    });

    if (!tenant) {
      throw new NotFoundException({
        code: "TENANT_NOT_FOUND",
        message: "Tenant was not found.",
      });
    }

    if (tenant.status === "archived") {
      throw new ConflictException({
        code: "TENANT_ARCHIVED",
        message: "An archived tenant cannot be updated.",
      });
    }

    const data: Prisma.PlatformTenantUpdateInput = {};
    const fieldErrors: Record<string, string[]> = {};

    if (input.name !== undefined) {
      const name = input.name.trim();

      if (!name) {
        fieldErrors.name = ["Tenant name cannot be empty."];
      } else {
        data.name = name;
      }
    }

    if (input.timezone !== undefined) {
      const timezone = normalizeTimezone(input.timezone);

      if (!timezone) {
        fieldErrors.timezone = ["Enter a valid IANA time zone."];
      } else {
        data.timezone = timezone;
      }
    }

    if (input.language !== undefined) {
      const language = input.language.trim();

      if (!language) {
        fieldErrors.language = ["Language cannot be empty."];
      } else {
        data.language = language;
      }
    }

    if (input.primaryDomain !== undefined) {
      data.primaryDomain = input.primaryDomain?.trim() || null;
    }

    if (input.status !== undefined) {
      if (!ASSIGNABLE_STATUSES.includes(input.status)) {
        fieldErrors.status = [
          "A valid status is required. Use the archive action to archive a tenant; draft, provisioning, ready and active cannot be assigned — status is the plan (pilot/team/business) or suspended.",
        ];
      } else {
        data.status = input.status;
      }
    }

    if (input.adminLimit !== undefined) {
      if (input.adminLimit === null) {
        // Clearing the override: the cap falls back to the plan-derived value.
        data.adminLimit = null;
      } else if (!Number.isInteger(input.adminLimit) || input.adminLimit < 1) {
        fieldErrors.adminLimit = [
          "Admin limit override must be a positive integer, or null to follow the plan.",
        ];
      } else {
        data.adminLimit = input.adminLimit;
      }
    }

    if (Object.keys(fieldErrors).length) {
      throw new BadRequestException({
        code: "TENANT_UPDATE_INVALID",
        message: "One or more tenant fields are invalid.",
        fieldErrors,
      });
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException({
        code: "TENANT_UPDATE_EMPTY",
        message: "No updatable fields were provided.",
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.platformTenant.update({
        where: { id: tenantId },
        data,
      });

      await tx.platformOperationEvent.create({
        data: {
          tenantId,
          actorUserId: input.actorUserId,
          eventType: "tenant.updated",
          metadata: { fields: Object.keys(data) },
          requestId: input.requestId,
        },
      });

      return withEffectiveAdminLimit(updated);
    });
  }

  private async assertTenantCanManageUsers(tenantId: string) {
    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, status: true },
    });

    if (!tenant) {
      throw new NotFoundException({
        code: "TENANT_NOT_FOUND",
        message: "Tenant was not found.",
      });
    }

    if (tenant.status === "archived") {
      throw new ConflictException({
        code: "TENANT_ARCHIVED",
        message: "An archived tenant cannot be managed.",
      });
    }

    return tenant;
  }

  async archiveTenant(
    tenantId: string,
    context: { actorUserId?: string; requestId?: string } = {},
  ) {
    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException({
        code: "TENANT_NOT_FOUND",
        message: "Tenant was not found.",
      });
    }

    // Idempotent: archiving an already-archived tenant is a no-op, not an error,
    // and must not emit a duplicate audit event.
    if (tenant.status === "archived") {
      return tenant;
    }

    return this.prisma.$transaction(async (tx) => {
      // Conditional on status still not being "archived": closes the race
      // between the check above and this write. If another request archived
      // the tenant concurrently, this matches zero rows and we fall through
      // to the idempotent no-op below instead of overwriting archivedAt or
      // emitting a duplicate tenant.archived event.
      const { count } = await tx.platformTenant.updateMany({
        where: { id: tenantId, status: { not: "archived" } },
        data: { status: "archived", archivedAt: new Date() },
      });

      const current = await tx.platformTenant.findUniqueOrThrow({
        where: { id: tenantId },
      });

      if (count === 0) {
        return current;
      }

      await tx.platformOperationEvent.create({
        data: {
          tenantId,
          actorUserId: context.actorUserId,
          eventType: "tenant.archived",
          metadata: { previousStatus: tenant.status },
          requestId: context.requestId,
        },
      });

      return current;
    });
  }

  async unarchiveTenant(
    tenantId: string,
    context: { actorUserId?: string; requestId?: string } = {},
  ) {
    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException({
        code: "TENANT_NOT_FOUND",
        message: "Tenant was not found.",
      });
    }

    // Idempotent, symmetric to archiveTenant: unarchiving a tenant that isn't
    // archived is a no-op, not an error, and must not emit a duplicate event.
    if (tenant.status !== "archived") {
      return tenant;
    }

    // Once the purge worker has stamped purgeStartedAt, data has (or may
    // have) already been destroyed — restoring the tenant would bring it
    // back half-visible. Until then, unarchive stays the rescue hatch even
    // for a tenant already marked for purge.
    if (tenant.purgeStartedAt) {
      throw new ConflictException({
        code: "TENANT_PURGE_IN_PROGRESS",
        message: "This tenant is being purged and can no longer be restored.",
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // Conditional on status still being "archived": closes the race between
      // the check above and this write. If another request already restored
      // the tenant concurrently, this matches zero rows and we fall through
      // to the idempotent no-op below instead of emitting a duplicate event.
      // Restored tenants land on `suspended` rather than their pre-archive
      // status: it keeps the tenant blocked from serving requests (see
      // tenancy.service.ts) until the platform owner deliberately reactivates
      // it, instead of silently resuming traffic to a tenant that was pulled
      // out of active management.
      // `purgeStartedAt: null` closes the same race against the purge
      // worker's claim; clearing `purgeRequestedAt` makes unarchive cancel a
      // pending early-purge request, so a rescued tenant is never purged.
      const { count } = await tx.platformTenant.updateMany({
        where: { id: tenantId, status: "archived", purgeStartedAt: null },
        data: {
          status: "suspended",
          archivedAt: null,
          purgeRequestedAt: null,
        },
      });

      const current = await tx.platformTenant.findUniqueOrThrow({
        where: { id: tenantId },
      });

      if (count === 0) {
        if (current.purgeStartedAt) {
          throw new ConflictException({
            code: "TENANT_PURGE_IN_PROGRESS",
            message:
              "This tenant is being purged and can no longer be restored.",
          });
        }

        return current;
      }

      await tx.platformOperationEvent.create({
        data: {
          tenantId,
          actorUserId: context.actorUserId,
          eventType: "tenant.unarchived",
          metadata: { restoredStatus: "suspended" },
          requestId: context.requestId,
        },
      });

      return current;
    });
  }

  /**
   * Marks an archived tenant for immediate purge by the worker. Deletes
   * nothing itself — the worker does the destructive work in batches on its
   * own schedule. Requires the caller to echo the tenant slug so a purge is
   * always a deliberate, tenant-specific act: a mistyped slug is a 4xx and
   * nothing happens. Idempotent and race-safe like archive/unarchive.
   * Until the worker actually starts, unarchive remains the rescue hatch
   * (it clears the mark).
   */
  async requestTenantPurge(tenantId: string, input: PlatformRequestPurgeInput) {
    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException({
        code: "TENANT_NOT_FOUND",
        message: "Tenant was not found.",
      });
    }

    const confirmSlug =
      typeof input.confirmSlug === "string"
        ? normalizeSlug(input.confirmSlug)
        : "";

    if (!confirmSlug || confirmSlug !== tenant.slug) {
      throw new BadRequestException({
        code: "TENANT_PURGE_CONFIRMATION_MISMATCH",
        message:
          "Purge confirmation does not match the tenant slug. Nothing was changed.",
        fieldErrors: {
          confirmSlug: ["Type the tenant slug exactly to confirm the purge."],
        },
      });
    }

    if (tenant.status !== "archived") {
      throw new ConflictException({
        code: "TENANT_NOT_ARCHIVED",
        message: "Only an archived tenant can be marked for purge.",
      });
    }

    // Idempotent: already marked for purge (or already being purged) is a
    // no-op, not an error, and must not emit a duplicate event.
    if (tenant.purgeRequestedAt || tenant.purgeStartedAt) {
      return tenant;
    }

    return this.prisma.$transaction(async (tx) => {
      // Conditional write closes the race with a concurrent purge request,
      // an unarchive (status no longer archived) or the purge worker's
      // claim: any of those makes this match zero rows and we fall through
      // to the idempotent no-op instead of emitting a duplicate event.
      const { count } = await tx.platformTenant.updateMany({
        where: {
          id: tenantId,
          status: "archived",
          purgeRequestedAt: null,
          purgeStartedAt: null,
        },
        data: { purgeRequestedAt: new Date() },
      });

      const current = await tx.platformTenant.findUniqueOrThrow({
        where: { id: tenantId },
      });

      if (count === 0) {
        return current;
      }

      await tx.platformOperationEvent.create({
        data: {
          tenantId,
          actorUserId: input.actorUserId,
          eventType: "tenant.purge_requested",
          metadata: { slug: tenant.slug, name: tenant.name },
          requestId: input.requestId,
        },
      });

      return current;
    });
  }

  async createTenant(input: CreateTenantInput) {
    const name = input.name?.trim();
    const slug = normalizeSlug(input.slug ?? "");
    const fieldErrors: Record<string, string[]> = {};

    if (!name) {
      fieldErrors.name = ["Tenant name is required."];
    }

    if (!slug) {
      fieldErrors.slug = ["Tenant slug is required."];
    }

    if (
      !input.segmentTemplate ||
      !SEGMENT_TEMPLATES.includes(input.segmentTemplate)
    ) {
      fieldErrors.segmentTemplate = ["A valid segment template is required."];
    }

    let timezone = DEFAULT_TIMEZONE;

    if (input.timezone !== undefined && input.timezone.trim()) {
      const normalized = normalizeTimezone(input.timezone);

      if (!normalized) {
        fieldErrors.timezone = ["Enter a valid IANA time zone."];
      } else {
        timezone = normalized;
      }
    }

    if (Object.keys(fieldErrors).length) {
      throw new BadRequestException({
        code: "TENANT_INVALID",
        message: "Tenant name, slug and segment template are required.",
        fieldErrors,
      });
    }

    const existingTenant = await this.prisma.platformTenant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (existingTenant) {
      throw new ConflictException({
        code: "TENANT_SLUG_ALREADY_EXISTS",
        message: "Tenant slug is already in use.",
        fieldErrors: {
          slug: ["Tenant slug is already in use."],
        },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.platformTenant.create({
        data: {
          name,
          slug,
          country: input.country?.trim() || DEFAULT_COUNTRY,
          timezone,
          language: input.language?.trim() || DEFAULT_LANGUAGE,
          segmentTemplate: input.segmentTemplate,
          databaseKey: DEFAULT_DATABASE_KEY,
          primaryDomain: input.primaryDomain?.trim() || null,
          // Tenants go live immediately: there is no per-tenant infrastructure
          // step behind draft/provisioning today, so parking new tenants there
          // just added a state a platform owner had to manually push through.
          // `pilot` also doubles as the starting plan tier (see NON_ASSIGNABLE_
          // STATUSES above) — the owner moves a tenant to `team`/`business` via
          // the same status update once it graduates off the pilot plan.
          status: "pilot",
          productMode: "team",
          databasePlacement: "shared",
        },
      });

      await tx.productCapability.createMany({
        data: TEAM_MODE_CAPABILITIES.map((capabilityCode) => ({
          tenantId: tenant.id,
          capabilityCode,
          enabled: true,
        })),
      });

      await tx.platformOperationEvent.create({
        data: {
          tenantId: tenant.id,
          actorUserId: input.actorUserId,
          eventType: "tenant.created",
          metadata: {
            productMode: tenant.productMode,
            segmentTemplate: tenant.segmentTemplate,
          },
          requestId: input.requestId,
        },
      });

      return { tenant: withEffectiveAdminLimit(tenant) };
    });
  }
}

function createPlatformTenantContext(
  tenant: { id: string; slug: string },
  requestId?: string,
): RequestContext {
  return {
    requestId: requestId ?? "platform",
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    roleCodes: [],
    permissions: [],
  };
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

// The persisted `adminLimit` column is the owner's optional override (NULL =
// follow the plan tier). API consumers want the effective cap, so expose that
// as `adminLimit` and surface the raw override separately as
// `adminLimitOverride` (so the console can tell a deliberate exception from the
// plan default and offer to clear it).
function withEffectiveAdminLimit<
  T extends { status: TenantStatus; adminLimit: number | null },
>(
  tenant: T,
): T & {
  adminLimit: number;
  adminLimitOverride: number | null;
  adminLimitPlanDefault: number;
} {
  return {
    ...tenant,
    adminLimit: resolveAdminCap(tenant),
    adminLimitOverride: tenant.adminLimit,
    adminLimitPlanDefault: adminCapForStatus(tenant.status),
  };
}

type SuperadminUserRecord = Prisma.UserGetPayload<{
  include: { roles: true };
}>;
type PendingSuperadminInviteRecord = Prisma.InviteGetPayload<{
  include: {
    createdBy: { select: { id: true; email: true; name: true } };
    acceptedBy: { select: { id: true; email: true; name: true } };
  };
}>;

function formatSuperadminSummary(
  activeSuperadmin: SuperadminUserRecord | null,
  pendingInvite: PendingSuperadminInviteRecord | null,
): {
  activeSuperadmin: UserResponse | null;
  pendingInvite: InviteHistoryItem | null;
} {
  // A row can still carry DB status "pending" past its expiresAt — nothing
  // transitions it until it's revoked or replaced — so without this check
  // the console would show an unusable, timed-out invite as an active
  // pending one.
  const isPendingInviteLive =
    pendingInvite &&
    resolveInviteStatus(pendingInvite.status, pendingInvite.expiresAt) ===
      "pending";

  return {
    activeSuperadmin: activeSuperadmin
      ? {
          id: activeSuperadmin.id,
          email: activeSuperadmin.email,
          name: activeSuperadmin.name,
          phone: activeSuperadmin.phone,
          status: activeSuperadmin.status,
          lastSelectedRoleCode: activeSuperadmin.lastSelectedRoleCode,
          roleCodes: activeSuperadmin.roles.map((role) => role.roleCode),
          createdAt: activeSuperadmin.createdAt.toISOString(),
          updatedAt: activeSuperadmin.updatedAt.toISOString(),
        }
      : null,
    pendingInvite:
      isPendingInviteLive && pendingInvite
        ? {
            id: pendingInvite.id,
            email: pendingInvite.email,
            roleCodes: pendingInvite.roleCodes,
            status: pendingInvite.status,
            expiresAt: pendingInvite.expiresAt.toISOString(),
            acceptedAt: pendingInvite.acceptedAt?.toISOString() ?? null,
            createdAt: pendingInvite.createdAt.toISOString(),
            createdBy: pendingInvite.createdBy,
            acceptedBy: pendingInvite.acceptedBy,
          }
        : null,
  };
}
