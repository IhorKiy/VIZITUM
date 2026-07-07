import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  PlanCode,
  RoleCode,
  SegmentTemplate,
  TenantStatus,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { SessionService } from "../auth/session.service";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import { UsersService } from "../users/users.service";
import { TEAM_MODE_CAPABILITIES } from "./product-capabilities";
import type {
  CreateTenantInput,
  PlatformInviteTenantUserInput,
  PlatformUpdateTenantAdminStatusInput,
  UpdateTenantInput,
} from "./platform.types";

const DEFAULT_COUNTRY = "UA";
const DEFAULT_LANGUAGE = "uk";
const DEFAULT_TIMEZONE = "Europe/Kiev";
const DEFAULT_DATABASE_KEY = "shared-primary";
const SEGMENT_TEMPLATES = Object.values(SegmentTemplate);
const PLAN_CODES = Object.values(PlanCode);
// Statuses a platform owner may set directly via update. `archived` is reserved
// for the dedicated archive endpoint so archiving always stamps `archivedAt`.
const ASSIGNABLE_STATUSES: TenantStatus[] = Object.values(TenantStatus).filter(
  (status) => status !== "archived",
);
const PLATFORM_INVITE_ROLE_CODES = ["company_admin"];

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
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

  async inviteTenantUser(
    tenantId: string,
    input: PlatformInviteTenantUserInput,
  ) {
    if (!isCompanyAdminOnlyInvite(input.roleCodes)) {
      throw new BadRequestException({
        code: "PLATFORM_INVITE_ROLE_INVALID",
        message: "Platform tenant invites can only create Company Admins.",
        fieldErrors: {
          roleCodes: ["Only the company_admin role is allowed."],
        },
      });
    }

    const tenant = await this.assertTenantCanManageUsers(tenantId);
    const invite = await this.usersService.inviteUser(
      createPlatformTenantContext(tenant),
      { ...input, roleCodes: PLATFORM_INVITE_ROLE_CODES },
    );

    await this.prisma.platformOperationEvent.create({
      data: {
        tenantId,
        actorUserId: input.actorUserId,
        eventType: "tenant.user_invited",
        metadata: {
          email: invite.email,
          inviteId: invite.id,
          roleCodes: invite.roleCodes,
        },
        requestId: input.requestId,
      },
    });

    return invite;
  }

  async updateTenantAdminStatus(
    tenantId: string,
    userId: string,
    input: PlatformUpdateTenantAdminStatusInput,
  ) {
    if (input.status !== "active" && input.status !== "suspended") {
      throw new BadRequestException({
        code: "PLATFORM_ADMIN_STATUS_INVALID",
        message: "A valid Company Admin status is required.",
        fieldErrors: {
          status: ["Use active or suspended."],
        },
      });
    }

    const tenant = await this.assertTenantCanManageUsers(tenantId);
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
      },
      include: { roles: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "User was not found.",
      });
    }

    if (!user.roles.some((role) => role.roleCode === "company_admin")) {
      throw new BadRequestException({
        code: "PLATFORM_ADMIN_ROLE_REQUIRED",
        message: "Only Company Admin users can be managed here.",
      });
    }

    const previousStatus = user.status;
    const updatedUser = await this.usersService.updateUser(
      createPlatformTenantContext(tenant),
      userId,
      { status: input.status },
    );

    if (input.status === "suspended") {
      await this.sessionService.revokeUserSessions(tenantId, userId);
    }

    await this.prisma.platformOperationEvent.create({
      data: {
        tenantId,
        actorUserId: input.actorUserId,
        eventType:
          input.status === "suspended"
            ? "tenant.admin_suspended"
            : "tenant.admin_reactivated",
        metadata: {
          userId,
          email: updatedUser.email,
          previousStatus,
          status: updatedUser.status,
        },
        requestId: input.requestId,
      },
    });

    return updatedUser;
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
      const timezone = input.timezone.trim();

      if (!timezone) {
        fieldErrors.timezone = ["Timezone cannot be empty."];
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

    if (input.planCode !== undefined) {
      if (!PLAN_CODES.includes(input.planCode)) {
        fieldErrors.planCode = ["A valid plan code is required."];
      } else {
        data.planCode = input.planCode;
      }
    }

    if (input.status !== undefined) {
      if (!ASSIGNABLE_STATUSES.includes(input.status)) {
        fieldErrors.status = [
          "A valid status is required. Use the archive action to archive a tenant.",
        ];
      } else {
        data.status = input.status;
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
      select: { id: true, status: true, archivedAt: true },
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
      return this.prisma.platformTenant.findUniqueOrThrow({
        where: { id: tenantId },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const archived = await tx.platformTenant.update({
        where: { id: tenantId },
        data: { status: "archived", archivedAt: new Date() },
      });

      await tx.platformOperationEvent.create({
        data: {
          tenantId,
          actorUserId: context.actorUserId,
          eventType: "tenant.archived",
          metadata: { previousStatus: tenant.status },
          requestId: context.requestId,
        },
      });

      return archived;
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
          timezone: input.timezone?.trim() || DEFAULT_TIMEZONE,
          language: input.language?.trim() || DEFAULT_LANGUAGE,
          segmentTemplate: input.segmentTemplate,
          databaseKey: DEFAULT_DATABASE_KEY,
          primaryDomain: input.primaryDomain?.trim() || null,
          status: "draft",
          planCode: "pilot",
          productMode: "team",
          databasePlacement: "shared",
        },
      });

      const provisioningJob = await tx.platformProvisioningJob.create({
        data: {
          tenantId: tenant.id,
          status: "queued",
          step: "tenant_created",
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
            provisioningJobId: provisioningJob.id,
            productMode: tenant.productMode,
            planCode: tenant.planCode,
            segmentTemplate: tenant.segmentTemplate,
          },
          requestId: input.requestId,
        },
      });

      return { tenant, provisioningJob };
    });
  }
}

function createPlatformTenantContext(tenant: {
  id: string;
  slug: string;
}): RequestContext {
  return {
    requestId: "platform",
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    roleCodes: [],
    permissions: [],
  };
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

function isCompanyAdminOnlyInvite(roleCodes: unknown): boolean {
  return (
    Array.isArray(roleCodes) &&
    roleCodes.length === 1 &&
    roleCodes[0] === "company_admin"
  );
}
