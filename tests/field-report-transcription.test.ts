import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import { AiService } from "../src/modules/ai/ai.service";
import { emptyFieldReportExtractedData } from "../src/modules/ai/field-report-extraction.schema";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.update_own", "ai.use_reporting"],
};

const defaultStorageObject = {
  id: "audio-object-a",
  bucket: "vizitum",
  objectKey: "tenants/tenant-a/visits/visit-a/audio/audio-object-a.webm",
  contentType: "audio/webm",
};

function buildPrisma(
  overrides: {
    visit?: unknown;
    storageObject?: unknown;
    visitNote?: unknown;
  } = {},
) {
  const {
    visit = { id: "visit-a", representativeUserId: "rep-a" },
    storageObject = defaultStorageObject,
    visitNote = { id: "note-a" },
  } = overrides;

  return {
    visit: { findFirst: async () => visit },
    // Reached only when the visit resolves to nothing by either of its own
    // ids — see visit-identity.ts. Empty here: these cases are about a visit
    // that genuinely does not belong to the caller's tenant, not one an adopt
    // recorded under a different id.
    visitClientAlias: { findUnique: async () => null },
    storageObject: { findFirst: async () => storageObject },
    visitNote: { findFirst: async () => visitNote },
    // A provider failure now records a failed AiJob row, so that the
    // operations summary — whose three AI numbers all count AiJob rows — can
    // see an outage on the one path field reports actually take (audit F12).
    // Contract pinned in tests/ai-outage-visibility.test.ts; here it only
    // needs to exist so these degradation cases exercise the real path.
    aiJob: { create: async () => ({ id: "ai-job-a" }) },
  };
}

function buildS3StorageClient(overrides: Record<string, unknown> = {}) {
  return {
    downloadObject: async () => Buffer.from("fake-audio-bytes"),
    ...overrides,
  };
}

describe("field report transcription", () => {
  it("rejects when the visit does not belong to the tenant", async () => {
    const service = new AiService(
      buildPrisma({ visit: null }) as never,
      {} as never,
      {} as never,
      buildS3StorageClient() as never,
    );

    await assert.rejects(
      () =>
        service.transcribeFieldReport(context as never, "visit-a", {
          audioObjectId: "audio-object-a",
          products: [],
        }),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        return true;
      },
    );
  });

  it("rejects when the caller is not the visit's representative", async () => {
    const service = new AiService(
      buildPrisma({
        visit: { id: "visit-a", representativeUserId: "someone-else" },
      }) as never,
      {} as never,
      {} as never,
      buildS3StorageClient() as never,
    );

    await assert.rejects(
      () =>
        service.transcribeFieldReport(context as never, "visit-a", {
          audioObjectId: "audio-object-a",
          products: [],
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "AI_VISIT_SCOPE_INVALID",
        );
        return true;
      },
    );
  });

  it("rejects when the audio object is not an active temporary audio object", async () => {
    const service = new AiService(
      buildPrisma({ storageObject: null }) as never,
      {} as never,
      {} as never,
      buildS3StorageClient() as never,
    );

    await assert.rejects(
      () =>
        service.transcribeFieldReport(context as never, "visit-a", {
          audioObjectId: "audio-object-a",
          products: [],
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TRANSCRIPTION_INPUT_INVALID",
        );
        return true;
      },
    );
  });

  it("rejects when the audio object is not registered as a note on this visit", async () => {
    const service = new AiService(
      buildPrisma({ visitNote: null }) as never,
      {} as never,
      {} as never,
      buildS3StorageClient() as never,
    );

    await assert.rejects(
      () =>
        service.transcribeFieldReport(context as never, "visit-a", {
          audioObjectId: "audio-object-a",
          products: [],
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TRANSCRIPTION_INPUT_INVALID",
        );
        return true;
      },
    );
  });

  it("degrades to an empty draft when the audio download fails, without throwing", async () => {
    const s3StorageClient = buildS3StorageClient({
      downloadObject: async () => {
        throw new Error("object not found in bucket");
      },
    });
    const service = new AiService(
      buildPrisma() as never,
      {} as never,
      {} as never,
      s3StorageClient as never,
    );

    const result = await service.transcribeFieldReport(
      context as never,
      "visit-a",
      { audioObjectId: "audio-object-a", products: [] },
    );

    assert.deepEqual(result, {
      transcript: "",
      extractedData: emptyFieldReportExtractedData(),
    });
  });

  it("degrades to an empty draft when transcription fails, without throwing", async () => {
    const transcriptionClient = {
      transcribe: async () => {
        throw new Error("network down");
      },
    };
    const service = new AiService(
      buildPrisma() as never,
      transcriptionClient as never,
      {} as never,
      buildS3StorageClient() as never,
    );

    const result = await service.transcribeFieldReport(
      context as never,
      "visit-a",
      { audioObjectId: "audio-object-a", products: [] },
    );

    assert.deepEqual(result, {
      transcript: "",
      extractedData: emptyFieldReportExtractedData(),
    });
  });

  it("skips extraction and returns an empty draft for a blank transcript", async () => {
    const transcriptionClient = { transcribe: async () => ({ text: "   " }) };
    const extractionClient = {
      extract: async () => {
        throw new Error("extraction should not run for a blank transcript");
      },
    };
    const service = new AiService(
      buildPrisma() as never,
      transcriptionClient as never,
      extractionClient as never,
      buildS3StorageClient() as never,
    );

    const result = await service.transcribeFieldReport(
      context as never,
      "visit-a",
      { audioObjectId: "audio-object-a", products: [] },
    );

    assert.equal(result.transcript, "   ");
    assert.deepEqual(result.extractedData, emptyFieldReportExtractedData());
  });

  it("keeps the transcript but empties the draft when extraction fails", async () => {
    const transcriptionClient = {
      transcribe: async () => ({ text: "Talked about vitamin C stock." }),
    };
    const extractionClient = {
      extract: async () => {
        throw new Error("model unavailable");
      },
    };
    const service = new AiService(
      buildPrisma() as never,
      transcriptionClient as never,
      extractionClient as never,
      buildS3StorageClient() as never,
    );

    const result = await service.transcribeFieldReport(
      context as never,
      "visit-a",
      { audioObjectId: "audio-object-a", products: [] },
    );

    assert.equal(result.transcript, "Talked about vitamin C stock.");
    assert.deepEqual(result.extractedData, emptyFieldReportExtractedData());
  });

  it("downloads the registered object and passes the product catalog as extraction context", async () => {
    const transcriptionClient = {
      transcribe: async () => ({ text: "Presented vitamin C, stock is low." }),
    };
    let capturedInput: unknown;
    const extractionClient = {
      extract: async (input: unknown) => {
        capturedInput = input;

        return {
          draft: {
            orderPlaced: true,
            noOrderReason: null,
            visitDate: "2026-07-20",
            missingProducts: ["Vitamin C"],
            problemType: null,
            problemNote: null,
            notes: "Presented vitamin C, stock is low.",
            nextAction: null,
            nextActionDueDate: null,
          },
        };
      },
    };
    const downloadCalls: unknown[] = [];
    const s3StorageClient = buildS3StorageClient({
      downloadObject: async (bucket: string, objectKey: string) => {
        downloadCalls.push({ bucket, objectKey });

        return Buffer.from("fake-audio-bytes");
      },
    });
    const service = new AiService(
      buildPrisma() as never,
      transcriptionClient as never,
      extractionClient as never,
      s3StorageClient as never,
    );
    const products = [
      { id: "product-a", name: "Vitamin C", sku: "VTC-100", category: "OTC" },
    ];

    const result = await service.transcribeFieldReport(
      context as never,
      "visit-a",
      { audioObjectId: "audio-object-a", products },
    );

    assert.deepEqual(downloadCalls, [
      {
        bucket: defaultStorageObject.bucket,
        objectKey: defaultStorageObject.objectKey,
      },
    ]);
    assert.equal(result.transcript, "Presented vitamin C, stock is low.");
    assert.equal(result.extractedData.orderPlaced, true);
    assert.deepEqual(result.extractedData.missingProducts, ["Vitamin C"]);
    assert.deepEqual(
      (capturedInput as { extraContext: { productCatalog: unknown } })
        .extraContext.productCatalog,
      products,
    );
  });
});
