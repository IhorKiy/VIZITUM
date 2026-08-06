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

/**
 * Whether `S3_ENDPOINT` is a value the storage client can actually use.
 *
 * `getConfig` checks the four S3 variables for presence only, and the endpoint
 * is not parsed until `buildObjectUrl` calls `new URL(config.endpoint)` on the
 * first upload. So a scheme-less value — `r2.example.com` instead of
 * `https://r2.example.com`, an ordinary paste error — boots green, passes
 * readiness and the alert check, and then 500s every audio and photo register
 * call with `TypeError: Invalid URL` (audit F2).
 *
 * Exported so the production boot gate in `auth/security-config.ts` can refuse
 * to start on it, with one definition of what a usable endpoint is rather than
 * a second opinion living next to the gate.
 *
 * The protocol check is the load-bearing half: `new URL` accepts `r2:example`
 * as a URL with the `r2:` protocol, so parsing alone would let a mistyped
 * endpoint through and fail later anyway.
 */
export function isUsableStorageEndpoint(value: string | undefined): boolean {
  const endpoint = value?.trim();

  if (!endpoint) {
    return false;
  }

  try {
    const parsed = new URL(endpoint);

    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
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
