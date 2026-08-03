import "reflect-metadata";
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";

import {
  DATE_ONLY_PATTERN,
  MAX_COMMENT_LENGTH,
} from "./location-insights-parsing";

/**
 * The pattern module for the deferred class-validator track (2.4 in
 * docs/security-remediation-plan.md): whitelist + forbidNonWhitelisted on
 * this DTO, scoped to LocationPotentialController alone via
 * createStrictValidationPipe(), reject a body carrying anything this class
 * doesn't declare.
 *
 * Field-level checks here are deliberately coarser than
 * location-insights-parsing.ts's own — this DTO only needs to bound the
 * shape (a string of the right form, a non-negative integer) before the
 * request reaches the service; normalizeOptionalDateOnly/
 * normalizeOptionalNonNegativeInteger/normalizeOptionalComment remain the
 * source of truth for calendar validity and the exact int4 ceiling, run
 * unchanged after this. MAX_COMMENT_LENGTH and DATE_ONLY_PATTERN are
 * imported rather than restated so the two layers can't drift apart.
 */
export class UpsertLocationPotentialDto {
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, {
    message: "potentialDate must be in YYYY-MM-DD format.",
  })
  potentialDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  potentialAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  planMonth1?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  planMonth2?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  planMonth3?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_COMMENT_LENGTH)
  comment?: string;
}
