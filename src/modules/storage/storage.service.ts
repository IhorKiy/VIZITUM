import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, StorageObject } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { S3StorageClient } from "./s3-storage.client";
import { StorageConfigService } from "./storage.config";
import type {
  PresignedStorageUrlResponse,
  StorageCleanupResult,
  StorageObjectResponse,
} from "./storage.types";

// Storage objects that belong to a single visit and follow the visit's own
// read/update permissions rather than a settings- or import-scoped rule:
// the recorded voice note, its transcript, and the report's problem photo
// (`attachment`).
const VISIT_ARTIFACT_PURPOSES: string[] = [
  "temporary_audio",
  "temporary_transcript",
  "attachment",
];

const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
const MAX_SIGNED_URL_TTL_SECONDS = 900;
const CLEANUP_BATCH_SIZE = 100;

@Injectable()
export class StorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageConfig: StorageConfigService,
    private readonly s3Storage: S3StorageClient,
  ) {}

  getDefaultBucket(): string {
    return this.storageConfig.getDefaultBucket();
  }

  async getStorageObject(
    context: RequestContext,
    storageObjectId: string,
  ): Promise<StorageObjectResponse> {
    const storageObject = await this.findTenantStorageObject(
      context.tenantId,
      storageObjectId,
    );

    this.assertCanReadStorageObject(context, storageObject);

    return toStorageObjectResponse(storageObject);
  }

  async createPresignedUploadUrl(
    context: RequestContext,
    storageObjectId: string,
    expiresInSeconds?: number,
  ): Promise<PresignedStorageUrlResponse> {
    const storageObject = await this.findTenantStorageObject(
      context.tenantId,
      storageObjectId,
    );

    this.assertCanWriteStorageObject(context, storageObject);
    assertActiveStorageObject(storageObject);

    const signedUrl = this.s3Storage.createPresignedObjectUrl({
      bucket: storageObject.bucket,
      objectKey: storageObject.objectKey,
      method: "PUT",
      contentType: storageObject.contentType,
      expiresInSeconds: expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS,
    });

    return {
      url: signedUrl.url,
      method: "PUT",
      expiresAt: signedUrl.expiresAt.toISOString(),
      headers: signedUrl.headers,
    };
  }

  async createPresignedDownloadUrl(
    context: RequestContext,
    storageObjectId: string,
    expiresInSeconds?: number,
  ): Promise<PresignedStorageUrlResponse> {
    const storageObject = await this.findTenantStorageObject(
      context.tenantId,
      storageObjectId,
    );

    this.assertCanReadStorageObject(context, storageObject);
    assertActiveStorageObject(storageObject);

    const signedUrl = this.s3Storage.createPresignedObjectUrl({
      bucket: storageObject.bucket,
      objectKey: storageObject.objectKey,
      method: "GET",
      expiresInSeconds: expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS,
    });

    return {
      url: signedUrl.url,
      method: "GET",
      expiresAt: signedUrl.expiresAt.toISOString(),
      headers: signedUrl.headers,
    };
  }

  async cleanupExpiredTemporaryObjects(
    now = new Date(),
  ): Promise<StorageCleanupResult> {
    const expiredObjects = await this.prisma.storageObject.findMany({
      where: {
        status: "expired",
        deletedAt: null,
        expiresAt: { lte: now },
        purpose: { in: ["temporary_audio", "temporary_transcript"] },
      },
      orderBy: { expiresAt: "asc" },
      take: CLEANUP_BATCH_SIZE,
    });
    let deletedObjectCount = 0;
    let failedObjectCount = 0;

    for (const storageObject of expiredObjects) {
      try {
        await this.s3Storage.deleteObject(
          storageObject.bucket,
          storageObject.objectKey,
        );
        await this.prisma.storageObject.update({
          where: { id: storageObject.id },
          data: {
            status: "deleted",
            deletedAt: now,
          },
        });
        deletedObjectCount += 1;
      } catch {
        failedObjectCount += 1;
      }
    }

    return {
      scannedObjectCount: expiredObjects.length,
      deletedObjectCount,
      failedObjectCount,
    };
  }

  /**
   * Deletes every remote object a tenant still owns, marking each row
   * `deleted` only after its R2 delete succeeded — so a re-run (tenant
   * purge is crash-safe and re-runnable) skips rows whose object is
   * already gone and retries only real failures. Row deletion is the purge
   * worker's job (`TenantPurgeService`), not this method's: it runs before
   * any rows are removed because an orphaned R2 object is silent cost,
   * while a dangling DB row is recoverable.
   */
  async deleteAllTenantObjects(
    tenantId: string,
    now = new Date(),
  ): Promise<StorageCleanupResult> {
    let scannedObjectCount = 0;
    let deletedObjectCount = 0;
    let failedObjectCount = 0;
    // Manual id-cursor paging: each row is visited exactly once per run even
    // when deletes fail (a failed row keeps its status and would otherwise be
    // refetched forever by a status-filtered loop).
    let lastId = "";

    for (;;) {
      const objects = await this.prisma.storageObject.findMany({
        where: {
          tenantId,
          status: { not: "deleted" },
          id: { gt: lastId },
        },
        orderBy: { id: "asc" },
        take: CLEANUP_BATCH_SIZE,
      });

      if (!objects.length) {
        break;
      }

      lastId = objects[objects.length - 1].id;
      scannedObjectCount += objects.length;

      for (const storageObject of objects) {
        try {
          await this.s3Storage.deleteObject(
            storageObject.bucket,
            storageObject.objectKey,
          );
          await this.prisma.storageObject.update({
            where: { id: storageObject.id },
            data: { status: "deleted", deletedAt: now },
          });
          deletedObjectCount += 1;
        } catch {
          failedObjectCount += 1;
        }
      }
    }

    return { scannedObjectCount, deletedObjectCount, failedObjectCount };
  }

  private async findTenantStorageObject(
    tenantId: string,
    storageObjectId: string,
  ): Promise<StorageObject> {
    const normalizedId = normalizeId(storageObjectId);

    if (!normalizedId) {
      throw new BadRequestException({
        code: "STORAGE_OBJECT_INVALID",
        message: "Storage object id is required.",
      });
    }

    const storageObject = await this.prisma.storageObject.findFirst({
      where: {
        id: normalizedId,
        tenantId,
      },
    });

    if (!storageObject) {
      throw new NotFoundException({
        code: "STORAGE_OBJECT_NOT_FOUND",
        message: "Storage object was not found.",
      });
    }

    return storageObject;
  }

  private assertCanWriteStorageObject(
    context: RequestContext,
    storageObject: StorageObject,
  ): void {
    const canUploadImport =
      storageObject.purpose === "import_file" &&
      context.permissions.includes(PERMISSIONS.IMPORTS_UPLOAD);
    // `attachment` is the field report's problem photo: same owner-scoped rule
    // as the voice note it sits beside, since both are uploaded by the rep
    // while filling in one visit.
    const canUpdateOwnVisitArtifact =
      VISIT_ARTIFACT_PURPOSES.includes(storageObject.purpose) &&
      context.permissions.includes(PERMISSIONS.VISITS_UPDATE_OWN) &&
      (!storageObject.createdByUserId ||
        storageObject.createdByUserId === context.userId);
    const canManageBrandingLogo =
      storageObject.purpose === "branding_logo" &&
      context.permissions.includes(PERMISSIONS.TENANT_SETTINGS_MANAGE);

    if (
      !canUploadImport &&
      !canUpdateOwnVisitArtifact &&
      !canManageBrandingLogo
    ) {
      throwMissingStoragePermission();
    }
  }

  private assertCanReadStorageObject(
    context: RequestContext,
    storageObject: StorageObject,
  ): void {
    const canReadImport =
      storageObject.purpose === "import_file" &&
      context.permissions.includes(PERMISSIONS.IMPORTS_READ);
    const canReadOwnVisitArtifact =
      VISIT_ARTIFACT_PURPOSES.includes(storageObject.purpose) &&
      context.permissions.includes(PERMISSIONS.VISITS_READ_OWN) &&
      (!storageObject.createdByUserId ||
        storageObject.createdByUserId === context.userId);
    // A manager reviewing the report needs the photo too, exactly as they can
    // already reach the visit's audio.
    const canReadTeamVisitArtifact =
      VISIT_ARTIFACT_PURPOSES.includes(storageObject.purpose) &&
      context.permissions.includes(PERMISSIONS.VISITS_READ_TEAM);
    const canReadBrandingLogo =
      storageObject.purpose === "branding_logo" &&
      context.permissions.includes(PERMISSIONS.TENANT_SETTINGS_READ);

    if (
      !canReadImport &&
      !canReadOwnVisitArtifact &&
      !canReadTeamVisitArtifact &&
      !canReadBrandingLogo
    ) {
      throwMissingStoragePermission();
    }
  }
}

function normalizeId(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : undefined;
}

export function normalizeSignedUrlTtl(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsedValue = Number(value);

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue <= 0 ||
    parsedValue > MAX_SIGNED_URL_TTL_SECONDS
  ) {
    throw new BadRequestException({
      code: "SIGNED_URL_TTL_INVALID",
      message: "Signed URL TTL must be between 1 and 900 seconds.",
      fieldErrors: {
        expiresInSeconds: ["TTL must be between 1 and 900 seconds."],
      },
    });
  }

  return parsedValue;
}

function assertActiveStorageObject(storageObject: StorageObject): void {
  if (storageObject.status !== "active") {
    throw new BadRequestException({
      code: "STORAGE_OBJECT_NOT_ACTIVE",
      message: "Storage object is not active.",
    });
  }
}

function throwMissingStoragePermission(): never {
  throw new ForbiddenException({
    code: "MISSING_PERMISSION",
    message: "You do not have permission to access this storage object.",
  });
}

function toStorageObjectResponse(
  storageObject: Prisma.StorageObjectGetPayload<Record<string, never>>,
): StorageObjectResponse {
  return {
    id: storageObject.id,
    bucket: storageObject.bucket,
    objectKey: storageObject.objectKey,
    purpose: storageObject.purpose,
    contentType: storageObject.contentType,
    sizeBytes: storageObject.sizeBytes?.toString() ?? null,
    checksum: storageObject.checksum,
    status: storageObject.status,
    expiresAt: storageObject.expiresAt?.toISOString() ?? null,
    createdAt: storageObject.createdAt.toISOString(),
    deletedAt: storageObject.deletedAt?.toISOString() ?? null,
  };
}
