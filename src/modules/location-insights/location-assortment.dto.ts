import "reflect-metadata";
import { IsBoolean, IsOptional } from "class-validator";

/**
 * Next module on the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md), scoped to LocationAssortmentController
 * alone via createStrictValidationPipe(). shouldBeListed is the only field
 * this endpoint has ever accepted — a shelf-state field (status,
 * lastCheckedAt) is written by a confirmed visit report, never through this
 * route — but before this DTO an old client sending one anyway had it
 * silently dropped by parseUpsertAssortmentBody; forbidNonWhitelisted now
 * rejects it instead. normalizeOptionalBoolean still runs afterward,
 * unchanged, and remains the source of truth for defaulting to true when the
 * field is omitted.
 */
export class UpsertLocationAssortmentDto {
  @IsOptional()
  @IsBoolean()
  shouldBeListed?: boolean | null;
}
