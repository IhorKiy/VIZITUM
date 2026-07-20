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

const audioBase64 = Buffer.from("fake-audio-bytes").toString("base64");

function buildPrisma(
  visit: unknown = { id: "visit-a", representativeUserId: "rep-a" },
) {
  return {
    visit: {
      findFirst: async () => visit,
    },
  };
}

describe("field report transcription", () => {
  it("rejects when the visit does not belong to the tenant", async () => {
    const service = new AiService(
      buildPrisma(null) as never,
      {} as never,
      {} as never,
    );

    await assert.rejects(
      () =>
        service.transcribeFieldReport(context as never, "visit-a", {
          audioBase64,
          mimeType: "audio/webm",
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
        id: "visit-a",
        representativeUserId: "someone-else",
      }) as never,
      {} as never,
      {} as never,
    );

    await assert.rejects(
      () =>
        service.transcribeFieldReport(context as never, "visit-a", {
          audioBase64,
          mimeType: "audio/webm",
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
    );

    const result = await service.transcribeFieldReport(
      context as never,
      "visit-a",
      { audioBase64, mimeType: "audio/webm", products: [] },
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
    );

    const result = await service.transcribeFieldReport(
      context as never,
      "visit-a",
      { audioBase64, mimeType: "audio/webm", products: [] },
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
    );

    const result = await service.transcribeFieldReport(
      context as never,
      "visit-a",
      { audioBase64, mimeType: "audio/webm", products: [] },
    );

    assert.equal(result.transcript, "Talked about vitamin C stock.");
    assert.deepEqual(result.extractedData, emptyFieldReportExtractedData());
  });

  it("passes the product catalog as extraction context and normalizes the draft", async () => {
    const transcriptionClient = {
      transcribe: async () => ({ text: "Presented vitamin C, stock is low." }),
    };
    let capturedInput: unknown;
    const extractionClient = {
      extract: async (input: unknown) => {
        capturedInput = input;

        return {
          draft: {
            outcome: "positive",
            visitDate: "2026-07-20",
            productsPresented: ["Vitamin C"],
            stockStatus: "low_stock",
            notes: "Presented vitamin C, stock is low.",
            nextAction: null,
            productUpdates: [],
            tasks: {
              dueDate: null,
              assortment: null,
              merchandising: null,
              recommendation: null,
              special: null,
              note: null,
            },
          },
        };
      },
    };
    const service = new AiService(
      buildPrisma() as never,
      transcriptionClient as never,
      extractionClient as never,
    );
    const products = [
      { id: "product-a", name: "Vitamin C", sku: "VTC-100", category: "OTC" },
    ];

    const result = await service.transcribeFieldReport(
      context as never,
      "visit-a",
      { audioBase64, mimeType: "audio/webm", products },
    );

    assert.equal(result.transcript, "Presented vitamin C, stock is low.");
    assert.equal(result.extractedData.outcome, "positive");
    assert.deepEqual(result.extractedData.productsPresented, ["Vitamin C"]);
    assert.deepEqual(
      (capturedInput as { extraContext: { productCatalog: unknown } })
        .extraContext.productCatalog,
      products,
    );
  });
});
