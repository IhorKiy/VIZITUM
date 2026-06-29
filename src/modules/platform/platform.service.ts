import { ConflictException, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { TEAM_MODE_CAPABILITIES } from "./product-capabilities";
import type { CreateTenantInput } from "./platform.types";

const DEFAULT_COUNTRY = "UA";
const DEFAULT_LANGUAGE = "uk";
const DEFAULT_TIMEZONE = "Europe/Kiev";
const DEFAULT_DATABASE_KEY = "shared-primary";

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async createTenant(input: CreateTenantInput) {
    const slug = normalizeSlug(input.slug);
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
          name: input.name.trim(),
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

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}
