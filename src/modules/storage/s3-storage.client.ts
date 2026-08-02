import { Injectable } from "@nestjs/common";
import { createHash, createHmac } from "node:crypto";

import { StorageConfigService, type StorageConfig } from "./storage.config";

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export type PresignedObjectUrlInput = {
  bucket: string;
  objectKey: string;
  method: "GET" | "PUT" | "DELETE";
  expiresInSeconds: number;
  contentType?: string;
};

export type PresignedObjectUrl = {
  url: string;
  method: "GET" | "PUT" | "DELETE";
  expiresAt: Date;
  headers: Record<string, string>;
};

@Injectable()
export class S3StorageClient {
  constructor(private readonly storageConfig: StorageConfigService) {}

  createPresignedObjectUrl(input: PresignedObjectUrlInput): PresignedObjectUrl {
    const config = this.storageConfig.getConfig();
    const now = new Date();
    const expiresInSeconds = clampExpiresInSeconds(input.expiresInSeconds);
    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
    const baseUrl = buildObjectUrl(config, input.bucket, input.objectKey);
    const headers = buildSignedHeaders(baseUrl, input);
    const signedHeaderNames = Object.keys(headers).sort();
    const queryParams = new URLSearchParams({
      "X-Amz-Algorithm": ALGORITHM,
      "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresInSeconds),
      "X-Amz-SignedHeaders": signedHeaderNames.join(";"),
    });
    const canonicalRequest = [
      input.method,
      encodePathname(baseUrl.pathname),
      canonicalQueryString(queryParams),
      canonicalHeaders(headers),
      signedHeaderNames.join(";"),
      UNSIGNED_PAYLOAD,
    ].join("\n");
    const stringToSign = [
      ALGORITHM,
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = hmacHex(
      getSigningKey(config.secretAccessKey, dateStamp, config.region, SERVICE),
      stringToSign,
    );

    queryParams.set("X-Amz-Signature", signature);
    baseUrl.search = canonicalQueryString(queryParams);

    return {
      url: baseUrl.toString(),
      method: input.method,
      expiresAt,
      headers: omitHostHeader(headers),
    };
  }

  async deleteObject(bucket: string, objectKey: string): Promise<void> {
    const signedUrl = this.createPresignedObjectUrl({
      bucket,
      objectKey,
      method: "DELETE",
      expiresInSeconds: 60,
    });
    const response = await fetch(signedUrl.url, {
      method: "DELETE",
      headers: signedUrl.headers,
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(
        `S3 delete failed with status ${response.status} ${response.statusText}.`,
      );
    }
  }

  // Server-side download used by the field-report transcription flow: the
  // audio itself already reached storage via a client-side presigned PUT
  // (see visits.controller.ts's notes/audio/register), so this is a
  // short-lived signed GET the backend follows itself to hand the bytes to
  // the transcription client — never a second client-facing hop.
  //
  // `maxBytes` is required rather than optional because this method buffers
  // the whole object into memory. The size a client declared at registration
  // bounds nothing on its own — the presigned PUT does not sign
  // `Content-Length`, so the object can be arbitrarily larger than the number
  // that was validated. Checking the length the store reports, before any of
  // it is read, is what keeps an oversized upload from becoming an
  // out-of-memory kill and an unbounded transcription bill.
  async downloadObject(
    bucket: string,
    objectKey: string,
    options: { maxBytes: number },
  ): Promise<Buffer> {
    const signedUrl = this.createPresignedObjectUrl({
      bucket,
      objectKey,
      method: "GET",
      expiresInSeconds: 60,
    });
    const response = await fetch(signedUrl.url, {
      headers: signedUrl.headers,
    });

    if (!response.ok) {
      throw new Error(
        `S3 download failed with status ${response.status} ${response.statusText}.`,
      );
    }

    const contentLength = parseContentLength(
      response.headers.get("content-length"),
    );

    // An absent or unparseable length is refused rather than read
    // optimistically: S3 and R2 both send one on a whole-object GET, so its
    // absence means this is not the response we think it is, and reading it
    // would be reading an object of unknown size.
    if (contentLength === null) {
      await cancelBody(response);

      throw new Error("S3 download refused: object size was not reported.");
    }

    if (contentLength > options.maxBytes) {
      await cancelBody(response);

      throw new Error(
        `S3 download refused: object is ${contentLength} bytes, over the ${options.maxBytes} byte limit.`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();

    return Buffer.from(arrayBuffer);
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

// Releases the connection instead of leaving an unread body dangling. A
// failure to cancel must not mask the refusal that is being thrown.
async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ignored on purpose.
  }
}

function buildSignedHeaders(
  objectUrl: URL,
  input: PresignedObjectUrlInput,
): Record<string, string> {
  const headers: Record<string, string> = {
    host: objectUrl.host,
  };

  if (input.method === "PUT" && input.contentType) {
    headers["content-type"] = input.contentType;
  }

  return headers;
}

function buildObjectUrl(
  config: StorageConfig,
  bucket: string,
  objectKey: string,
): URL {
  const endpoint = new URL(config.endpoint);
  const normalizedKey = objectKey
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");

  if (config.forcePathStyle) {
    endpoint.pathname = joinUrlPath(endpoint.pathname, bucket, normalizedKey);
    return endpoint;
  }

  endpoint.hostname = `${bucket}.${endpoint.hostname}`;
  endpoint.pathname = joinUrlPath(endpoint.pathname, normalizedKey);

  return endpoint;
}

function joinUrlPath(...parts: string[]): string {
  return `/${parts
    .flatMap((part) => part.split("/"))
    .filter((part) => part.length > 0)
    .join("/")}`;
}

function encodePathname(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join("/");
}

function canonicalQueryString(queryParams: URLSearchParams): string {
  return [...queryParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join("&");
}

function canonicalHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key.toLowerCase()}:${value.trim()}\n`)
    .join("");
}

function omitHostHeader(
  headers: Record<string, string>,
): Record<string, string> {
  const result = { ...headers };
  delete result.host;

  return result;
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacHex(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function getSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const dateRegionKey = hmac(dateKey, region);
  const dateRegionServiceKey = hmac(dateRegionKey, service);

  return hmac(dateRegionServiceKey, "aws4_request");
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function clampExpiresInSeconds(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    return 300;
  }

  return Math.min(value, 900);
}
