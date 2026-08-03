import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";

import { createStrictValidationPipe } from "../src/common/strict-validation-pipe";
import { UpsertLocationPotentialDto } from "../src/modules/location-insights/location-potential.dto";

// The exact metadata Nest attaches to LocationPotentialController's
// `@Body() body: UpsertLocationPotentialDto` parameter — asserting against
// the real ValidationPipe.transform() with this metadata is what proves the
// controller's `@UsePipes(createStrictValidationPipe())` actually behaves
// this way, not just that the DTO class itself is well-formed.
const BODY_METADATA: ArgumentMetadata = {
  type: "body",
  metatype: UpsertLocationPotentialDto,
  data: "",
};

function getFieldErrors(error: unknown): Record<string, string[]> {
  assert.ok(error instanceof BadRequestException);

  const response = error.getResponse() as {
    code?: string;
    message?: string;
    fieldErrors?: Record<string, string[]>;
  };

  // Same envelope shape as every other 400 this API returns, so
  // ApiErrorFilter needs no special case for a DTO rejection.
  assert.equal(response.code, "VALIDATION_FAILED");
  assert.equal(typeof response.message, "string");
  assert.ok(response.fieldErrors);

  return response.fieldErrors;
}

describe("UpsertLocationPotentialDto via the scoped ValidationPipe", () => {
  it("passes a fully populated, in-shape body through, transformed to the DTO class", async () => {
    const pipe = createStrictValidationPipe();

    const result = await pipe.transform(
      {
        potentialDate: "2026-07-01",
        potentialAmount: 1000,
        planMonth1: 100,
        planMonth2: 200,
        planMonth3: 300,
        comment: "Strong seasonal demand.",
      },
      BODY_METADATA,
    );

    assert.ok(result instanceof UpsertLocationPotentialDto);
    assert.equal(result.potentialAmount, 1000);
    assert.equal(result.comment, "Strong seasonal demand.");
  });

  it("passes an empty body through, since every field is optional", async () => {
    const pipe = createStrictValidationPipe();

    const result = await pipe.transform({}, BODY_METADATA);

    assert.ok(result instanceof UpsertLocationPotentialDto);
    assert.equal(result.comment, undefined);
    assert.equal(result.potentialAmount, undefined);
  });

  it("refuses a property this DTO does not declare (forbidNonWhitelisted)", async () => {
    const pipe = createStrictValidationPipe();

    await assert.rejects(
      pipe.transform({ comment: "ok", isAdmin: true }, BODY_METADATA),
      (error: unknown) => {
        const fieldErrors = getFieldErrors(error);
        assert.ok(fieldErrors.isAdmin?.length);
        return true;
      },
    );
  });

  it("refuses a comment over the 500-character cap, mirroring location-insights-parsing.ts", async () => {
    const pipe = createStrictValidationPipe();

    await assert.rejects(
      pipe.transform({ comment: "x".repeat(501) }, BODY_METADATA),
      (error: unknown) => {
        const fieldErrors = getFieldErrors(error);
        assert.ok(fieldErrors.comment?.length);
        return true;
      },
    );
  });

  it("accepts a comment at exactly the 500-character cap", async () => {
    const pipe = createStrictValidationPipe();

    const result = await pipe.transform(
      { comment: "x".repeat(500) },
      BODY_METADATA,
    );

    assert.equal((result as UpsertLocationPotentialDto).comment?.length, 500);
  });

  it("refuses a negative potentialAmount", async () => {
    const pipe = createStrictValidationPipe();

    await assert.rejects(
      pipe.transform({ potentialAmount: -5 }, BODY_METADATA),
      (error: unknown) => {
        const fieldErrors = getFieldErrors(error);
        assert.ok(fieldErrors.potentialAmount?.length);
        return true;
      },
    );
  });

  it("refuses a potentialDate that is not YYYY-MM-DD shaped", async () => {
    const pipe = createStrictValidationPipe();

    await assert.rejects(
      pipe.transform({ potentialDate: "07/01/2026" }, BODY_METADATA),
      (error: unknown) => {
        const fieldErrors = getFieldErrors(error);
        assert.ok(fieldErrors.potentialDate?.length);
        return true;
      },
    );
  });
});
