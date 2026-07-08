import { BadRequestException, Injectable } from "@nestjs/common";

import { normalizeTimezone } from "../../common/normalize";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import {
  PRODUCTS_ENABLED_SETTING_KEY,
  SUPPORTED_TENANT_LANGUAGES,
  type TenantLanguage,
  type TenantSettingsResponse,
  type UpdateTenantSettingsRequestBody,
} from "./settings.types";

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
      language: tenant.language,
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
    const language = normalizeLanguage(body.language);
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

    if (body.language !== undefined && language === null) {
      throw new BadRequestException({
        code: "SETTINGS_INVALID",
        message: "Language is not a supported UI language.",
        fieldErrors: {
          language: [
            `Choose one of: ${SUPPORTED_TENANT_LANGUAGES.join(", ")}.`,
          ],
        },
      });
    }

    if (body.productsEnabled !== undefined && productsEnabled === null) {
      throw new BadRequestException({
        code: "SETTINGS_INVALID",
        message: "Products enabled must be a boolean.",
        fieldErrors: { productsEnabled: ["Must be true or false."] },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.platformTenant.update({
        where: { id: context.tenantId },
        data: {
          ...(name ? { name } : {}),
          ...(timezone ? { timezone } : {}),
          ...(language ? { language } : {}),
        },
      });

      if (productsEnabled !== null && productsEnabled !== undefined) {
        await tx.tenantSetting.upsert({
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
    });

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

function normalizeLanguage(value: unknown): TenantLanguage | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return (
    SUPPORTED_TENANT_LANGUAGES.find((language) => language === normalized) ??
    null
  );
}

function normalizeProductsEnabled(value: unknown): boolean | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === "boolean" ? value : null;
}
