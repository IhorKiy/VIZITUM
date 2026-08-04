import "reflect-metadata";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

import { TEXT_LIMITS } from "../../common/input-limits";

/**
 * Flat-CRUD tier of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md), scoped to this controller's two write
 * routes via createStrictValidationPipe().
 *
 * Every field is optional here even though a chain cannot be created without
 * a name. Required-ness, trimming, emptiness and uniqueness stay in
 * chains.service.ts, which answers with its own `CHAIN_INVALID` envelope — the
 * DTO is the coarse gate in front of it, not a replacement, so those responses
 * are unchanged. What the service could not do, and this adds, is rejecting a
 * property nobody declared instead of silently dropping it.
 *
 * Caps come from TEXT_LIMITS rather than being restated, so this layer cannot
 * drift from the assertTextWithinLimit calls behind it.
 */
export class CreateChainDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.code)
  externalCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.notes)
  notes?: string | null;
}

export class UpdateChainDto extends CreateChainDto {
  // Deliberate tightening: normalizeChainStatus maps anything outside these
  // two to null, which parseUpdateChainBody then spreads away — so a typo'd
  // status was accepted with a 200 and quietly ignored. It is now a 400. The
  // same reasoning as the undeclared-property case: a write the caller
  // believes happened and did not is worse than a refusal.
  @IsOptional()
  @IsIn(["active", "archived"])
  status?: string | null;
}
