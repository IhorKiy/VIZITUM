import type { PermissionCode } from "../roles/permissions";
import type { PlatformRoleCode } from "../roles/role-permission.matrix";

export const PLATFORM_OWNER_ROLE_CODE: PlatformRoleCode = "platform_owner";

export type PlatformLoginRequestBody = {
  email?: string;
  password?: string;
  captchaToken?: unknown;
};

export type PlatformMfaVerifyRequestBody = {
  challengeToken?: unknown;
  code?: unknown;
  recoveryCode?: unknown;
};

export type PlatformMfaEnrollRequestBody = {
  challengeToken?: unknown;
  code?: unknown;
};

export type PlatformSessionResponse = {
  platformUser: {
    id: string;
    email: string;
    name: string;
    status: string;
  };
  roleCodes: PlatformRoleCode[];
  permissions: PermissionCode[];
  /** How many single-use recovery codes are still unspent. */
  recoveryCodesRemaining?: number;
};

/**
 * What POST /platform/auth/login answers with now: either a session, or the
 * second step it still needs.
 *
 * A password alone never yields a session — see PlatformMfaService. When the
 * owner has no confirmed authenticator the answer is an enrolment offer, not
 * a way in: "not enrolled" is a state you pass through, never sit in.
 */
export type PlatformLoginResponse =
  | ({ step: "session" } & PlatformSessionResponse)
  | {
      step: "mfa";
      challengeToken: string;
      expiresAt: string;
    }
  | {
      step: "mfa-enrollment";
      challengeToken: string;
      expiresAt: string;
      secret: string;
      otpauthUrl: string;
    };

/** Returned once, on the request that completes enrolment. */
export type PlatformMfaEnrollResponse = {
  step: "session";
  recoveryCodes: string[];
} & PlatformSessionResponse;
