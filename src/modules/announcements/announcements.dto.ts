import "reflect-metadata";
import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

import {
  ANNOUNCEMENT_BODY_MAX_LENGTH,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
} from "./announcements.types";

// The shape parseDateOnly accepts. Announcements take a plain calendar day on
// both ends of the window, never a timestamp, so this is the whole contract —
// but calendar validity (a 31st of February parses to March) and the
// startsAt <= endsAt ordering stay in the service, which is where the current
// row is available to compare a patch against.
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Flat-CRUD tier of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md), scoped to AnnouncementsController's two
 * write routes via createStrictValidationPipe().
 *
 * All four fields are required to create an announcement and all four are
 * optional to patch one, so a single class marks them optional and leaves
 * required-ness where it already lives — announcements.service.ts, whose
 * `ANNOUNCEMENT_INVALID` and `DATE_INVALID` responses are unchanged by this.
 *
 * The caps are imported from announcements.types.ts, which is also where the
 * service reads them, so the two cannot drift.
 */
export class UpsertAnnouncementDto {
  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX_LENGTH)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_BODY_MAX_LENGTH)
  body?: string | null;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, {
    message: "startsAt must be in YYYY-MM-DD format.",
  })
  startsAt?: string | null;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, {
    message: "endsAt must be in YYYY-MM-DD format.",
  })
  endsAt?: string | null;
}
