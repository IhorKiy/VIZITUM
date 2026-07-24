import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PlatformTenant } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { readBrandingSettings } from "../settings/branding";
import { S3StorageClient } from "../storage/s3-storage.client";
import type {
  PublicTenantBranding,
  PublicTenantLocale,
  TenantResolutionInput,
  TenantResolutionResult,
} from "./tenant-resolution.types";

// The pre-auth login page renders with `cache: "no-store"`, so every render
// mints a fresh logo URL; the long TTL only has to survive a slow page load.
const PUBLIC_LOGO_URL_TTL_SECONDS = 900;

@Injectable()
export class TenancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Storage?: S3StorageClient,
  ) {}

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

  async getPublicTenantLocale(slug: string): Promise<PublicTenantLocale> {
    const normalizedSlug = normalizeSlug(slug);
    const tenant = normalizedSlug
      ? await this.prisma.platformTenant.findUnique({
          where: { slug: normalizedSlug },
          select: {
            slug: true,
            language: true,
            timezone: true,
            phoneCountry: true,
          },
        })
      : null;

    if (!tenant) {
      throw new NotFoundException({
        code: "TENANT_NOT_FOUND",
        message: "Tenant could not be resolved.",
      });
    }

    return {
      slug: tenant.slug,
      language: tenant.language,
      timezone: tenant.timezone,
      phoneCountry: tenant.phoneCountry,
    };
  }

  // Deliberately as permissive as getPublicTenantLocale: no status gating, so
  // even a suspended/archived tenant's login page renders with its branding.
  async getPublicTenantBranding(slug: string): Promise<PublicTenantBranding> {
    const normalizedSlug = normalizeSlug(slug);
    const tenant = normalizedSlug
      ? await this.prisma.platformTenant.findUnique({
          where: { slug: normalizedSlug },
          select: { id: true, slug: true },
        })
      : null;

    if (!tenant) {
      throw new NotFoundException({
        code: "TENANT_NOT_FOUND",
        message: "Tenant could not be resolved.",
      });
    }

    const branding = await readBrandingSettings(this.prisma, tenant.id);

    return {
      slug: tenant.slug,
      colorScheme: branding.colorScheme,
      logoUrl: await this.buildPublicLogoUrl(tenant.id, branding.logoObjectId),
    };
  }

  private async buildPublicLogoUrl(
    tenantId: string,
    logoObjectId: string | null,
  ): Promise<string | null> {
    if (!logoObjectId || !this.s3Storage) {
      return null;
    }

    const storageObject = await this.prisma.storageObject.findFirst({
      where: {
        id: logoObjectId,
        tenantId,
        purpose: "branding_logo",
        status: "active",
      },
      select: { bucket: true, objectKey: true },
    });

    if (!storageObject) {
      return null;
    }

    return this.s3Storage.createPresignedObjectUrl({
      bucket: storageObject.bucket,
      objectKey: storageObject.objectKey,
      method: "GET",
      expiresInSeconds: PUBLIC_LOGO_URL_TTL_SECONDS,
    }).url;
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
