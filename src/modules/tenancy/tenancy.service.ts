import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PlatformTenant } from "@prisma/client";

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

    this.assertTenantCanServeRequests(tenant);

    return { tenant, slug };
  }

  private assertTenantCanServeRequests(tenant: PlatformTenant): void {
    if (
      tenant.status === "pilot" ||
      tenant.status === "team" ||
      tenant.status === "business"
    ) {
      return;
    }

    if (tenant.status === "suspended" || tenant.status === "archived") {
      throw new ForbiddenException({
        code: "TENANT_UNAVAILABLE",
        message: "Tenant is not available.",
        details: { status: tenant.status },
      });
    }

    throw new ForbiddenException({
      code: "TENANT_NOT_READY",
      message: "Tenant is not ready to serve requests.",
      details: { status: tenant.status },
    });
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
