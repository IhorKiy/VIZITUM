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
import { UsersService } from "../users/users.service";
import type { InviteHistoryItem, UserResponse } from "../users/users.types";
import { TEAM_MODE_CAPABILITIES } from "./product-capabilities";
import type {
  CreateTenantInput,
  PlatformInviteSuperadminInput,
  PlatformPromoteSuperadminInput,
  UpdateTenantInput,
} from "./platform.types";

const DEFAULT_COUNTRY = "UA";
const DEFAULT_LANGUAGE = "uk";
const DEFAULT_TIMEZONE = "Europe/Kiev";
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
    const [roleCounts, visitCounts, productCounts, locationCounts] =
      await Promise.all([
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

    return tenants.map((tenant) => ({
      ...tenant,
      metrics: metricsByTenantId.get(tenant.id),
    }));
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

    return { tenant, provisioningJob };
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
      pendingInvite: pendingInvite
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
      if (!Number.isInteger(input.adminLimit) || input.adminLimit < 1) {
        fieldErrors.adminLimit = ["Admin limit must be a positive integer."];
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

      return updated;
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
      const { count } = await tx.platformTenant.updateMany({
        where: { id: tenantId, status: "archived" },
        data: { status: "suspended", archivedAt: null },
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
          eventType: "tenant.unarchived",
          metadata: { restoredStatus: "suspended" },
          requestId: context.requestId,
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

      return { tenant };
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
