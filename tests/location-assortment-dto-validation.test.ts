import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";

import { createStrictValidationPipe } from "../src/common/strict-validation-pipe";
import { UpsertLocationAssortmentDto } from "../src/modules/location-insights/location-assortment.dto";

// The exact metadata Nest attaches to LocationAssortmentController's
// `@Body() body: UpsertLocationAssortmentDto` parameter — asserting against
// the real ValidationPipe.transform() with this metadata is what proves the
// controller's `@UsePipes(createStrictValidationPipe())` actually behaves
// this way, not just that the DTO class itself is well-formed.
const BODY_METADATA: ArgumentMetadata = {
  type: "body",
  metatype: UpsertLocationAssortmentDto,
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

describe("UpsertLocationAssortmentDto via the scoped ValidationPipe", () => {
  it("passes a fully populated, in-shape body through, transformed to the DTO class", async () => {
    const pipe = createStrictValidationPipe();

    const result = await pipe.transform(
      { shouldBeListed: true },
      BODY_METADATA,
    );

    assert.ok(result instanceof UpsertLocationAssortmentDto);
    assert.equal(result.shouldBeListed, true);
  });

  it("passes an empty body through, since shouldBeListed is optional", async () => {
    const pipe = createStrictValidationPipe();

    const result = await pipe.transform({}, BODY_METADATA);

    assert.ok(result instanceof UpsertLocationAssortmentDto);
    assert.equal(result.shouldBeListed, undefined);
  });

  it("accepts shouldBeListed: false, the other boundary of the boolean", async () => {
    const pipe = createStrictValidationPipe();

    const result = await pipe.transform(
      { shouldBeListed: false },
      BODY_METADATA,
    );

    assert.equal((result as UpsertLocationAssortmentDto).shouldBeListed, false);
  });

  it("refuses a property this DTO does not declare (forbidNonWhitelisted)", async () => {
    const pipe = createStrictValidationPipe();

    await assert.rejects(
      pipe.transform({ shouldBeListed: true, isAdmin: true }, BODY_METADATA),
      (error: unknown) => {
        const fieldErrors = getFieldErrors(error);
        assert.ok(fieldErrors.isAdmin?.length);
        return true;
      },
    );
  });

  // The shelf-state fields a visit report writes (status, lastCheckedAt) are
  // not part of this DTO. Before this pipe, parseUpsertAssortmentBody just
  // ignored them silently (see tests/location-assortment.test.ts); now the
  // pipe refuses the request outright before it reaches the service.
  it("refuses shelf-state fields the service never accepted from this route", async () => {
    const pipe = createStrictValidationPipe();

    await assert.rejects(
      pipe.transform(
        {
          shouldBeListed: true,
          status: "in_stock",
          lastCheckedAt: "2026-07-20",
        },
        BODY_METADATA,
      ),
      (error: unknown) => {
        const fieldErrors = getFieldErrors(error);
        assert.ok(fieldErrors.status?.length);
        assert.ok(fieldErrors.lastCheckedAt?.length);
        return true;
      },
    );
  });

  it("refuses a shouldBeListed that is not a boolean", async () => {
    const pipe = createStrictValidationPipe();

    await assert.rejects(
      pipe.transform({ shouldBeListed: "true" }, BODY_METADATA),
      (error: unknown) => {
        const fieldErrors = getFieldErrors(error);
        assert.ok(fieldErrors.shouldBeListed?.length);
        return true;
      },
    );
  });
});
