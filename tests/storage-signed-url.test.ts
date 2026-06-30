import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { S3StorageClient } from "../src/modules/storage/s3-storage.client";

describe("S3 storage client", () => {
  it("creates short-lived R2-compatible presigned PUT URLs", () => {
    const client = new S3StorageClient({
      getConfig: () => ({
        endpoint: "https://account-id.r2.cloudflarestorage.com",
        region: "auto",
        bucket: "vizitum",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        forcePathStyle: true,
      }),
      getDefaultBucket: () => "vizitum",
    });

    const signedUrl = client.createPresignedObjectUrl({
      bucket: "vizitum",
      objectKey: "tenants/tenant-a/tmp/audio/file.webm",
      method: "PUT",
      contentType: "audio/webm",
      expiresInSeconds: 120,
    });
    const url = new URL(signedUrl.url);

    assert.equal(signedUrl.method, "PUT");
    assert.equal(url.hostname, "account-id.r2.cloudflarestorage.com");
    assert.equal(url.pathname, "/vizitum/tenants/tenant-a/tmp/audio/file.webm");
    assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.equal(url.searchParams.get("X-Amz-Expires"), "120");
    assert.equal(
      url.searchParams.get("X-Amz-SignedHeaders"),
      "content-type;host",
    );
    assert.equal(signedUrl.headers["content-type"], "audio/webm");
    assert.ok(url.searchParams.get("X-Amz-Signature"));
  });

  it("caps presigned URL TTL at 15 minutes", () => {
    const client = new S3StorageClient({
      getConfig: () => ({
        endpoint: "https://account-id.r2.cloudflarestorage.com",
        region: "auto",
        bucket: "vizitum",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        forcePathStyle: true,
      }),
      getDefaultBucket: () => "vizitum",
    });

    const signedUrl = client.createPresignedObjectUrl({
      bucket: "vizitum",
      objectKey: "tenants/tenant-a/export.csv",
      method: "GET",
      expiresInSeconds: 5_000,
    });
    const url = new URL(signedUrl.url);

    assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
  });
});
