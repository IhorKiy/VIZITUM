import "reflect-metadata";
import type { SegmentTemplate } from "@prisma/client";
import {
  Allow,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";

import { TEXT_LIMITS } from "../../common/input-limits";
import { SEGMENT_TEMPLATES } from "./platform.types";

/**
 * Tier 4 of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md): the five bodies of the two
 * platform-owner controllers — tenant create/update/purge, and the tenant
 * superadmin invite/promote.
 *
 * These carry one deviation from the track's usual `@IsOptional()` idiom, and
 * it is deliberate. `@IsOptional()` admits `null` as well as `undefined`, and
 * on most routes that is exactly right because `null` means "clear this
 * field". On the tenant bodies it does not: platform.service.ts reads a
 * present field as a string (`input.name.trim()`), so `{"name": null}` is a
 * TypeError and a 500 — never a clear. So every field whose only valid
 * present value is a string uses `@ValidateIf(value !== undefined)` instead,
 * which skips an omitted field and refuses an explicit `null`. The two places
 * `null` genuinely means something — `primaryDomain` ("no domain") and
 * `adminLimit` ("follow the plan tier") — keep `@IsOptional()`.
 *
 * Length caps stay with the service throughout: `createTenant`/`updateTenant`
 * check each field against the same TEXT_LIMITS table and answer "Keep this to
 * 120 characters or fewer." per field, aggregating every failure into one
 * TENANT_INVALID / TENANT_UPDATE_INVALID response. A `@MaxLength` here would
 * replace that with a shorter answer to the same question.
 */
export class CreateTenantDto {
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  name?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  slug?: string;

  // The one enum gated here rather than in the service. It is the only field
  // on this body whose service refusal ("A valid segment template is
  // required.") does not name the allowed values, so nothing is lost by
  // moving it forward — and the tenant is created with it, so a wrong one is
  // not recoverable by a later edit. apps/web checks the same list before
  // posting, so no live screen changes.
  @ValidateIf((_dto, value) => value !== undefined)
  @IsIn(SEGMENT_TEMPLATES)
  segmentTemplate?: SegmentTemplate;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  country?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  timezone?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  language?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  contactName?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  contactEmail?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  contactPhone?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  phoneCountry?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  primaryDomain?: string;
}

/**
 * Not `extends CreateTenantDto`, for the reason `UpdateRouteTemplateDto` is
 * not either: the two bodies differ in what they may *not* carry. A tenant's
 * slug and segment template are fixed at creation and `updateTenant` ignores
 * both, so inheriting would whitelist two fields this route silently drops —
 * and a slug the caller believed they had changed is the worst kind of 200.
 */
export class UpdateTenantDto {
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  name?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  country?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  timezone?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  language?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  contactName?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  contactEmail?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  contactPhone?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  phoneCountry?: string;

  // `null` clears the domain — `input.primaryDomain?.trim() || null` — so this
  // one keeps @IsOptional().
  @IsOptional()
  @IsString()
  primaryDomain?: string | null;

  // Left a free string on purpose. The service's refusal spells out why each
  // excluded status is excluded ("Use the archive action to archive a tenant;
  // draft, provisioning, ready and active cannot be assigned — status is the
  // plan (pilot/team/business) or suspended."), which is the whole answer an
  // owner needs and more than @IsIn could give. Nor is it a dropped enum: an
  // unassignable status is refused, not written past.
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  status?: string;

  // `null` clears the per-tenant override so the cap follows the plan tier,
  // hence @IsOptional(). The ">= 1" half of the rule stays with the service,
  // whose message states both halves at once.
  @IsOptional()
  @IsInt()
  adminLimit?: number | null;

  @IsOptional()
  @IsBoolean()
  productsEnabled?: boolean | null;
}

/**
 * The tenant purge confirmation, and the one body on this tier where what the
 * DTO does *not* validate is the load-bearing decision.
 *
 * `mfaCode` carries no constraint beyond @Allow(), which whitelists the field
 * without checking it. Every code this route refuses is credential traffic:
 * platform.service.ts penalizes the failure on the shared `platform-login`
 * backoff scope and records a `recordPlatformReauthFailed` audit event, which
 * is precisely what item 3.5's alerting watches. A pipe runs *before* the
 * service, so an `@IsString()` here would turn `{"mfaCode": 123456}` — the
 * obvious shape for a scripted guess, and one the JSON encoder of a naive
 * attacker produces by default — into an unlogged, unpenalized 400. The type
 * check buys nothing (verifyTotpCode already takes `unknown` and refuses a
 * non-string) and costs the trail.
 *
 * `confirmSlug` is different: it is checked before anything is spent, and a
 * mismatch is the service's own message. It is capped at the slug limit
 * because a value longer than a slug can never match one.
 */
export class RequestTenantPurgeDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.slug)
  confirmSlug?: string | null;

  @Allow()
  mfaCode?: unknown;
}

export class InviteTenantSuperadminDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.email)
  email?: string | null;
}

export class PromoteTenantSuperadminDto {
  @IsOptional()
  @IsString()
  userId?: string | null;
}
