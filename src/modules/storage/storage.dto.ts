import "reflect-metadata";
import { IsNumber, IsOptional, ValidateIf } from "class-validator";

/**
 * Tier 4 of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md): StorageController's two bodies.
 *
 * One class for both routes, like `UpsertLocationCategoryDto`: the upload and
 * download URL mintings take the same single field and always have, and the
 * two request types they replace were character-for-character identical.
 *
 * The whole body is this one optional field — both routes are otherwise
 * addressed by path param — so what the gate actually buys here is the
 * refusal of an undeclared property, not a tighter `expiresInSeconds`.
 */
export class CreatePresignedUrlDto {
  // Number-or-string for the reason `sizeBytes` and `latitude` are:
  // normalizeSignedUrlTtl `Number()`s whatever arrives, so a client sending
  // `"300"` gets a signed URL today and must keep getting one. `""` and `null`
  // both mean "use the default TTL" and reach the service untouched.
  //
  // The 1..900 range stays with normalizeSignedUrlTtl, whose
  // `SIGNED_URL_TTL_INVALID` names the bounds ("must be between 1 and 900
  // seconds") — the same call made for the upload size caps.
  @IsOptional()
  @ValidateIf((_dto, value) => typeof value !== "string")
  @IsNumber()
  expiresInSeconds?: number | string | null;
}
