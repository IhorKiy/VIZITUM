import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { S3StorageClient } from "../src/modules/storage/s3-storage.client";
import type { StorageConfigService } from "../src/modules/storage/storage.config";

// The size a client declares when it registers an upload bounds nothing on its
// own: the presigned PUT signs the host and content type but not
// `Content-Length`, so the object that lands in R2 can be any size, and it may
// declare no size at all. This download is where the number becomes real —
// without it a rep could declare a kilobyte, upload gigabytes and have the API
// buffer the whole thing on its way to the transcription provider.
describe("storage download size cap", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the bytes when the object is within the cap", async () => {
    stubFetch({ contentLength: "1024", body: "audio-bytes" });

    const buffer = await createClient().downloadObject("bucket", "key", {
      maxBytes: 2048,
    });

    assert.equal(buffer.toString(), "audio-bytes");
  });

  it("refuses an object larger than the cap without reading its body", async () => {
    const stub = stubFetch({
      contentLength: String(64 * 1024 * 1024),
      body: "far too many bytes",
    });

    await assert.rejects(
      () =>
        createClient().downloadObject("bucket", "key", {
          maxBytes: 50 * 1024 * 1024,
        }),
      /over the 52428800 byte limit/,
    );
    assert.equal(stub.bodyRead, false);
    assert.equal(stub.bodyCancelled, true);
  });

  it("refuses an object whose size the store did not report", async () => {
    const stub = stubFetch({ contentLength: null, body: "unknown length" });

    await assert.rejects(
      () => createClient().downloadObject("bucket", "key", { maxBytes: 2048 }),
      /size was not reported/,
    );
    assert.equal(stub.bodyRead, false);
    assert.equal(stub.bodyCancelled, true);
  });

  it("refuses a size that is not canonical decimal digits", async () => {
    // `Number` accepts a good deal more than a Content-Length can be: "1e3"
    // is 1000, "0x10" is 16, and surrounding whitespace is ignored. Reading
    // any of those as a size would mean believing a header we did not
    // actually understand, on the one check standing between an oversized
    // object and an out-of-memory kill.
    for (const contentLength of [
      "not-a-number",
      "12.5",
      "-1",
      "1e3",
      "0x10",
      " 5",
      "5 ",
      "+5",
      "",
    ]) {
      stubFetch({ contentLength, body: "x" });

      await assert.rejects(
        () =>
          createClient().downloadObject("bucket", "key", { maxBytes: 2048 }),
        /size was not reported/,
        `expected a content-length of "${contentLength}" to be refused`,
      );
    }
  });

  it("still reports a failed download as a failed download", async () => {
    stubFetch({ ok: false, status: 404, statusText: "Not Found" });

    await assert.rejects(
      () => createClient().downloadObject("bucket", "key", { maxBytes: 2048 }),
      /S3 download failed with status 404/,
    );
  });
});

function createClient() {
  const storageConfig = {
    getConfig: () => ({
      endpoint: "https://storage.example.com",
      region: "auto",
      bucket: "vizitum",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      forcePathStyle: true,
    }),
  };

  return new S3StorageClient(storageConfig as unknown as StorageConfigService);
}

function stubFetch(options: {
  contentLength?: string | null;
  body?: string;
  ok?: boolean;
  status?: number;
  statusText?: string;
}) {
  const stub = { bodyRead: false, bodyCancelled: false };
  const response = {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length"
          ? (options.contentLength ?? null)
          : null,
    },
    body: {
      cancel: async () => {
        stub.bodyCancelled = true;
      },
    },
    arrayBuffer: async () => {
      stub.bodyRead = true;
      return Buffer.from(options.body ?? "");
    },
  };

  globalThis.fetch = (async () => response) as unknown as typeof fetch;

  return stub;
}
