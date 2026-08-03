import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";

import { createStrictValidationPipe } from "../src/common/strict-validation-pipe";
import { RecordDashboardViewDto } from "../src/modules/pilot-review/pilot-review.dto";

// The exact metadata Nest attaches to PilotReviewController's
// `@Body() body: RecordDashboardViewDto` parameter — asserting against the
// real ValidationPipe.transform() with this metadata is what proves the
// controller's `@UsePipes(createStrictValidationPipe())` actually behaves
// this way, not just that the DTO class itself is well-formed.
const BODY_METADATA: ArgumentMetadata = {
  type: "body",
  metatype: RecordDashboardViewDto,
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

describe("RecordDashboardViewDto via the scoped ValidationPipe", () => {
  it("passes a body with page: manager through, transformed to the DTO class", async () => {
    const pipe = createStrictValidationPipe();

    const result = await pipe.transform({ page: "manager" }, BODY_METADATA);

    assert.ok(result instanceof RecordDashboardViewDto);
    assert.equal(result.page, "manager");
  });

  it("passes a body with page: admin_review through, the other allowed value", async () => {
    const pipe = createStrictValidationPipe();

    const result = await pipe.transform(
      { page: "admin_review" },
      BODY_METADATA,
    );

    assert.equal((result as RecordDashboardViewDto).page, "admin_review");
  });

  it("refuses a property this DTO does not declare (forbidNonWhitelisted)", async () => {
    const pipe = createStrictValidationPipe();

    await assert.rejects(
      pipe.transform({ page: "manager", isAdmin: true }, BODY_METADATA),
      (error: unknown) => {
        const fieldErrors = getFieldErrors(error);
        assert.ok(fieldErrors.isAdmin?.length);
        return true;
      },
    );
  });

  // Unlike the other modules on this track, page has no default and no
  // @IsOptional() — every one of this endpoint's two callers
  // (apps/web manager and admin/pilot dashboards) always sends it.
  it("refuses an empty body, since page is required", async () => {
    const pipe = createStrictValidationPipe();

    await assert.rejects(pipe.transform({}, BODY_METADATA), (error: unknown) => {
      const fieldErrors = getFieldErrors(error);
      assert.ok(fieldErrors.page?.length);
      return true;
    });
  });

  it("refuses a page outside the allowed set", async () => {
    const pipe = createStrictValidationPipe();

    await assert.rejects(
      pipe.transform({ page: "not-a-real-page" }, BODY_METADATA),
      (error: unknown) => {
        const fieldErrors = getFieldErrors(error);
        assert.ok(fieldErrors.page?.length);
        return true;
      },
    );
  });

  it("refuses a non-string page value", async () => {
    const pipe = createStrictValidationPipe();

    await assert.rejects(
      pipe.transform({ page: 123 }, BODY_METADATA),
      (error: unknown) => {
        const fieldErrors = getFieldErrors(error);
        assert.ok(fieldErrors.page?.length);
        return true;
      },
    );
  });
});
