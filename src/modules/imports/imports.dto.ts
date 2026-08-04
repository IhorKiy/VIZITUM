import "reflect-metadata";
import { IsIn, IsOptional, IsString } from "class-validator";

import {
  IMPORT_TEMPLATE_TYPES,
  type ImportTemplateType,
} from "./imports.types";

/**
 * Tier 5 of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md): `ImportsController`'s single `@Body()`
 * route, deliberately left this late because its body is mostly a text blob.
 * The reasoning is in [the design note](../../../docs/plans/imports-dto-migration-note.md);
 * the short version, since a reviewer will want it here:
 *
 * **This gate is narrower than it looks, and the note's Q2 is the part worth
 * reading.** What actually defends an import lives behind this pipe and is
 * untouched: `assertApprovedHeader` refuses any CSV column the template does
 * not declare (that, not this class, is the import path's anti-mass-assignment
 * control), `ImportTemplateColumn.limit` caps every cell against `TEXT_LIMITS`,
 * the formula guard neutralizes anything written back out as CSV, and this
 * route only produces a *preview* — nothing reaches the tenant's tables until
 * `POST /jobs/:importJobId/confirm`, which takes no body at all. What the DTO
 * adds is one thing: an undeclared property is refused by name.
 *
 * The three `parse*` helpers in imports.controller.ts run unchanged behind it
 * and keep `IMPORT_TEMPLATE_INVALID` / `IMPORT_FILE_INVALID`.
 */
export class CreateImportValidationJobDto {
  /**
   * Gated, unlike `colorScheme`/`language` in tier 4 and for the reason
   * `segmentTemplate` was: `IMPORT_TEMPLATE_INVALID` says "Import template
   * type is required." without naming a single allowed value. Nor is this a
   * dropped enum — an unknown type throws rather than being coerced. It is
   * gated because it is the **discriminator**: it picks which template the
   * header is checked against and which of the five row validators runs, and a
   * field that decides which validator applies is the one worth pinning at the
   * earliest layer.
   */
  @IsOptional()
  @IsIn(IMPORT_TEMPLATE_TYPES)
  templateType?: ImportTemplateType | null;

  /**
   * The blob, and the question this tier was deferred for. `@IsString()` and
   * nothing else.
   *
   * A whitelist walks properties, and this has none — `confirmedData` is an
   * object whose shape a DTO could in principle have declared, which is what
   * made that decision hard; a string offers no such choice. (The argument
   * that settled `confirmedData` — that refusing a payload an older client
   * produced destroys a rep's finished work, because `report-outbox.ts`
   * replays it — has no counterpart here: an import is composed in one sitting
   * in an admin's browser, and a refusal costs a re-pick of the file.)
   *
   * No `@MaxLength`: the size is already bounded by `JSON_BODY_LIMIT`, which
   * answers a 100 kB CSV with a 413 from body-parser before this class is
   * reached. Restating it here would both duplicate a cap and replace that 413
   * with a field error.
   *
   * `parseCsvText` keeps the "present but blank" case, which `@IsString()`
   * cannot judge: `"   "` is an empty CSV, and the admin needs to be told that
   * rather than that their string is a string.
   */
  @IsOptional()
  @IsString()
  csvText?: string | null;

  /**
   * Uncapped on purpose, unlike the `fileName` on both upload registrations
   * (`RegisterAudioUploadDto`, `RegisterLogoUploadDto`), which cap at
   * `MAX_UPLOAD_FILE_NAME_LENGTH`.
   *
   * Those normalizers *reject* an over-long name. `parseFileName` here does
   * not — it slices to 255 because the column is nullable and purely
   * informational. There is no refusal to move earlier, so a `@MaxLength`
   * would not surface one, it would invent one: a cosmetic overflow becoming a
   * failed import of a file the admin already picked. Same call as the
   * `phone` fields in locations.dto.ts and users.dto.ts.
   */
  @IsOptional()
  @IsString()
  fileName?: string | null;
}
