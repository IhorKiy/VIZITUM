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

// The two presigned-URL request bodies that used to live here are now
// `CreatePresignedUrlDto` in storage.dto.ts — one class, since both routes
// take the same single field.

export type StorageCleanupResult = {
  scannedObjectCount: number;
  deletedObjectCount: number;
  failedObjectCount: number;
};
