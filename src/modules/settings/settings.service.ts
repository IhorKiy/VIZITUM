import { BadRequestException, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type {
  TenantSettingsResponse,
  UpdateTenantSettingsRequestBody,
} from "./settings.types";

const PRODUCTS_ENABLED_SETTING_KEY = "products_enabled";

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(context: RequestContext): Promise<TenantSettingsResponse> {
    const [tenant, productsEnabledSetting] = await Promise.all([
      this.prisma.platformTenant.findUniqueOrThrow({
        where: { id: context.tenantId },
      }),
      this.prisma.tenantSetting.findUnique({
        where: {
          tenantId_key: {
            tenantId: context.tenantId,
            key: PRODUCTS_ENABLED_SETTING_KEY,
          },
        },
      }),
    ]);

    return {
      tenantId: tenant.id,
      name: tenant.name,
      timezone: tenant.timezone,
      productMode: tenant.productMode,
      productsEnabled: productsEnabledSetting
        ? productsEnabledSetting.value === true
        : true,
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }

  async updateSettings(
    context: RequestContext,
    body: UpdateTenantSettingsRequestBody,
  ): Promise<TenantSettingsResponse> {
    const name = normalizeName(body.name);
    const timezone = normalizeTimezone(body.timezone);
    const productsEnabled = normalizeProductsEnabled(body.productsEnabled);

    if (body.name !== undefined && name === null) {
      throw new BadRequestException({
        code: "SETTINGS_INVALID",
        message: "Company name must not be empty.",
        fieldErrors: { name: ["Company name is required."] },
      });
    }

    if (body.timezone !== undefined && timezone === null) {
      throw new BadRequestException({
        code: "SETTINGS_INVALID",
        message: "Timezone is not a recognized IANA time zone.",
        fieldErrors: { timezone: ["Enter a valid IANA time zone."] },
      });
    }

    if (body.productsEnabled !== undefined && productsEnabled === null) {
      throw new BadRequestException({
        code: "SETTINGS_INVALID",
        message: "Products enabled must be a boolean.",
        fieldErrors: { productsEnabled: ["Must be true or false."] },
      });
    }

    await this.prisma.platformTenant.update({
      where: { id: context.tenantId },
      data: {
        ...(name ? { name } : {}),
        ...(timezone ? { timezone } : {}),
      },
    });

    if (productsEnabled !== null && productsEnabled !== undefined) {
      await this.prisma.tenantSetting.upsert({
        where: {
          tenantId_key: {
            tenantId: context.tenantId,
            key: PRODUCTS_ENABLED_SETTING_KEY,
          },
        },
        create: {
          tenantId: context.tenantId,
          key: PRODUCTS_ENABLED_SETTING_KEY,
          value: productsEnabled,
          updatedByUserId: context.userId ?? null,
        },
        update: {
          value: productsEnabled,
          updatedByUserId: context.userId ?? null,
        },
      });
    }

    return this.getSettings(context);
  }
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

function normalizeTimezone(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });

    return trimmed;
  } catch {
    return null;
  }
}

function normalizeProductsEnabled(value: unknown): boolean | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === "boolean" ? value : null;
}
