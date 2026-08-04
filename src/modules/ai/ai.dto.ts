import "reflect-metadata";
import { Type } from "class-transformer";
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

/**
 * Second of the two PRs docs/plans/visits-dto-migration-note.md splits `visits`
 * into: the four AI bodies mounted on VisitsController but owned by AiService.
 * They live here rather than in visits.dto.ts because ai.types.ts is where
 * their request types already sit and where the next person will look.
 *
 * Three of these four routes have no client in `apps/web` at all — the async
 * transcription/extraction/draft-confirm pipeline is driven by the worker and
 * by direct callers — so the live risk on this change concentrates entirely in
 * `TranscribeFieldReportDto` below and in ConfirmReportDto (visits.dto.ts).
 *
 * The id fields stay optional, as everywhere on this track: the controller's
 * own `parseRequiredBodyString` answers `REQUEST_BODY_INVALID` naming the
 * field, and it trims besides. @IsString() adds only the case that answer got
 * wrong — a non-string id reported as "required".
 */
export class CreateTranscriptionJobDto {
  @IsOptional()
  @IsString()
  inputObjectId?: string | null;
}

export class CreateExtractionJobDto {
  @IsOptional()
  @IsString()
  transcriptionJobId?: string | null;
}

export class ConfirmAiDraftDto {
  @IsOptional()
  @IsString()
  extractionJobId?: string | null;

  /**
   * Opaque on purpose, and this is Q1 of the design note in one decorator.
   *
   * `@IsObject()` and nothing deeper: no `@ValidateNested`, no `@Type`, so
   * class-transformer copies the value through untouched and the whitelist
   * never walks inside it. Three reasons, in the order they decided it.
   *
   * 1. **A deep whitelist would destroy finished work.**
   *    `apps/web/lib/report-outbox.ts` stores a queued confirm — the exact
   *    payload — on the rep's device and replays it when signal returns, and
   *    it never retries an entry the server refused; it keeps it, because
   *    deleting it would throw away work the rep already did. So a payload an
   *    older build produced can reach a newer server, and a whitelist that
   *    refused a property that build happened to include would cost a report
   *    for a visit whose audio is long gone.
   * 2. **There is no single shape to declare.** One route carries
   *    `field-report.v1` (nested, its authority the extraction schema plus
   *    everything the form adds afterwards) and `manual.v1` (flat, its field
   *    list drawn from the tenant's own segmentTemplate — different per
   *    tenant).
   * 3. **Nothing is gained.** This value is never spread into a Prisma `data`
   *    object; it lands whole in one Json column, and every id on that row
   *    comes from the request context and the visit. Its three readers
   *    (extractShelfCheck, extractTasksToCreate, problemPhotoObjectIdOf)
   *    check every step rather than casting.
   *
   * What the envelope still gets: a property neither this class nor
   * ConfirmReportDto declares is refused, which is the anti-mass-assignment
   * property the rest of the track has, applied at the one layer where the
   * shape is fixed and known.
   *
   * `@IsObject()` agrees with `normalizeJsonObject` on everything JSON can
   * carry — both take a non-null, non-array object and refuse the rest — so
   * `AI_DRAFT_INVALID` keeps its meaning. `@IsOptional()` matters here beyond
   * the usual: `confirmAiDraft` reads `confirmedDataInput !== undefined` to
   * decide whether the draft was *edited*, so an omitted field has to stay
   * omitted rather than arriving as null.
   */
  @IsOptional()
  @IsObject()
  confirmedData?: Record<string, unknown> | null;
}

/**
 * The product catalog the client sends so the model can match spoken names
 * against the tenant's own products — and the one body on this whole track
 * that genuinely needs `@ValidateNested`. Tier 3 was scheduled expecting
 * several; `routes`/`route-templates` turned out to hold only arrays of ids,
 * so this is it.
 */
export class FieldReportProductDto {
  // Required, unlike almost everything else on this track, and this is the one
  // deliberate contract change in the PR. `parseProductCatalog` drops an entry
  // missing either field and transcribes against a quietly smaller catalog —
  // worse extraction with no signal, which is the same silent-wrong-answer
  // family the earlier tiers found. The client builds this list from the API's
  // own products response, so a malformed row is a client bug rather than
  // anything a user typed.
  @IsString()
  id!: string;

  @IsString()
  name!: string;

  // Both nullable in the catalog the client sends; @IsOptional() skips null.
  @IsOptional()
  @IsString()
  sku?: string | null;

  @IsOptional()
  @IsString()
  category?: string | null;
}

export class TranscribeFieldReportDto {
  @IsOptional()
  @IsString()
  audioObjectId?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldReportProductDto)
  products?: FieldReportProductDto[] | null;
}
