import type { PlatformMfaService } from "../../src/modules/platform/platform-mfa.service";

export const TEST_CHALLENGE_EXPIRY = "2026-07-31T12:10:00.000Z";

export type TestPlatformMfaOptions = {
  /** Whether the owner already has a confirmed authenticator. */
  enrolled?: boolean;
  /** Whether a submitted TOTP code should be accepted. */
  codeValid?: boolean;
  /** Whether a submitted recovery code should be accepted. */
  recoveryCodeValid?: boolean;
  /** Set to reject the challenge token, as an expired or replayed one would. */
  claimThrows?: Error;
  /** Set to fail the enrolment step — a wrong code, or anything else. */
  confirmEnrollmentThrows?: Error;
  pendingSecret?: string | null;
  recoveryCodes?: string[];
};

export type TestPlatformMfa = PlatformMfaService & {
  readonly confirmedEnrollments: {
    platformUserId: string;
    pendingSecret: string;
  }[];
  readonly consumedRecoveryCodes: unknown[];
  readonly acceptedCodes: unknown[];
};

// PlatformMfaService without the database or a real clock. The suite runs
// under tsx (no Nest DI — see CLAUDE.md), so services are built by hand
// anyway; this keeps the login tests focused on the flow rather than on TOTP
// arithmetic, which tests/platform-mfa.test.ts covers against the real thing.
export function createTestPlatformMfa(
  options: TestPlatformMfaOptions = {},
): TestPlatformMfa {
  const confirmedEnrollments: {
    platformUserId: string;
    pendingSecret: string;
  }[] = [];
  const consumedRecoveryCodes: unknown[] = [];
  const acceptedCodes: unknown[] = [];

  const stub = {
    confirmedEnrollments,
    consumedRecoveryCodes,
    acceptedCodes,

    isEnrolled: () => options.enrolled ?? true,

    issueLoginChallenge: async () => ({
      token: "login-challenge-token",
      purpose: "login" as const,
      expiresAt: new Date(TEST_CHALLENGE_EXPIRY),
    }),

    issueEnrollmentChallenge: async () => ({
      token: "enrollment-challenge-token",
      purpose: "enrollment" as const,
      expiresAt: new Date(TEST_CHALLENGE_EXPIRY),
      secret: "PENDINGSECRET",
      otpauthUrl:
        "otpauth://totp/Vizitum:owner@vizitum.dev?secret=PENDINGSECRET",
    }),

    claimChallenge: async () => {
      if (options.claimThrows) {
        throw options.claimThrows;
      }

      return {
        id: "challenge-1",
        platformUserId: "owner-1",
        pendingSecret:
          options.pendingSecret === undefined
            ? "PENDINGSECRET"
            : options.pendingSecret,
      };
    },

    verifyTotpCode: () =>
      (options.codeValid ?? true)
        ? { valid: true as const, timeStep: 59_522_180 }
        : { valid: false as const },

    // What the login path actually calls: verify plus spend the code's step.
    // The step arithmetic and the replay refusal are covered against the real
    // service in tests/platform-mfa-replay.test.ts.
    acceptTotpCode: async (
      _platformUser: { id: string; totpSecret: string },
      code: unknown,
    ) => {
      acceptedCodes.push(code);

      return options.codeValid ?? true;
    },

    confirmEnrollment: async (
      platformUserId: string,
      pendingSecret: string,
    ) => {
      if (options.confirmEnrollmentThrows) {
        throw options.confirmEnrollmentThrows;
      }

      confirmedEnrollments.push({ platformUserId, pendingSecret });

      return options.recoveryCodes ?? ["aaaa-bbbb-cccc", "dddd-eeee-ffff"];
    },

    consumeRecoveryCode: async (
      _platformUserId: string,
      _storedHashes: string[],
      code: unknown,
    ) => {
      consumedRecoveryCodes.push(code);

      return options.recoveryCodeValid ?? false;
    },
  };

  return stub as unknown as TestPlatformMfa;
}
