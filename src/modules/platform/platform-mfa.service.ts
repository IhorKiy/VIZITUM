import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { PlatformMfaChallengePurpose } from "@prisma/client";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { generateSecret, generateURI, verifySync } from "otplib";

import {
  decryptSecret,
  encryptSecret,
  isEncrypted,
  protectSecret,
  resolveSecretKey,
  type SecretKey,
} from "../../common/secret-box";
import { hashValue } from "../auth/auth-crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  MFA_CHALLENGE_TOKEN_BYTES,
  MFA_CHALLENGE_TTL_MINUTES,
  MFA_RECOVERY_CODE_COUNT,
  MFA_TOTP_ISSUER,
  MFA_TOTP_WINDOW_SECONDS,
} from "./platform-auth.constants";

/**
 * A verified code, carrying the step it belongs to.
 *
 * The step is the whole point of returning an object rather than a boolean:
 * one code is accepted across three steps, so "was this code right" is not
 * enough to know whether it has already been spent.
 */
export type TotpVerification =
  { valid: false } | { valid: true; timeStep: number };

export type IssuedChallenge = {
  token: string;
  purpose: PlatformMfaChallengePurpose;
  expiresAt: Date;
};

export type EnrollmentOffer = IssuedChallenge & {
  purpose: "enrollment";
  /** Base32 secret, for the "can't scan the code?" path. */
  secret: string;
  // The QR image is rendered by the web app from this URI rather than being
  // returned as a data URI: the enrolment page carries the challenge in a
  // cookie between the two steps, and a few kilobytes of PNG would not fit.
  otpauthUrl: string;
};

// Second factor for the platform console.
//
// TOTP rather than WebAuthn: the console is reached from whatever machine the
// owner happens to be at, WebAuthn would tie it to registered authenticators,
// and a lost key has no administrator above the platform owner to reset it.
// TOTP plus printed recovery codes keeps recovery in the owner's own hands.
@Injectable()
export class PlatformMfaService {
  private readonly logger = new Logger(PlatformMfaService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Read per call rather than cached on the instance so a key rotated in the
  // environment takes effect on the next restart of the process only — the
  // cost is parsing 32 bytes, and the alternative is a service that has to be
  // reconstructed to pick one up.
  private get secretKey(): SecretKey {
    return resolveSecretKey(process.env.TOTP_ENCRYPTION_KEY);
  }

  /**
   * The stored secret in the clear.
   *
   * Rows written before encryption existed are returned unchanged, which is
   * what lets an already-enrolled owner sign in through the deploy that turns
   * it on.
   */
  readTotpSecret(storedSecret: string): string {
    return decryptSecret(storedSecret, this.secretKey);
  }

  isEnrolled(platformUser: {
    totpSecret: string | null;
    totpConfirmedAt: Date | null;
  }): boolean {
    return Boolean(platformUser.totpSecret && platformUser.totpConfirmedAt);
  }

  /** Challenge for an owner who already has a confirmed authenticator. */
  async issueLoginChallenge(platformUserId: string): Promise<IssuedChallenge> {
    return this.createChallenge(platformUserId, "login", null);
  }

  /**
   * Challenge for an owner with no confirmed second factor, carrying a fresh
   * candidate secret.
   *
   * The secret is held on the challenge, not on the user row: writing it to
   * the user first would mark the account enrolled against a secret no
   * authenticator has yet, and there is nobody above the platform owner to
   * undo that.
   */
  async issueEnrollmentChallenge(
    platformUserId: string,
    email: string,
  ): Promise<EnrollmentOffer> {
    const secret = generateSecret();
    const challenge = await this.createChallenge(
      platformUserId,
      "enrollment",
      protectSecret(secret, this.secretKey),
    );
    const otpauthUrl = generateURI({
      strategy: "totp",
      secret,
      label: email,
      issuer: MFA_TOTP_ISSUER,
    });

    return { ...challenge, purpose: "enrollment", secret, otpauthUrl };
  }

  /**
   * Consumes a challenge token, atomically.
   *
   * The claim is a conditional updateMany rather than a read-then-write: two
   * requests racing the same token must not both come away with a session.
   */
  async claimChallenge(
    token: unknown,
    purpose: PlatformMfaChallengePurpose,
  ): Promise<{
    id: string;
    platformUserId: string;
    pendingSecret: string | null;
  }> {
    const normalizedToken = typeof token === "string" ? token.trim() : "";

    if (!normalizedToken) {
      throwChallengeInvalid();
    }

    const challenge = await this.prisma.platformMfaChallenge.findUnique({
      where: { tokenHash: hashValue(normalizedToken) },
    });

    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date()
    ) {
      throwChallengeInvalid();
    }

    const { count } = await this.prisma.platformMfaChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    if (count === 0) {
      throwChallengeInvalid();
    }

    return {
      id: challenge.id,
      platformUserId: challenge.platformUserId,
      pendingSecret: challenge.pendingSecret
        ? this.readTotpSecret(challenge.pendingSecret)
        : null,
    };
  }

  verifyTotpCode(secret: string, code: unknown): TotpVerification {
    const normalizedCode = normalizeCode(code);

    if (!normalizedCode) {
      return { valid: false };
    }

    // A tolerance either side of the current step, for the clock drift
    // between the owner's phone and the server that RFC 6238 expects.
    // otplib's declared result type is the union of its HOTP and TOTP
    // shapes, and `timeStep` survives only on the TOTP side, so the union
    // collapses it away. The value is there at runtime — `verifyTotpCode` is
    // TOTP-only by construction — and `tests/platform-mfa-replay.test.ts`
    // asserts it rather than trusting this narrowing.
    const result = verifySync({
      strategy: "totp",
      secret,
      token: normalizedCode,
      epochTolerance: MFA_TOTP_WINDOW_SECONDS,
    }) as { valid: boolean; timeStep?: number };

    // `timeStep` is the step the *token* belongs to, not the one it was
    // checked from, so the same code reports the same step throughout the
    // window it is accepted in — which is what makes it usable as the
    // replay marker.
    return result.valid && typeof result.timeStep === "number"
      ? { valid: true, timeStep: result.timeStep }
      : { valid: false };
  }

  /**
   * Completes enrolment: the code proves the authenticator holds the pending
   * secret, so the secret moves onto the user row and recovery codes are
   * issued. Returns the plaintext codes — the only time they exist outside
   * the owner's hands.
   */
  async confirmEnrollment(
    platformUserId: string,
    pendingSecret: string,
    code: unknown,
  ): Promise<string[]> {
    const verification = this.verifyTotpCode(pendingSecret, code);

    if (!verification.valid) {
      throwCodeInvalid();
    }

    const recoveryCodes = generateRecoveryCodes();

    await this.prisma.platformUser.update({
      where: { id: platformUserId },
      data: {
        totpSecret: protectSecret(pendingSecret, this.secretKey),
        totpConfirmedAt: new Date(),
        totpRecoveryCodeHashes: recoveryCodes.map(hashValue),
        // The code that proved the enrolment is spent by proving it. Without
        // this it would still be the newest step, and so would work a second
        // time as the first sign-in code.
        totpLastUsedStep: verification.timeStep,
      },
    });

    this.logger.log(
      `Platform user ${platformUserId} confirmed a second factor.`,
    );

    return recoveryCodes;
  }

  /**
   * The login path's code check: verifies, then spends the code's step so the
   * same six digits cannot be presented twice.
   *
   * One code is accepted across three steps — the current one and one either
   * side, for clock drift — so roughly ninety seconds of wall clock. Within
   * that, nothing else stops a code seen over a shoulder or captured by a
   * phishing proxy from being replayed by whoever also has the password.
   */
  async acceptTotpCode(
    platformUser: { id: string; totpSecret: string },
    code: unknown,
  ): Promise<boolean> {
    const secret = this.readTotpSecret(platformUser.totpSecret);
    const verification = this.verifyTotpCode(secret, code);

    if (!verification.valid) {
      return false;
    }

    // A conditional update rather than read-then-write: two requests
    // replaying one code concurrently would both pass a read check, and
    // exactly one of them must win.
    const { count } = await this.prisma.platformUser.updateMany({
      where: {
        id: platformUser.id,
        OR: [
          { totpLastUsedStep: null },
          { totpLastUsedStep: { lt: verification.timeStep } },
        ],
      },
      data: {
        totpLastUsedStep: verification.timeStep,
        // Upgrades a secret still stored in the clear, on the first sign-in
        // after encryption is switched on. Written in the same statement so
        // it cannot half-happen, and skipped entirely when the value is
        // already an envelope or no key is configured.
        ...this.reencryptedSecret(platformUser.totpSecret, secret),
      },
    });

    if (count === 0) {
      this.logger.warn(
        `Platform user ${platformUser.id} presented an already-used code.`,
      );
    }

    return count === 1;
  }

  private reencryptedSecret(
    storedSecret: string,
    plaintextSecret: string,
  ): { totpSecret?: string } {
    const key = this.secretKey;

    return key && !isEncrypted(storedSecret)
      ? { totpSecret: encryptSecret(plaintextSecret, key) }
      : {};
  }

  /**
   * Spends a recovery code, if the supplied value is one.
   *
   * Single use: the hash is struck from the list in the same conditional
   * update that accepts it, so the same slip of paper cannot be replayed —
   * and neither can two concurrent requests both spend the same code.
   */
  async consumeRecoveryCode(
    platformUserId: string,
    storedHashes: string[],
    code: unknown,
  ): Promise<boolean> {
    const normalizedCode = normalizeRecoveryCode(code);

    if (!normalizedCode) {
      return false;
    }

    const candidateHash = hashValue(normalizedCode);
    const matched = storedHashes.some((storedHash) =>
      safeEqual(storedHash, candidateHash),
    );

    if (!matched) {
      return false;
    }

    const remaining = storedHashes.filter(
      (storedHash) => !safeEqual(storedHash, candidateHash),
    );
    const { count } = await this.prisma.platformUser.updateMany({
      where: {
        id: platformUserId,
        totpRecoveryCodeHashes: { has: candidateHash },
      },
      data: { totpRecoveryCodeHashes: remaining },
    });

    if (count === 0) {
      return false;
    }

    this.logger.warn(
      `Platform user ${platformUserId} signed in with a recovery code; ${remaining.length} left.`,
    );

    return true;
  }

  private async createChallenge(
    platformUserId: string,
    purpose: PlatformMfaChallengePurpose,
    pendingSecret: string | null,
  ): Promise<IssuedChallenge> {
    // Anything still outstanding for this user is dropped first: a second
    // password entry should not leave the previous half-authenticated token
    // usable.
    await this.prisma.platformMfaChallenge.updateMany({
      where: { platformUserId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const token = randomBytes(MFA_CHALLENGE_TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(
      Date.now() + MFA_CHALLENGE_TTL_MINUTES * 60 * 1_000,
    );

    await this.prisma.platformMfaChallenge.create({
      data: {
        platformUserId,
        tokenHash: hashValue(token),
        purpose,
        pendingSecret,
        expiresAt,
      },
    });

    return { token, purpose, expiresAt };
  }
}

// Six digits, spaces and dashes tolerated: authenticator apps display them
// grouped, and people copy what they see.
function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const digits = value.replace(/[\s-]/g, "");

  return /^\d{6}$/.test(digits) ? digits : null;
}

function normalizeRecoveryCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s/g, "");

  return /^[a-z0-9]{4}-?[a-z0-9]{4}-?[a-z0-9]{4}$/.test(normalized)
    ? normalized.replace(/-/g, "").replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3")
    : null;
}

// Three groups of four from an unambiguous alphabet — no 0/o or 1/l, because
// these get written down and read back under stress.
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function generateRecoveryCodes(): string[] {
  return Array.from({ length: MFA_RECOVERY_CODE_COUNT }, () => {
    const characters = Array.from(
      { length: 12 },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
    ).join("");

    return `${characters.slice(0, 4)}-${characters.slice(4, 8)}-${characters.slice(8)}`;
  });
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function throwChallengeInvalid(): never {
  throw new BadRequestException({
    code: "MFA_CHALLENGE_INVALID",
    message: "This sign-in attempt has expired. Start again.",
  });
}

function throwCodeInvalid(): never {
  throw new BadRequestException({
    code: "MFA_CODE_INVALID",
    message: "That code is not valid.",
  });
}
