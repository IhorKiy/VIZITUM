import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { PIPES_METADATA } from "@nestjs/common/constants";

import { createStrictValidationPipe } from "../src/common/strict-validation-pipe";
import {
  MAX_CLIENT_REQUEST_ID_LENGTH,
  MAX_UPLOAD_FILE_NAME_LENGTH,
  MAX_VISIT_CANCELLATION_COMMENT_LENGTH,
} from "../src/modules/visits/visit-request-limits";
import { VisitsController } from "../src/modules/visits/visits.controller";
import {
  AddTextVisitNoteDto,
  CancelVisitDto,
  CreateVisitDto,
  RegisterAudioUploadDto,
  RegisterProblemPhotoDto,
  UpdateVisitDto,
} from "../src/modules/visits/visits.dto";

// Tier 3's last module, first of the two PRs docs/plans/visits-dto-migration-note.md
// splits it into: the six bodies VisitsService owns. The five AiService bodies
// (both confirmedData envelopes and the nested products[]) are gated
// separately and are asserted here to be *un*gated, so this file also pins the
// split itself.
//
// The note's rule is what most of these cases check: the DTO declares what a
// body may contain, and every judgement whose refusal carries a useful message
// stays with the service. A test that only checked "invalid input is refused"
// would pass just as well against a DTO that had taken those messages over.

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

const EVERY_DTO: DtoClass[] = [
  CreateVisitDto,
  UpdateVisitDto,
  CancelVisitDto,
  AddTextVisitNoteDto,
  RegisterAudioUploadDto,
  RegisterProblemPhotoDto,
];

describe("the six VisitsService routes carry the pipe, and the AI five do not yet", () => {
  const gatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
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
  ];

  // The four reads, plus the five bodies the second PR covers. Listing the
  // latter here is the point: this file should fail the day one of them is
  // gated without its own DTO and its own cases, rather than silently
  // covering less than the controller does.
  const ungatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
    ["listVisits", VisitsController.prototype.listVisits],
    ["getVisitDaySummary", VisitsController.prototype.getVisitDaySummary],
    ["getVisit", VisitsController.prototype.getVisit],
    ["getVisitReport", VisitsController.prototype.getVisitReport],
    ["confirmReport", VisitsController.prototype.confirmReport],
    [
      "createTranscriptionJob",
      VisitsController.prototype.createTranscriptionJob,
    ],
    ["createExtractionJob", VisitsController.prototype.createExtractionJob],
    ["confirmAiDraft", VisitsController.prototype.confirmAiDraft],
    ["transcribeFieldReport", VisitsController.prototype.transcribeFieldReport],
  ];

  it("attaches a pipe to exactly the six handlers in this PR's scope", () => {
    for (const [name, handler] of gatedHandlers) {
      const pipes: unknown[] =
        Reflect.getMetadata(PIPES_METADATA, handler) ?? [];

      assert.equal(pipes.length, 1, `${name} should carry exactly one pipe`);
    }

    for (const [name, handler] of ungatedHandlers) {
      assert.equal(
        Reflect.getMetadata(PIPES_METADATA, handler),
        undefined,
        `${name} is out of this PR's scope and should carry no pipe yet`,
      );
    }
  });
});

describe("visits DTOs: what all six classes share", () => {
  it("refuses an undeclared property on every route in scope", async () => {
    for (const dto of EVERY_DTO) {
      await reject(dto, { tenantId: "another-tenant" }, "tenantId");
    }
  });

  it("refuses representativeUserId where the route must not take one", async () => {
    // createVisit accepts it (a manager may start a visit for a rep); nothing
    // else on this controller does, and a body that carried it was silently
    // ignored before.
    await accept(CreateVisitDto, { representativeUserId: "user-a" });

    for (const dto of [UpdateVisitDto, CancelVisitDto, AddTextVisitNoteDto]) {
      await reject(
        dto,
        { representativeUserId: "user-a" },
        "representativeUserId",
      );
    }
  });

  it("lets an omitted field stay omitted, so the services keep owning required-ness", async () => {
    // "Location, representative and visit type are required." is still
    // VISIT_INVALID from visits.service.ts, not VALIDATION_FAILED here.
    for (const dto of EVERY_DTO) {
      await accept(dto, {});
    }
  });
});

describe("CreateVisitDto", () => {
  it("accepts the two payloads apps/web posts, online and deferred", async () => {
    // From api-client.ts's createVisit: the online start omits startedAt and
    // clientVisitId entirely, the offline one carries both.
    const online = await accept(CreateVisitDto, {
      locationId: "location-a",
      representativeUserId: "user-a",
      visitType: "planned",
      routeItemId: "item-a",
    });

    assert.equal(online.visitType, "planned");

    await accept(CreateVisitDto, {
      locationId: "location-a",
      representativeUserId: "user-a",
      visitType: "planned",
      startedAt: "2026-08-04T07:15:00.000Z",
      clientVisitId: "0f8c2a1e-6d4b-4c7a-9f2e-1b3d5a7c9e11",
    });
  });

  it("keeps an empty routeItemId meaning 'no route item'", async () => {
    // normalizeOptionalId reads "" as null; a gate that refused it would turn
    // an unlinked start into a 400.
    const accepted = await accept(CreateVisitDto, { routeItemId: "" });

    assert.equal(accepted.routeItemId, "");
  });

  it("caps visitType and clientVisitId at the numbers behind them", async () => {
    await accept(CreateVisitDto, { visitType: "x".repeat(64) });
    await reject(CreateVisitDto, { visitType: "x".repeat(65) }, "visitType");

    await accept(CreateVisitDto, {
      clientVisitId: "x".repeat(MAX_CLIENT_REQUEST_ID_LENGTH),
    });
    await reject(
      CreateVisitDto,
      { clientVisitId: "x".repeat(MAX_CLIENT_REQUEST_ID_LENGTH + 1) },
      "clientVisitId",
    );
  });
});

describe("UpdateVisitDto", () => {
  it("passes `cancelled` through so the service can say where to go instead", async () => {
    // The deliberate non-tightening (Q5 in the design note): updateVisit
    // answers "Use POST /visits/:visitId/cancel to cancel a visit.", which a
    // whitelist rejection would replace with a bare VALIDATION_FAILED.
    const accepted = await accept(UpdateVisitDto, { status: "cancelled" });

    assert.equal(accepted.status, "cancelled");
  });

  it("refuses a status outside the four, which used to be dropped", async () => {
    for (const status of ["draft", "in_progress", "completed"]) {
      await accept(UpdateVisitDto, { status });
    }

    await reject(UpdateVisitDto, { status: "complete" }, "status");
    await reject(UpdateVisitDto, { status: "archived" }, "status");
  });

  it("keeps both timestamps loose, since parseOptionalDateTime defines them", async () => {
    for (const value of ["2026-08-04T07:15:00.000Z", "", null]) {
      await accept(UpdateVisitDto, { startedAt: value, completedAt: value });
    }

    await reject(UpdateVisitDto, { completedAt: 1754290500 }, "completedAt");
  });
});

describe("CancelVisitDto", () => {
  it("accepts the payload apps/web posts, with and without a comment", async () => {
    await accept(CancelVisitDto, { reason: "location_closed" });
    await accept(CancelVisitDto, {
      reason: "other",
      comment: "Shutters down, no notice on the door.",
    });
  });

  it("leaves the reason set to the service, which names every allowed value", async () => {
    // The other half of Q5: CANCELLATION_REASON_INVALID enumerates the
    // reasons, so an unrecognised one must reach it rather than being refused
    // here with a message that lists nothing.
    const accepted = await accept(CancelVisitDto, { reason: "made_up" });

    assert.equal(accepted.reason, "made_up");

    // The type is still the DTO's, since a non-string can only be a client bug.
    await reject(CancelVisitDto, { reason: 3 }, "reason");
  });

  it("caps the comment at 500, the same number as INPUT_LIMITS.comment", async () => {
    await accept(CancelVisitDto, {
      comment: "x".repeat(MAX_VISIT_CANCELLATION_COMMENT_LENGTH),
    });
    await reject(
      CancelVisitDto,
      { comment: "x".repeat(MAX_VISIT_CANCELLATION_COMMENT_LENGTH + 1) },
      "comment",
    );
  });
});

describe("AddTextVisitNoteDto", () => {
  it("accepts a note at the 2000-character cap and refuses one past it", async () => {
    const accepted = await accept(AddTextVisitNoteDto, {
      textContent: "x".repeat(2000),
    });

    assert.equal(accepted.textContent?.length, 2000);

    await reject(
      AddTextVisitNoteDto,
      { textContent: "x".repeat(2001) },
      "textContent",
    );
    await reject(AddTextVisitNoteDto, { textContent: 42 }, "textContent");
  });
});

describe("the two upload registrations", () => {
  it("accepts what apps/web registers on both paths", async () => {
    await accept(RegisterAudioUploadDto, {
      fileName: "voice-note.webm",
      contentType: "audio/webm",
      sizeBytes: 1_048_576,
    });
    await accept(RegisterProblemPhotoDto, {
      fileName: "shelf.jpg",
      contentType: "image/jpeg",
      sizeBytes: 524_288,
    });
  });

  it("takes sizeBytes as a number or a numeric string, untouched either way", async () => {
    // Narrowing to numbers would make the presigned PUT unsignable for a
    // client that sends the size as a string — item 3.2 signs this value as
    // Content-Length.
    for (const dto of [RegisterAudioUploadDto, RegisterProblemPhotoDto]) {
      const fromString = await accept(dto, { sizeBytes: "1048576" });

      assert.equal(
        (fromString as { sizeBytes?: number | string }).sizeBytes,
        "1048576",
      );

      await reject(dto, { sizeBytes: { value: 10 } }, "sizeBytes");
    }
  });

  it("leaves every numeric judgement about sizeBytes to the service", async () => {
    // Q3: the messages that name the real limit in MB — "Audio size must be a
    // positive integer up to 50 MB." — belong to the normalizers, because an
    // over-long recording is a case a real rep hits. The DTO takes the type
    // and nothing else, so all of these pass the gate.
    for (const sizeBytes of [0, -1, 1.5, 999_999_999]) {
      await accept(RegisterAudioUploadDto, { sizeBytes });
      await accept(RegisterProblemPhotoDto, { sizeBytes });
    }
  });

  it("does not narrow contentType to the supported set", async () => {
    // An unsupported or absent contentType falls back to the file extension,
    // so a browser reporting application/octet-stream for a .m4a recording
    // still registers.
    await accept(RegisterAudioUploadDto, {
      fileName: "recording.m4a",
      contentType: "application/octet-stream",
    });
    await accept(RegisterProblemPhotoDto, {
      fileName: "shelf.heic",
      contentType: "application/octet-stream",
    });
  });

  it("caps fileName and the audio checksum", async () => {
    for (const dto of [RegisterAudioUploadDto, RegisterProblemPhotoDto]) {
      await accept(dto, { fileName: "x".repeat(MAX_UPLOAD_FILE_NAME_LENGTH) });
      await reject(
        dto,
        { fileName: "x".repeat(MAX_UPLOAD_FILE_NAME_LENGTH + 1) },
        "fileName",
      );
    }

    await accept(RegisterAudioUploadDto, { checksum: "x".repeat(64) });
    await reject(
      RegisterAudioUploadDto,
      { checksum: "x".repeat(65) },
      "checksum",
    );
    // A checksum is an audio-only field; the photo route never took one.
    await reject(RegisterProblemPhotoDto, { checksum: "abc" }, "checksum");
  });
});
