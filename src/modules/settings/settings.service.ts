import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { StorageObject } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { normalizeTimezone } from "../../common/normalize";
import { PrismaService } from "../prisma/prisma.service";
import { S3StorageClient } from "../storage/s3-storage.client";
import { StorageService } from "../storage/storage.service";
import type { RequestContext } from "../tenancy/request-context";
import {
  BRANDING_COLOR_SCHEME_SETTING_KEY,
  BRANDING_LOGO_OBJECT_SETTING_KEY,
  colorSchemeFromSetting,
  logoObjectIdFromSetting,
  normalizeColorScheme,
  setLogoObjectSetting,
  TENANT_COLOR_SCHEMES,
  upsertColorSchemeSetting,
} from "./branding";
import {
  fieldReportVoiceHintFromSetting,
  MAX_FIELD_REPORT_VOICE_HINT_LENGTH,
  upsertFieldReportVoiceHintSetting,
} from "./field-report-voice-hint";
import {
  locationCategoriesEnabledFromSetting,
  upsertLocationCategoriesEnabledSetting,
} from "./location-categories-enabled";
import {
  productsEnabledFromSetting,
  upsertProductsEnabledSetting,
} from "./products-enabled";
import {
  FIELD_REPORT_VOICE_HINT_SETTING_KEY,
  LOCATION_CATEGORIES_ENABLED_SETTING_KEY,
  MAX_TENANT_NAME_LENGTH,
  PRODUCTS_ENABLED_SETTING_KEY,
  SUPPORTED_TENANT_LANGUAGES,
  type ConfirmLogoUploadRequestBody,
  type FieldReportVoiceHintResponse,
  type RegisteredLogoUploadResponse,
  type RegisterLogoUploadRequestBody,
  type TenantLanguage,
  type TenantLogoResponse,
  type TenantSettingsResponse,
  type UpdateTenantSettingsRequestBody,
} from "./settings.types";

export const MAX_BRANDING_LOGO_SIZE_BYTES = 1024 * 1024;

const SUPPORTED_LOGO_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService?: StorageService,
    private readonly s3Storage?: S3StorageClient,
  ) {}

  async getSettings(context: RequestContext): Promise<TenantSettingsResponse> {
    const [tenant, settings] = await Promise.all([
      this.prisma.platformTenant.findUniqueOrThrow({
        where: { id: context.tenantId },
      }),
      this.prisma.tenantSetting.findMany({
        where: {
          tenantId: context.tenantId,
          key: {
            in: [
              PRODUCTS_ENABLED_SETTING_KEY,
              LOCATION_CATEGORIES_ENABLED_SETTING_KEY,
              BRANDING_COLOR_SCHEME_SETTING_KEY,
              BRANDING_LOGO_OBJECT_SETTING_KEY,
              FIELD_REPORT_VOICE_HINT_SETTING_KEY,
            ],
          },
        },
      }),
    ]);

    const byKey = new Map(settings.map((setting) => [setting.key, setting]));

    return {
      tenantId: tenant.id,
      name: tenant.name,
      timezone: tenant.timezone,
      language: tenant.language,
      productMode: tenant.productMode,
      productsEnabled: productsEnabledFromSetting(
        byKey.get(PRODUCTS_ENABLED_SETTING_KEY),
      ),
      locationCategoriesEnabled: locationCategoriesEnabledFromSetting(
        byKey.get(LOCATION_CATEGORIES_ENABLED_SETTING_KEY),
      ),
      colorScheme: colorSchemeFromSetting(
        byKey.get(BRANDING_COLOR_SCHEME_SETTING_KEY),
      ),
      logo: await this.buildLogoResponse(
        context,
        logoObjectIdFromSetting(byKey.get(BRANDING_LOGO_OBJECT_SETTING_KEY)),
      ),
      fieldReportVoiceHint: fieldReportVoiceHintFromSetting(
        byKey.get(FIELD_REPORT_VOICE_HINT_SETTING_KEY),
      ),
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
    const locationCategoriesEnabled = normalizeLocationCategoriesEnabled(
      body.locationCategoriesEnabled,
    );
    const colorScheme = normalizeColorScheme(body.colorScheme);
    const fieldReportVoiceHint = normalizeFieldReportVoiceHint(
      body.fieldReportVoiceHint,
    );

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

    if (
      body.locationCategoriesEnabled !== undefined &&
      locationCategoriesEnabled === null
    ) {
      throw new BadRequestException({
        code: "SETTINGS_INVALID",
        message: "Location categories enabled must be a boolean.",
        fieldErrors: {
          locationCategoriesEnabled: ["Must be true or false."],
        },
      });
    }

    if (body.colorScheme !== undefined && colorScheme === null) {
      throw new BadRequestException({
        code: "SETTINGS_INVALID",
        message: "Color scheme is not a supported preset.",
        fieldErrors: {
          colorScheme: [`Choose one of: ${TENANT_COLOR_SCHEMES.join(", ")}.`],
        },
      });
    }

    if (
      body.fieldReportVoiceHint !== undefined &&
      fieldReportVoiceHint === false
    ) {
      throw new BadRequestException({
        code: "SETTINGS_INVALID",
        message: `Voice hint must be text up to ${MAX_FIELD_REPORT_VOICE_HINT_LENGTH} characters.`,
        fieldErrors: {
          fieldReportVoiceHint: [
            `Must be text up to ${MAX_FIELD_REPORT_VOICE_HINT_LENGTH} characters.`,
          ],
        },
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
        await upsertProductsEnabledSetting(
          tx,
          context.tenantId,
          productsEnabled,
          context.userId ?? null,
        );
      }

      if (
        locationCategoriesEnabled !== null &&
        locationCategoriesEnabled !== undefined
      ) {
        await upsertLocationCategoriesEnabledSetting(
          tx,
          context.tenantId,
          locationCategoriesEnabled,
          context.userId ?? null,
        );
      }

      if (colorScheme !== null && colorScheme !== undefined) {
        await upsertColorSchemeSetting(
          tx,
          context.tenantId,
          colorScheme,
          context.userId ?? null,
        );
      }

      if (
        fieldReportVoiceHint !== undefined &&
        fieldReportVoiceHint !== false
      ) {
        await upsertFieldReportVoiceHintSetting(
          tx,
          context.tenantId,
          fieldReportVoiceHint,
          context.userId ?? null,
        );
      }
    });

    return this.getSettings(context);
  }

  async getFieldReportVoiceHint(
    context: RequestContext,
  ): Promise<FieldReportVoiceHintResponse> {
    const setting = await this.prisma.tenantSetting.findUnique({
      where: {
        tenantId_key: {
          tenantId: context.tenantId,
          key: FIELD_REPORT_VOICE_HINT_SETTING_KEY,
        },
      },
    });

    return { voiceHint: fieldReportVoiceHintFromSetting(setting) };
  }

  async registerLogoUpload(
    context: RequestContext,
    body: RegisterLogoUploadRequestBody,
  ): Promise<RegisteredLogoUploadResponse> {
    const fileName = normalizeLogoFileName(body.fileName);
    const contentType = normalizeLogoContentType(body.contentType, fileName);
    const sizeBytes = normalizeLogoSizeBytes(body.sizeBytes);

    if (!fileName || !contentType) {
      throw new BadRequestException({
        code: "BRANDING_LOGO_INVALID",
        message: "Logo file name and supported content type are required.",
        fieldErrors: {
          fileName: fileName ? [] : ["File name is required."],
          contentType: contentType
            ? []
            : [
                "Supported image content type is required (PNG, JPEG, WebP or SVG).",
              ],
        },
      });
    }

    const objectKey = buildBrandingLogoObjectKey(context.tenantId, fileName);
    const currentLogoObjectId = logoObjectIdFromSetting(
      await this.prisma.tenantSetting.findUnique({
        where: {
          tenantId_key: {
            tenantId: context.tenantId,
            key: BRANDING_LOGO_OBJECT_SETTING_KEY,
          },
        },
      }),
    );

    const { storageObject, orphanedObjects } = await this.prisma.$transaction(
      async (tx) => {
        // Sweep leftovers from uploads that were registered but never
        // confirmed, so abandoned attempts don't accumulate in R2. The
        // currently referenced logo is untouched.
        const orphanedObjects = await tx.storageObject.findMany({
          where: {
            tenantId: context.tenantId,
            purpose: "branding_logo",
            status: "active",
            ...(currentLogoObjectId
              ? { id: { not: currentLogoObjectId } }
              : {}),
          },
        });

        if (orphanedObjects.length > 0) {
          await tx.storageObject.updateMany({
            where: { id: { in: orphanedObjects.map((object) => object.id) } },
            data: { status: "deleted", deletedAt: new Date() },
          });
        }

        const storageObject = await tx.storageObject.create({
          data: {
            tenantId: context.tenantId,
            bucket: this.storageService?.getDefaultBucket() ?? "vizitum",
            objectKey,
            purpose: "branding_logo",
            contentType,
            sizeBytes: BigInt(sizeBytes),
            status: "active",
            createdByUserId: context.userId ?? null,
          },
        });

        return { storageObject, orphanedObjects };
      },
    );

    await this.deleteRemoteObjects(orphanedObjects);

    const uploadUrl = this.storageService
      ? await this.storageService.createPresignedUploadUrl(
          context,
          storageObject.id,
        )
      : undefined;

    return {
      storageObject: {
        id: storageObject.id,
        bucket: storageObject.bucket,
        objectKey: storageObject.objectKey,
        contentType: storageObject.contentType,
        sizeBytes: storageObject.sizeBytes?.toString() ?? null,
      },
      ...(uploadUrl
        ? {
            uploadUrl: {
              url: uploadUrl.url,
              method: "PUT" as const,
              expiresAt: uploadUrl.expiresAt,
              headers: uploadUrl.headers,
            },
          }
        : {}),
    };
  }

  async confirmLogoUpload(
    context: RequestContext,
    body: ConfirmLogoUploadRequestBody,
  ): Promise<TenantSettingsResponse> {
    const storageObjectId =
      typeof body.storageObjectId === "string"
        ? body.storageObjectId.trim()
        : "";

    if (!storageObjectId) {
      throw new BadRequestException({
        code: "BRANDING_LOGO_INVALID",
        message: "Storage object id is required.",
        fieldErrors: { storageObjectId: ["Storage object id is required."] },
      });
    }

    const storageObject = await this.prisma.storageObject.findFirst({
      where: { id: storageObjectId, tenantId: context.tenantId },
    });

    if (!storageObject) {
      throw new NotFoundException({
        code: "STORAGE_OBJECT_NOT_FOUND",
        message: "Storage object was not found.",
      });
    }

    if (
      storageObject.purpose !== "branding_logo" ||
      storageObject.status !== "active"
    ) {
      throw new BadRequestException({
        code: "BRANDING_LOGO_INVALID",
        message: "Storage object is not an active branding logo.",
      });
    }

    const previousLogoObjectId = logoObjectIdFromSetting(
      await this.prisma.tenantSetting.findUnique({
        where: {
          tenantId_key: {
            tenantId: context.tenantId,
            key: BRANDING_LOGO_OBJECT_SETTING_KEY,
          },
        },
      }),
    );

    await this.prisma.$transaction(async (tx) => {
      await setLogoObjectSetting(
        tx,
        context.tenantId,
        storageObject.id,
        context.userId ?? null,
      );
    });

    if (previousLogoObjectId && previousLogoObjectId !== storageObject.id) {
      await this.deleteLogoObjectById(context.tenantId, previousLogoObjectId);
    }

    return this.getSettings(context);
  }

  async removeLogo(context: RequestContext): Promise<TenantSettingsResponse> {
    const logoObjectId = logoObjectIdFromSetting(
      await this.prisma.tenantSetting.findUnique({
        where: {
          tenantId_key: {
            tenantId: context.tenantId,
            key: BRANDING_LOGO_OBJECT_SETTING_KEY,
          },
        },
      }),
    );

    await this.prisma.$transaction(async (tx) => {
      await setLogoObjectSetting(
        tx,
        context.tenantId,
        null,
        context.userId ?? null,
      );
    });

    if (logoObjectId) {
      await this.deleteLogoObjectById(context.tenantId, logoObjectId);
    }

    return this.getSettings(context);
  }

  private async buildLogoResponse(
    context: RequestContext,
    logoObjectId: string | null,
  ): Promise<TenantLogoResponse | null> {
    if (!logoObjectId || !this.storageService) {
      return null;
    }

    const storageObject = await this.prisma.storageObject.findFirst({
      where: {
        id: logoObjectId,
        tenantId: context.tenantId,
        purpose: "branding_logo",
        status: "active",
      },
    });

    if (!storageObject) {
      return null;
    }

    const downloadUrl = await this.storageService.createPresignedDownloadUrl(
      context,
      storageObject.id,
    );

    return {
      storageObjectId: storageObject.id,
      contentType: storageObject.contentType,
      url: downloadUrl.url,
      urlExpiresAt: downloadUrl.expiresAt,
    };
  }

  // Best-effort R2 + row cleanup for a logo that is no longer referenced.
  // Failures are swallowed: a dangling remote object is silent cost, never a
  // correctness problem, and the next register sweep retries the row.
  private async deleteLogoObjectById(
    tenantId: string,
    storageObjectId: string,
  ): Promise<void> {
    const storageObject = await this.prisma.storageObject.findFirst({
      where: {
        id: storageObjectId,
        tenantId,
        purpose: "branding_logo",
        status: { not: "deleted" },
      },
    });

    if (!storageObject) {
      return;
    }

    try {
      await this.s3Storage?.deleteObject(
        storageObject.bucket,
        storageObject.objectKey,
      );
      await this.prisma.storageObject.update({
        where: { id: storageObject.id },
        data: { status: "deleted", deletedAt: new Date() },
      });
    } catch {
      // Retried by the next register sweep.
    }
  }

  private async deleteRemoteObjects(objects: StorageObject[]): Promise<void> {
    for (const storageObject of objects) {
      try {
        await this.s3Storage?.deleteObject(
          storageObject.bucket,
          storageObject.objectKey,
        );
      } catch {
        // Rows are already marked deleted; the remote object is silent cost.
      }
    }
  }
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 && trimmed.length <= MAX_TENANT_NAME_LENGTH
    ? trimmed
    : null;
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

function normalizeLocationCategoriesEnabled(
  value: unknown,
): boolean | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === "boolean" ? value : null;
}

// `false` marks an invalid value (wrong type / too long) — `null` is a valid
// "clear the hint" request, so it can't double as the error sentinel here.
function normalizeFieldReportVoiceHint(
  value: unknown,
): string | null | undefined | false {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();

  if (trimmed.length > MAX_FIELD_REPORT_VOICE_HINT_LENGTH) {
    return false;
  }

  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLogoFileName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return (
    trimmed
      .replaceAll("\\", "/")
      .split("/")
      .at(-1)
      ?.replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120) || null
  );
}

function normalizeLogoContentType(
  value: unknown,
  fileName?: string | null,
): string | null {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : null;

  if (normalized && SUPPORTED_LOGO_CONTENT_TYPES.has(normalized)) {
    return normalized;
  }

  return normalizeLogoContentTypeFromFileName(fileName);
}

function normalizeLogoContentTypeFromFileName(
  fileName: string | null | undefined,
): string | null {
  const extension = fileName?.split(".").pop()?.toLowerCase();

  if (extension === "png") {
    return "image/png";
  }

  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }

  if (extension === "webp") {
    return "image/webp";
  }

  if (extension === "svg") {
    return "image/svg+xml";
  }

  return null;
}

// Required, not optional: signed as the presigned PUT's Content-Length
// (s3-storage.client.ts), so a missing value is refused the same way an
// invalid one already was — see the audio/photo upload registrations for the
// same change.
function normalizeLogoSizeBytes(value: unknown): number {
  const parsedValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue <= 0 ||
    parsedValue > MAX_BRANDING_LOGO_SIZE_BYTES
  ) {
    throw new BadRequestException({
      code: "BRANDING_LOGO_SIZE_INVALID",
      message: "Logo size must be a positive integer up to 1 MB.",
      fieldErrors: {
        sizeBytes: ["Logo size must be a positive integer up to 1 MB."],
      },
    });
  }

  return parsedValue;
}

function buildBrandingLogoObjectKey(
  tenantId: string,
  fileName: string,
): string {
  return ["tenants", tenantId, "branding", "logo", randomUUID(), fileName].join(
    "/",
  );
}
