import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { PIPES_METADATA } from "@nestjs/common/constants";

import { createStrictValidationPipe } from "../src/common/strict-validation-pipe";
import { AuthController } from "../src/modules/auth/auth.controller";
import {
  AcceptInviteDto,
  LoginDto,
  SwitchRoleDto,
  SwitchZoneDto,
} from "../src/modules/auth/auth.dto";
import { PasswordController } from "../src/modules/auth/password.controller";
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from "../src/modules/auth/password.dto";
import { PlatformAuthController } from "../src/modules/platform/platform-auth.controller";
import {
  PlatformLoginDto,
  PlatformMfaEnrollDto,
  PlatformMfaVerifyDto,
} from "../src/modules/platform/platform-auth.dto";

// Tier 6 of the class-validator DTO track (2.4 in
// docs/security-remediation-plan.md) — the last one: three controllers, ten
// write routes, ten DTO classes over the credential surfaces.
//
// The tier's rule is that the DTO declares the envelope and the types and
// makes no other judgement, so **most of this file pins what the DTO does not
// do**. A test that only checked "invalid input is refused" would pass just as
// well against a DTO that had quietly taken over the uniform
// INVALID_CREDENTIALS answer, the non-enumerating reset acknowledgement, or —
// worst — the refusals the platform MFA steps record.

type DtoClass = new () => object;

function bodyMetadata(metatype: DtoClass): ArgumentMetadata {
  return { type: "body", metatype, data: "" };
}

async function accept<T extends object>(
  metatype: new () => T,
  body: unknown,
): Promise<T> {
  const result = await createStrictValidationPipe().transform(
    body,
    bodyMetadata(metatype),
  );

  assert.ok(result instanceof metatype);

  return result as T;
}

async function reject(
  metatype: DtoClass,
  body: unknown,
  field: string,
): Promise<void> {
  await assert.rejects(
    createStrictValidationPipe().transform(body, bodyMetadata(metatype)),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);

      const response = error.getResponse() as {
        code?: string;
        fieldErrors?: Record<string, string[]>;
      };

      assert.equal(response.code, "VALIDATION_FAILED");
      assert.ok(
        response.fieldErrors?.[field]?.length,
        `expected a field error on ${field}, got ${JSON.stringify(response.fieldErrors)}`,
      );

      return true;
    },
  );
}

const EVERY_DTO: DtoClass[] = [
  LoginDto,
  SwitchRoleDto,
  SwitchZoneDto,
  AcceptInviteDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  PlatformLoginDto,
  PlatformMfaVerifyDto,
  PlatformMfaEnrollDto,
];

describe("every tier-6 write route with a body carries the pipe", () => {
  const gatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
    ["auth.login", AuthController.prototype.login],
    ["auth.switchRole", AuthController.prototype.switchRole],
    ["auth.switchZone", AuthController.prototype.switchZone],
    ["auth.acceptInvite", AuthController.prototype.acceptInvite],
    ["password.forgot", PasswordController.prototype.forgot],
    ["password.reset", PasswordController.prototype.reset],
    ["password.change", PasswordController.prototype.change],
    ["platformAuth.login", PlatformAuthController.prototype.login],
    ["platformAuth.verifyMfa", PlatformAuthController.prototype.verifyMfa],
    [
      "platformAuth.completeEnrollment",
      PlatformAuthController.prototype.completeEnrollment,
    ],
  ];

  const ungatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
    ["auth.me", AuthController.prototype.me],
    ["auth.logout", AuthController.prototype.logout],
    ["platformAuth.me", PlatformAuthController.prototype.me],
    ["platformAuth.logout", PlatformAuthController.prototype.logout],
  ];

  it("attaches a pipe to all ten body handlers, and to none of the other four", () => {
    for (const [name, handler] of gatedHandlers) {
      const pipes: unknown[] =
        Reflect.getMetadata(PIPES_METADATA, handler) ?? [];

      assert.equal(pipes.length, 1, `${name} should carry exactly one pipe`);
    }

    for (const [name, handler] of ungatedHandlers) {
      assert.equal(
        Reflect.getMetadata(PIPES_METADATA, handler),
        undefined,
        `${name} takes no body and should carry no pipe`,
      );
    }
  });

  it("keeps the throttle on every credential route the pipe now fronts", () => {
    // The ordering question this tier had to settle. Nest runs guards before
    // pipes, so the per-IP throttle has already charged for a request by the
    // time the DTO refuses it — a body the pipe rejects cannot be a free
    // attempt. This case pins that the throttle is still *there*: it is a
    // guard, and the pipe was added to the same handlers.
    const throttled = [
      ["auth.login", AuthController.prototype.login],
      ["auth.acceptInvite", AuthController.prototype.acceptInvite],
      ["password.forgot", PasswordController.prototype.forgot],
      ["password.reset", PasswordController.prototype.reset],
      ["password.change", PasswordController.prototype.change],
      ["platformAuth.login", PlatformAuthController.prototype.login],
      ["platformAuth.verifyMfa", PlatformAuthController.prototype.verifyMfa],
      [
        "platformAuth.completeEnrollment",
        PlatformAuthController.prototype.completeEnrollment,
      ],
    ] as const;

    for (const [name, handler] of throttled) {
      const keys = Reflect.getMetadataKeys(handler) as string[];

      assert.ok(
        keys.some((key) => key.startsWith("THROTTLER:")),
        `${name} should still carry its throttle, got ${JSON.stringify(keys)}`,
      );
      assert.ok(
        keys.includes(PIPES_METADATA),
        `${name} should carry both the throttle and the pipe`,
      );
    }
  });
});

describe("tier-6 DTOs: what all ten classes share", () => {
  it("refuses an undeclared property — the whole point of gating these ten", async () => {
    for (const dto of EVERY_DTO) {
      await reject(dto, { tenantId: "another-tenant" }, "tenantId");
    }
  });

  it("accepts an empty body, so every 'required' answer stays the service's", async () => {
    // INVALID_CREDENTIALS, INVITE_ACCEPTANCE_INVALID, PASSWORD_RESET_INVALID,
    // PASSWORD_CHANGE_INVALID and the platform's own challenge errors are all
    // unchanged by this tier.
    for (const dto of EVERY_DTO) {
      await accept(dto, {});
    }
  });

  it("accepts an empty string in every field, which is what the forms post", async () => {
    // The decisive compatibility case for the whole tier: a signed-out person
    // submitting a blank login form sends `{"email": "", "password": ""}`, and
    // that must still reach the service and come back INVALID_CREDENTIALS —
    // not VALIDATION_FAILED, which the login screen has no wording for.
    await accept(LoginDto, {
      email: "",
      password: "",
      tenantSlug: "",
      captchaToken: "",
    });
    await accept(ForgotPasswordDto, {
      email: "",
      tenantSlug: "",
      captchaToken: "",
    });
    await accept(ResetPasswordDto, { token: "", tenantSlug: "", password: "" });
    await accept(ChangePasswordDto, { currentPassword: "", newPassword: "" });
    await accept(AcceptInviteDto, {
      token: "",
      tenantSlug: "",
      firstName: "",
      lastName: "",
      password: "",
    });
    await accept(PlatformLoginDto, {
      email: "",
      password: "",
      captchaToken: "",
    });
  });
});

describe("AuthController's four bodies", () => {
  it("accepts every payload apps/web posts", async () => {
    // From apps/web/app/(workspace)/[tenantSlug]/login/page.tsx — including
    // the captchaToken, which is `""` on a deployment with no captcha.
    await accept(LoginDto, {
      email: "rep@example.com",
      password: "Demo12345!",
      tenantSlug: "demo-team",
      captchaToken: "",
    });
    await accept(SwitchRoleDto, { roleCode: "team_manager" });
    await accept(SwitchZoneDto, { zone: "field" });
    // .../invites/accept/page.tsx posts five fields; `phone` is declared
    // because the API documents it, though this form does not send it.
    await accept(AcceptInviteDto, {
      token: "an-invite-token",
      tenantSlug: "demo-team",
      firstName: "Olena",
      lastName: "Kovalchuk",
      password: "Demo12345!",
    });
    await accept(AcceptInviteDto, { phone: "+380501234567" });
  });

  it("does not cap a credential, so INVALID_CREDENTIALS stays one answer", async () => {
    // normalizePassword caps at TEXT_LIMITS.password and normalizeEmail at
    // TEXT_LIMITS.email, both answering INVALID_CREDENTIALS — the same answer
    // a wrong password gets. A cap here would add a second kind of answer to
    // the one screen item 3.1 went as far as equalizing the *timing* of.
    await accept(LoginDto, { password: "a".repeat(500) });
    await accept(LoginDto, { email: `${"a".repeat(300)}@example.com` });
    await accept(LoginDto, { tenantSlug: "a".repeat(300) });
    await accept(AcceptInviteDto, { token: "a".repeat(500) });
    await accept(AcceptInviteDto, { password: "short" });
  });

  it("leaves the role and zone vocabularies to the service", async () => {
    // Unlike AddUserRoleDto, which gates the same three values: there the DTO
    // and the normalizer share one constant in one module. auth.service.ts
    // keeps its own list because "roles a user may operate as" and "roles an
    // admin may grant" are different questions with the same answer today.
    await accept(SwitchRoleDto, { roleCode: "tenant_superadmin" });
    await accept(SwitchRoleDto, { roleCode: "nonsense" });
    await accept(SwitchZoneDto, { zone: "nonsense" });
  });

  it("caps the invite's name parts, which are not credentials", async () => {
    // The tier-standard correction: normalizeNamePart folded an over-long
    // value into the same null as a missing one, so a 200-character first name
    // came back "First name is required."
    await accept(AcceptInviteDto, { firstName: "a".repeat(120) });
    await reject(AcceptInviteDto, { firstName: "a".repeat(121) }, "firstName");
    await reject(AcceptInviteDto, { lastName: "a".repeat(121) }, "lastName");
  });

  it("refuses a non-string where a string is the only shape", async () => {
    await reject(LoginDto, { email: 42 }, "email");
    await reject(LoginDto, { password: { toString: "x" } }, "password");
    await reject(SwitchZoneDto, { zone: ["field"] }, "zone");
  });
});

describe("PasswordController's three bodies", () => {
  it("accepts every payload apps/web posts", async () => {
    await accept(ForgotPasswordDto, {
      email: "rep@example.com",
      tenantSlug: "demo-team",
      captchaToken: "",
    });
    await accept(ResetPasswordDto, {
      token: "a-reset-token",
      tenantSlug: "demo-team",
      password: "Demo12345!",
    });
    await accept(ChangePasswordDto, {
      currentPassword: "Demo12345!",
      newPassword: "Demo54321!",
    });
  });

  it("keeps the password minimum with the service, which names it", async () => {
    // "Password must be at least 8 characters." is interpolated from
    // MIN_PASSWORD_LENGTH into fieldErrors.password. A @MinLength here would
    // replace the one message a person retyping a password actually needs.
    await accept(ResetPasswordDto, { password: "short" });
    await accept(ChangePasswordDto, { newPassword: "short" });
    // And no minimum at all on the *current* password: it predates whatever
    // today's rule is, and the only question asked of it is whether it
    // verifies.
    await accept(ChangePasswordDto, { currentPassword: "x" });
  });

  it("does not give the forgot endpoint a second kind of answer", async () => {
    // requestReset acknowledges everything — unknown address, inactive
    // account, unresolvable tenant, its own per-IP bucket running dry — so
    // that it cannot be used to ask whether an address has an account. A cap
    // or a format check would make "too long to be an address" a distinct
    // answer from "nothing was sent".
    await accept(ForgotPasswordDto, { email: "not-an-email" });
    await accept(ForgotPasswordDto, { email: `${"a".repeat(300)}@x.co` });
    await accept(ForgotPasswordDto, { tenantSlug: "no-such-tenant" });
  });

  it("still refuses an undeclared property on all three", async () => {
    await reject(ForgotPasswordDto, { userId: "u1" }, "userId");
    await reject(ResetPasswordDto, { newPassword: "x" }, "newPassword");
    await reject(ChangePasswordDto, { email: "a@b.co" }, "email");
  });
});

describe("PlatformAuthController's three bodies", () => {
  it("accepts every payload apps/web posts", async () => {
    await accept(PlatformLoginDto, {
      email: "owner@platform.local",
      password: "Owner12345!",
      captchaToken: "",
    });
    // The platform login screen sends challengeToken plus exactly one of
    // code / recoveryCode, never both.
    await accept(PlatformMfaVerifyDto, {
      challengeToken: "a-challenge",
      code: "123456",
    });
    await accept(PlatformMfaVerifyDto, {
      challengeToken: "a-challenge",
      recoveryCode: "AAAA-BBBB",
    });
    await accept(PlatformMfaEnrollDto, {
      challengeToken: "a-challenge",
      code: "123456",
    });
  });

  it("type-checks nothing on either code step, so every refusal is still recorded", async () => {
    // The load-bearing case of this tier, and the rule tier 4 reached one tier
    // early on the purge's mfaCode. A pipe runs before the service:
    //
    //   - claimChallengeAudited takes the token as `unknown` and writes
    //     recordChallengeRejected for *any* claim it cannot honour;
    //   - acceptTotpCode / consumeRecoveryCode take the code as `unknown`, and
    //     a rejection is charged to the shared platform-login backoff and
    //     audited as `wrong_code`.
    //
    // `{"code": 123456}` is the shape a naive scripted guess produces by
    // default. An @IsString() here would make the laziest attack the only
    // invisible one.
    await accept(PlatformMfaVerifyDto, { challengeToken: 42, code: 123_456 });
    await accept(PlatformMfaVerifyDto, { code: null, recoveryCode: {} });
    await accept(PlatformMfaEnrollDto, { challengeToken: [], code: 0 });
  });

  it("still closes the envelope on the request that mints a platform session", async () => {
    await reject(
      PlatformMfaVerifyDto,
      { platformUserId: "u1" },
      "platformUserId",
    );
    await reject(PlatformMfaEnrollDto, { totpSecret: "s" }, "totpSecret");
    await reject(PlatformLoginDto, { challengeToken: "c" }, "challengeToken");
  });

  it("refuses a non-string on the password step, which records nothing either way", async () => {
    // Unlike the code steps: platform login refuses a missing or non-string
    // email/password *before* the captcha, the backoff and
    // recordPlatformLoginFailed, so nothing audited is skipped here.
    await reject(PlatformLoginDto, { email: 42 }, "email");
    await reject(PlatformLoginDto, { password: [] }, "password");
  });
});
