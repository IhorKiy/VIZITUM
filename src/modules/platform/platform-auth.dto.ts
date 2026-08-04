import "reflect-metadata";
import { Allow, IsOptional, IsString } from "class-validator";

/**
 * Tier 6: `PlatformAuthController`'s three bodies — the last routes on the
 * track and the ones it deferred longest. The tier's rule is at the top of
 * auth.dto.ts; here its third reason, *the refusals are recorded*, decides
 * almost everything, so two of these three classes validate nothing at all.
 *
 * This is the rule tier 4 arrived at one tier early, on `mfaCode` at
 * `POST /platform/tenants/:tenantId/purge`, and it generalizes exactly as that
 * one predicted: **on a route whose refusal is itself a recorded security
 * event, the DTO must not be the layer that refuses.** A pipe runs before the
 * service; the service is what charges the backoff and writes the trail.
 */
export class PlatformLoginDto {
  /**
   * The password step is the exception on this controller: like the tenant
   * login, it refuses a missing or non-string email/password *before* the
   * captcha, the backoff and `recordPlatformLoginFailed`, so a malformed body
   * has never been a recorded attempt and `@IsString()` skips nothing.
   */
  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @IsString()
  password?: string | null;

  @IsOptional()
  @IsString()
  captchaToken?: string | null;
}

/**
 * The code step. Every field carries `@Allow()` — whitelisted, unvalidated —
 * and each for its own recorded reason:
 *
 * - **`challengeToken`.** `claimChallengeAudited` takes it as `unknown` and
 *   writes `recordChallengeRejected` for *any* claim it cannot honour,
 *   malformed included. An `@IsString()` here would turn
 *   `{"challengeToken": 42}` into a 400 that leaves no trace, on the step that
 *   exists to be watched.
 * - **`code` / `recoveryCode`.** Both reach `acceptTotpCode` /
 *   `consumeRecoveryCode`, which already take `unknown`, and a rejection is
 *   charged to the shared `platform-login` backoff and audited as
 *   `wrong_code`. `{"code": 123456}` is the shape a naive scripted guess
 *   produces by default; refusing it at the pipe would make the laziest attack
 *   the only invisible one.
 *
 * The class still earns its place: `whitelist`/`forbidNonWhitelisted` refuse
 * any property these three do not name, which is the anti-mass-assignment
 * property the track exists for, on the request that mints a platform session.
 *
 * `apps/web` sends `challengeToken` plus exactly one of `code`/`recoveryCode`,
 * never both — hence three optional fields rather than a required pair.
 */
export class PlatformMfaVerifyDto {
  @Allow()
  challengeToken?: unknown;

  @Allow()
  code?: unknown;

  @Allow()
  recoveryCode?: unknown;
}

/**
 * Enrolment ends in a session, so it is a sign-in and gets the same treatment.
 * Its wrong-code path is audited by `confirmEnrollmentAudited`, added
 * precisely because it "was the one that wrote nothing, so somebody working
 * through codes against the enrolment step left no trace while the same
 * attempt against the login step did" — a hole this DTO must not reopen from
 * one layer up.
 */
export class PlatformMfaEnrollDto {
  @Allow()
  challengeToken?: unknown;

  @Allow()
  code?: unknown;
}
