import type { StorageObjectPurpose, StorageObjectStatus } from "@prisma/client";

export type StorageObjectResponse = {
  id: string;
  bucket: string;
  objectKey: string;
  purpose: StorageObjectPurpose;
  contentType: string;
  sizeBytes: string | null;
  checksum: string | null;
  status: StorageObjectStatus;
  expiresAt: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export type PresignedStorageUrlResponse = {
  url: string;
  method: "GET" | "PUT";
  expiresAt: string;
  headers: Record<string, string>;
};

export type CreatePresignedUploadUrlRequestBody = {
  expiresInSeconds?: unknown;
};

export type CreatePresignedDownloadUrlRequestBody = {
  expiresInSeconds?: unknown;
};

export type StorageCleanupResult = {
  scannedObjectCount: number;
  deletedObjectCount: number;
  failedObjectCount: number;
};
