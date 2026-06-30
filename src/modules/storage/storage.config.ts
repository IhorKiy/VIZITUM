import { Injectable } from "@nestjs/common";

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

@Injectable()
export class StorageConfigService {
  getConfig(): StorageConfig {
    const endpoint = normalizeRequiredEnv("S3_ENDPOINT");
    const bucket = normalizeRequiredEnv("S3_BUCKET");
    const accessKeyId = normalizeRequiredEnv("S3_ACCESS_KEY_ID");
    const secretAccessKey = normalizeRequiredEnv("S3_SECRET_ACCESS_KEY");

    return {
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region: normalizeOptionalEnv("S3_REGION") ?? "auto",
      forcePathStyle: parseBooleanEnv("S3_FORCE_PATH_STYLE") ?? true,
    };
  }

  getDefaultBucket(): string {
    return normalizeOptionalEnv("S3_BUCKET") ?? "vizitum";
  }
}

function normalizeRequiredEnv(name: string): string {
  const value = normalizeOptionalEnv(name);

  if (!value) {
    throw new Error(`${name} is required for S3-compatible storage.`);
  }

  return value;
}

function normalizeOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value ? value : undefined;
}

function parseBooleanEnv(name: string): boolean | undefined {
  const value = normalizeOptionalEnv(name)?.toLowerCase();

  if (!value) {
    return undefined;
  }

  if (["1", "true", "yes"].includes(value)) {
    return true;
  }

  if (["0", "false", "no"].includes(value)) {
    return false;
  }

  throw new Error(`${name} must be a boolean value.`);
}
