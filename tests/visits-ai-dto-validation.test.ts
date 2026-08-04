import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { PIPES_METADATA } from "@nestjs/common/constants";

import { createStrictValidationPipe } from "../src/common/strict-validation-pipe";
import {
  ConfirmAiDraftDto,
  CreateExtractionJobDto,
  CreateTranscriptionJobDto,
  TranscribeFieldReportDto,
} from "../src/modules/ai/ai.dto";
import { MAX_CLIENT_REQUEST_ID_LENGTH } from "../src/modules/visits/visit-request-limits";
import { VisitsController } from "../src/modules/visits/visits.controller";
import { ConfirmReportDto } from "../src/modules/visits/visits.dto";

// Second of the two PRs docs/plans/visits-dto-migration-note.md splits `visits`
// into: the four AiService bodies plus the manual `reports/confirm`. With this
// the whole controller is gated, which the first case below pins.
//
// The load-bearing assertion in this file is the pass-through one. Every other
// case here would pass just as well against a DTO that had started walking
// inside `confirmedData` — and that walk is the thing the design note argues
// would cost a rep their finished report, because report-outbox.ts replays a
// payload an older build produced and permanently parks any the server
// refuses. So the shape is asserted with deepEqual against real payloads
// rather than with "an object is accepted".

type DtoClass = new () => object;

function bodyMetadata(metatype: DtoClass): ArgumentMetadata {
  return { type: "body", metatype, data: "" };
}

async function accept<T extends object>(
  metatype: new () => T,
  body: unknown,
): Promise<T> {
  const result = await createStrictValidationPipe().transform(
    body,
    bodyMetadata(metatype),
  );

  assert.ok(result instanceof metatype);

  return result as T;
}

async function reject(
  metatype: DtoClass,
  body: unknown,
  field: string,
): Promise<void> {
  await assert.rejects(
    createStrictValidationPipe().transform(body, bodyMetadata(metatype)),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);

      const response = error.getResponse() as {
        code?: string;
        fieldErrors?: Record<string, string[]>;
      };

      assert.equal(response.code, "VALIDATION_FAILED");
      assert.ok(
        response.fieldErrors?.[field]?.length,
        `expected a field error on ${field}, got ${JSON.stringify(response.fieldErrors)}`,
      );

      return true;
    },
  );
}

// Exactly what apps/web/components/field-visit-report-form.tsx assembles, keys
// and nesting included — the payload an offline device queues and replays.
function fieldReportV1Payload() {
  return {
    summary: "Presented vitamin C. Shelf gap on the top row.",
    resultStatus: "positive",
    agreements: [],
    objections: [],
    mentionedProducts: [
      { name: "Vitamin C 500", status: "presented", evidence: "" },
    ],
    nextActions: ["Bring samples next week"],
    tasksToCreate: [
      {
        title: "Bring samples next week",
        description: "",
        dueDate: "2026-08-11",
        assignee: "representative",
        isPriority: false,
      },
    ],
    locationUpdates: [],
    confidence: 1,
    requiresUserConfirmation: false,
    fieldReport: {
      visitDate: "2026-08-04",
      outcome: "positive",
      orderPlaced: true,
      noOrderReason: null,
      stockStatus: "out_of_stock",
      shelfChecked: true,
      notes: "Shelf gap on the top row.",
      nextAction: "Bring samples next week",
      nextActionDueDate: "2026-08-11",
      productUpdates: [
        { productId: "product-a", status: "out_of_stock" },
        { productId: "product-b", status: "in_stock" },
      ],
      problem: {
        type: "damaged",
        note: "Two crushed boxes in the back.",
        photoObjectId: "storage-object-a",
        photoContentType: "image/jpeg",
      },
    },
  };
}

// The other schemaVersion on the same route: a flat record whose field list
// comes from the tenant's own segmentTemplate, which is why no single DTO
// could describe both.
function manualV1Payload() {
  return {
    shelf_state: "Full facing, two SKUs missing.",
    competitor_activity: "Promo shelf-talker from a competitor.",
    agreement: "Reorder on Friday.",
  };
}

describe("the whole VisitsController is gated once this lands", () => {
  const bodyHandlers: Array<[string, (...args: never[]) => unknown]> = [
    ["createVisit", VisitsController.prototype.createVisit],
    ["updateVisit", VisitsController.prototype.updateVisit],
    ["cancelVisit", VisitsController.prototype.cancelVisit],
    ["addTextNote", VisitsController.prototype.addTextNote],
    [
      "registerTemporaryAudioUpload",
      VisitsController.prototype.registerTemporaryAudioUpload,
    ],
    [
      "registerProblemPhotoUpload",
      VisitsController.prototype.registerProblemPhotoUpload,
    ],
    ["confirmReport", VisitsController.prototype.confirmReport],
    [
      "createTranscriptionJob",
      VisitsController.prototype.createTranscriptionJob,
    ],
    ["createExtractionJob", VisitsController.prototype.createExtractionJob],
    ["confirmAiDraft", VisitsController.prototype.confirmAiDraft],
    ["transcribeFieldReport", VisitsController.prototype.transcribeFieldReport],
  ];

  const readHandlers: Array<[string, (...args: never[]) => unknown]> = [
    ["listVisits", VisitsController.prototype.listVisits],
    ["getVisitDaySummary", VisitsController.prototype.getVisitDaySummary],
    ["getVisit", VisitsController.prototype.getVisit],
    ["getVisitReport", VisitsController.prototype.getVisitReport],
  ];

  it("attaches a pipe to all eleven bodies and to none of the four reads", () => {
    for (const [name, handler] of bodyHandlers) {
      const pipes: unknown[] =
        Reflect.getMetadata(PIPES_METADATA, handler) ?? [];

      assert.equal(pipes.length, 1, `${name} should carry exactly one pipe`);
    }

    for (const [name, handler] of readHandlers) {
      assert.equal(
        Reflect.getMetadata(PIPES_METADATA, handler),
        undefined,
        `${name} takes no body and should carry no pipe`,
      );
    }
  });
});

describe("confirmedData reaches the service exactly as it was sent", () => {
  // The property the offline replay path depends on, asserted from both
  // directions: nothing added, nothing dropped, nothing reordered into a
  // different value — on both schemaVersions, through both routes that take
  // this field.
  it("passes a full field-report.v1 payload through byte-identical", async () => {
    const payload = fieldReportV1Payload();

    const confirmed = await accept(ConfirmReportDto, {
      schemaVersion: "field-report.v1",
      confirmedData: payload,
      clientRequestId: "0f8c2a1e-6d4b-4c7a-9f2e-1b3d5a7c9e11",
    });

    assert.deepEqual(confirmed.confirmedData, payload);

    const draft = await accept(ConfirmAiDraftDto, {
      extractionJobId: "job-a",
      confirmedData: payload,
    });

    assert.deepEqual(draft.confirmedData, payload);
  });

  it("passes a manual.v1 payload through byte-identical", async () => {
    const payload = manualV1Payload();

    const confirmed = await accept(ConfirmReportDto, {
      schemaVersion: "manual.v1",
      confirmedData: payload,
    });

    assert.deepEqual(confirmed.confirmedData, payload);
  });

  it("keeps a property no schema knows about, which is the whole point", async () => {
    // A field an older build of the client sent and this server has never
    // heard of. The whitelist must not reach in and strip it, and must not
    // refuse the request over it: report-outbox.ts parks a refused confirm
    // permanently, so this case is a lost report rather than a failed request.
    const payload = {
      ...fieldReportV1Payload(),
      someFieldFromAnOlderBuild: { nested: ["still", "here"] },
    };

    const confirmed = await accept(ConfirmReportDto, {
      schemaVersion: "field-report.v1",
      confirmedData: payload,
    });

    assert.deepEqual(confirmed.confirmedData, payload);
    assert.deepEqual(
      (confirmed.confirmedData as Record<string, unknown>)
        .someFieldFromAnOlderBuild,
      { nested: ["still", "here"] },
    );
  });

  it("still refuses a confirmedData that is not a JSON object", async () => {
    // The one judgement @IsObject() does make, matching normalizeJsonObject:
    // an array or a scalar is not a report.
    for (const value of [[1, 2], "text", 42]) {
      await reject(ConfirmReportDto, { confirmedData: value }, "confirmedData");
      await reject(
        ConfirmAiDraftDto,
        { confirmedData: value },
        "confirmedData",
      );
    }
  });

  it("leaves an omitted confirmedData omitted, which is how a draft stays unedited", async () => {
    // confirmAiDraft reads `confirmedDataInput !== undefined` to decide
    // whether the rep edited the draft. If the pipe turned an absent field
    // into null, every unedited confirm would be recorded as edited.
    const draft = await accept(ConfirmAiDraftDto, {
      extractionJobId: "job-a",
    });

    assert.equal(draft.confirmedData, undefined);
    // Worth pinning rather than assuming: class-transformer *does* materialize
    // the declared key on the instance, it just leaves the value undefined. So
    // the `!== undefined` check the service actually performs is safe, and a
    // future refactor of it to `"confirmedData" in body` would silently record
    // every unedited confirm as edited.
    assert.equal("confirmedData" in draft, true);

    // An explicit null is a different thing and still reaches the service,
    // which falls back to the stored draft.
    const withNull = await accept(ConfirmAiDraftDto, {
      extractionJobId: "job-a",
      confirmedData: null,
    });

    assert.equal(withNull.confirmedData, null);
  });
});

describe("the envelopes around confirmedData are closed", () => {
  it("refuses an undeclared property on both confirm routes", async () => {
    for (const dto of [ConfirmReportDto, ConfirmAiDraftDto]) {
      await reject(dto, { tenantId: "another-tenant" }, "tenantId");
    }

    // The fields a caller might expect to set and must not: they come from the
    // request context and the visit.
    await reject(
      ConfirmReportDto,
      { confirmedData: {}, confirmedByUserId: "someone-else" },
      "confirmedByUserId",
    );
    await reject(
      ConfirmReportDto,
      { confirmedData: {}, confirmedAt: "2020-01-01T00:00:00.000Z" },
      "confirmedAt",
    );
  });

  it("caps schemaVersion and clientRequestId", async () => {
    await accept(ConfirmReportDto, { schemaVersion: "x".repeat(64) });
    await reject(
      ConfirmReportDto,
      { schemaVersion: "x".repeat(65) },
      "schemaVersion",
    );

    await accept(ConfirmReportDto, {
      clientRequestId: "x".repeat(MAX_CLIENT_REQUEST_ID_LENGTH),
    });
    await reject(
      ConfirmReportDto,
      { clientRequestId: "x".repeat(MAX_CLIENT_REQUEST_ID_LENGTH + 1) },
      "clientRequestId",
    );
  });
});

describe("the three async AI job bodies", () => {
  it("passes an id through and refuses a non-string one", async () => {
    const transcription = await accept(CreateTranscriptionJobDto, {
      inputObjectId: "storage-object-a",
    });

    assert.equal(transcription.inputObjectId, "storage-object-a");

    await accept(CreateExtractionJobDto, { transcriptionJobId: "job-a" });

    await reject(
      CreateTranscriptionJobDto,
      { inputObjectId: 42 },
      "inputObjectId",
    );
    await reject(
      CreateExtractionJobDto,
      { transcriptionJobId: ["job-a"] },
      "transcriptionJobId",
    );
  });

  it("leaves a missing id to the controller's own REQUEST_BODY_INVALID", async () => {
    // parseRequiredBodyString names the field and trims besides, so the DTO
    // stays out of required-ness here as everywhere else on this track.
    await accept(CreateTranscriptionJobDto, {});
    await accept(CreateExtractionJobDto, {});
  });
});

describe("TranscribeFieldReportDto — the one nested body on the track", () => {
  it("accepts the catalog apps/web sends, nulls included", async () => {
    const accepted = await accept(TranscribeFieldReportDto, {
      audioObjectId: "storage-object-a",
      products: [
        {
          id: "product-a",
          name: "Vitamin C 500",
          sku: "VC-500",
          category: "Supplements",
        },
        { id: "product-b", name: "Vitamin D", sku: null, category: null },
      ],
    });

    assert.equal(accepted.products?.length, 2);
    assert.equal(accepted.products?.[0].sku, "VC-500");
    assert.equal(accepted.products?.[1].sku, null);
  });

  it("refuses an entry missing id or name instead of dropping it", async () => {
    // The one deliberate contract change in this PR. parseProductCatalog
    // dropped these and transcribed against a quietly smaller catalog — worse
    // extraction with no signal.
    //
    // The field path names the offending entry, not just "products": nested
    // errors carry no constraints on the parent, so the pipe walks children to
    // build `products.<index>.<field>`.
    await reject(
      TranscribeFieldReportDto,
      { products: [{ name: "Vitamin C 500" }] },
      "products.0.id",
    );
    await reject(
      TranscribeFieldReportDto,
      { products: [{ id: "product-a" }] },
      "products.0.name",
    );
    await reject(
      TranscribeFieldReportDto,
      {
        products: [
          { id: "product-a", name: "Vitamin C 500" },
          { id: 7, name: "Vitamin D" },
        ],
      },
      "products.1.id",
    );
  });

  it("refuses a property inside a catalog entry that the DTO does not declare", async () => {
    // Nested validation carries whitelist/forbidNonWhitelisted with it, which
    // is what makes this the only place on the track where mass assignment
    // could have hidden one level down.
    await reject(
      TranscribeFieldReportDto,
      {
        products: [
          {
            id: "product-a",
            name: "Vitamin C 500",
            tenantId: "another-tenant",
          },
        ],
      },
      "products.0.tenantId",
    );
  });

  it("still accepts an absent or empty catalog", async () => {
    // parseProductCatalog answers [] for a missing list, and transcription
    // works without one — it just cannot match spoken names to products.
    await accept(TranscribeFieldReportDto, { audioObjectId: "object-a" });
    await accept(TranscribeFieldReportDto, {
      audioObjectId: "object-a",
      products: [],
    });

    await reject(
      TranscribeFieldReportDto,
      { products: "product-a" },
      "products",
    );
  });
});
