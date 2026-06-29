import { Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type {
  TenantResolutionInput,
  TenantResolutionResult,
} from "./tenant-resolution.types";

@Injectable()
export class TenancyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveTenant(
    input: TenantResolutionInput,
  ): Promise<TenantResolutionResult> {
    const slug = this.extractTenantSlug(input);

    if (!slug) {
      throw new NotFoundException({
        code: "TENANT_NOT_FOUND",
        message: "Tenant could not be resolved.",
      });
    }

    const tenant = await this.prisma.platformTenant.findUnique({
      where: { slug },
    });

    if (!tenant) {
      throw new NotFoundException({
        code: "TENANT_NOT_FOUND",
        message: "Tenant could not be resolved.",
      });
    }

    return { tenant, slug };
  }

  private extractTenantSlug(input: TenantResolutionInput): string | null {
    const pathSlug = input.path?.split("/").filter(Boolean)[0];

    if (pathSlug && pathSlug !== "api") {
      return normalizeSlug(pathSlug);
    }

    const host = input.host?.split(":")[0];
    const hostParts = host?.split(".").filter(Boolean) ?? [];

    if (hostParts.length > 2) {
      return normalizeSlug(hostParts[0]);
    }

    return null;
  }
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}
