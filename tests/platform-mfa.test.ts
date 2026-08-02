import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { generateSecret, generateSync } from "otplib";

import { hashValue } from "../src/modules/auth/auth-crypto";
import { PlatformAuthService } from "../src/modules/platform/platform-auth.service";
import { PlatformMfaService } from "../src/modules/platform/platform-mfa.service";
import { createTestLoginBackoff } from "./fixtures/login-backoff";
import { createTestPlatformMfa } from "./fixtures/platform-mfa";
import { createTestAuthAudit } from "./fixtures/auth-audit";

// A fake of just the two Prisma delegates PlatformMfaService touches. The
// suite runs under tsx, so services are constructed by hand (see CLAUDE.md).
function createMfaPrisma(
  seed: {
    challenges?: Record<string, unknown>[];
    platformUsers?: Record<string, unknown>[];
  } = {},
) {
  const challenges = seed.challenges ?? [];
  const platformUsers = seed.platformUsers ?? [];

  return {
    challenges,
    platformUsers,
    platformMfaChallenge: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        challenges.push({ id: `challenge-${challenges.length + 1}`, ...data });

        return challenges.at(-1);
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        challenges.find(
          (challenge) => challenge.tokenHash === where.tokenHash,
        ) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const matched = challenges.filter((challenge) => {
          if (where.id !== undefined && challenge.id !== where.id) {
            return false;
          }

          if (
            where.platformUserId !== undefined &&
            challenge.platformUserId !== where.platformUserId
          ) {
            return false;
          }

          return where.consumedAt !== null || !challenge.consumedAt;
        });

        for (const challenge of matched) {
          Object.assign(challenge, data);
        }

        return { count: matched.length };
      },
    },
    platformUser: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const user = platformUsers.find((candidate) => candidate.id === where.id);
        Object.assign(user ?? {}, data);

        return user;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; totpRecoveryCodeHashes?: { has: string } };
        data: Record<string, unknown>;
      }) => {
        const user = platformUsers.find(
          (candidate) => candidate.id === where.id,
        ) as { totpRecoveryCodeHashes?: string[] } | undefined;
        const required = where.totpRecoveryCodeHashes?.has;

        if (!user || (required && !user.totpRecoveryCodeHashes?.includes(required))) {
          return { count: 0 };
        }

        Object.assign(user, data);

        return { count: 1 };
      },
    },
  };
}

describe("platform TOTP", () => {
  it("accepts the code the owner's authenticator is showing", () => {
    const prisma = createMfaPrisma();
    const service = new PlatformMfaService(prisma as never);
    const secret = generateSecret();

    assert.equal(
      service.verifyTotpCode(secret, generateSync({ strategy: "totp", secret })),
      true,
    );
  });

  it("rejects a wrong code, a malformed one and a code for another secret", () => {
    const service = new PlatformMfaService(createMfaPrisma() as never);
    const secret = generateSecret();
    const otherSecret = generateSecret();

    assert.equal(service.verifyTotpCode(secret, "000000"), false);
    assert.equal(service.verifyTotpCode(secret, "12345"), false);
    assert.equal(service.verifyTotpCode(secret, "abcdef"), false);
    assert.equal(service.verifyTotpCode(secret, undefined), false);
    assert.equal(
      service.verifyTotpCode(
        secret,
        generateSync({ strategy: "totp", secret: otherSecret }),
      ),
      false,
    );
  });

  it("tolerates the spacing an authenticator app displays", () => {
    // People copy what they see, and apps group the digits.
    const service = new PlatformMfaService(createMfaPrisma() as never);
    const secret = generateSecret();
    const code = generateSync({ strategy: "totp", secret });

    assert.equal(
      service.verifyTotpCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`),
      true,
    );
  });

  it("reports an account as enrolled only once a code has confirmed it", () => {
    const service = new PlatformMfaService(createMfaPrisma() as never);

    assert.equal(
      service.isEnrolled({ totpSecret: null, totpConfirmedAt: null }),
      false,
    );
    // A secret with no confirmation is a half-finished enrolment: nobody has
    // proved an authenticator holds it.
    assert.equal(
      service.isEnrolled({ totpSecret: "SECRET", totpConfirmedAt: null }),
      false,
    );
    assert.equal(
      service.isEnrolled({ totpSecret: "SECRET", totpConfirmedAt: new Date() }),
      true,
    );
  });
});

describe("platform MFA challenges", () => {
  it("holds the candidate secret on the challenge, not on the account", async () => {
    const prisma = createMfaPrisma({
      platformUsers: [{ id: "owner-1", totpSecret: null }],
    });
    const service = new PlatformMfaService(prisma as never);

    await service.issueEnrollmentChallenge("owner-1", "owner@vizitum.dev");

    // Writing it to the user first would mark the account enrolled against a
    // secret no authenticator has yet — and there is nobody above the
    // platform owner to undo that.
    assert.equal(prisma.platformUsers[0].totpSecret, null);
    assert.ok(prisma.challenges[0].pendingSecret);
  });

  it("spends a challenge exactly once", async () => {
    const prisma = createMfaPrisma();
    const service = new PlatformMfaService(prisma as never);
    const challenge = await service.issueLoginChallenge("owner-1");

    const claimed = await service.claimChallenge(challenge.token, "login");
    assert.equal(claimed.platformUserId, "owner-1");

    await assert.rejects(
      () => service.claimChallenge(challenge.token, "login"),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code?: string }).code,
          "MFA_CHALLENGE_INVALID",
        );

        return true;
      },
    );
  });

  it("refuses a challenge claimed for the wrong purpose", async () => {
    // An enrolment challenge carries a secret nobody has confirmed; letting
    // it satisfy the login step would be a way in without a second factor.
    const prisma = createMfaPrisma();
    const service = new PlatformMfaService(prisma as never);
    const challenge = await service.issueEnrollmentChallenge(
      "owner-1",
      "owner@vizitum.dev",
    );

    await assert.rejects(() => service.claimChallenge(challenge.token, "login"));
  });

  it("refuses an expired challenge", async () => {
    const prisma = createMfaPrisma();
    const service = new PlatformMfaService(prisma as never);
    const challenge = await service.issueLoginChallenge("owner-1");

    prisma.challenges[0].expiresAt = new Date(Date.now() - 1_000);

    await assert.rejects(() => service.claimChallenge(challenge.token, "login"));
  });

  it("drops an outstanding challenge when a new one is issued", async () => {
    const prisma = createMfaPrisma();
    const service = new PlatformMfaService(prisma as never);
    const first = await service.issueLoginChallenge("owner-1");

    await service.issueLoginChallenge("owner-1");

    // Entering the password again must not leave the previous
    // half-authenticated token usable.
    await assert.rejects(() => service.claimChallenge(first.token, "login"));
  });

  it("refuses an absent or non-string token", async () => {
    const service = new PlatformMfaService(createMfaPrisma() as never);

    await assert.rejects(() => service.claimChallenge(undefined, "login"));
    await assert.rejects(() => service.claimChallenge("", "login"));
    await assert.rejects(() => service.claimChallenge(42, "login"));
  });
});

describe("platform MFA enrolment and recovery", () => {
  it("commits the secret and issues recovery codes only on a valid code", async () => {
    const prisma = createMfaPrisma({
      platformUsers: [
        {
          id: "owner-1",
          totpSecret: null,
          totpConfirmedAt: null,
          totpRecoveryCodeHashes: [],
        },
      ],
    });
    const service = new PlatformMfaService(prisma as never);
    const secret = generateSecret();

    await assert.rejects(
      () => service.confirmEnrollment("owner-1", secret, "000000"),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code?: string }).code,
          "MFA_CODE_INVALID",
        );

        return true;
      },
    );
    assert.equal(prisma.platformUsers[0].totpSecret, null);

    const recoveryCodes = await service.confirmEnrollment(
      "owner-1",
      secret,
      generateSync({ strategy: "totp", secret }),
    );

    assert.equal(prisma.platformUsers[0].totpSecret, secret);
    assert.ok(prisma.platformUsers[0].totpConfirmedAt);
    assert.equal(recoveryCodes.length, 10);
    // Stored hashed, for the same reason session tokens are: a database read
    // must not hand over working credentials.
    assert.deepEqual(
      prisma.platformUsers[0].totpRecoveryCodeHashes,
      recoveryCodes.map(hashValue),
    );
    assert.ok(
      recoveryCodes.every((code) => /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(code)),
    );
    assert.equal(new Set(recoveryCodes).size, recoveryCodes.length);
  });

  it("spends a recovery code once and leaves the rest", async () => {
    const codes = ["aaaa-bbbb-cccc", "dddd-eeee-ffff"];
    const hashes = codes.map(hashValue);
    const prisma = createMfaPrisma({
      platformUsers: [{ id: "owner-1", totpRecoveryCodeHashes: [...hashes] }],
    });
    const service = new PlatformMfaService(prisma as never);

    assert.equal(
      await service.consumeRecoveryCode("owner-1", [...hashes], codes[0]),
      true,
    );
    assert.deepEqual(prisma.platformUsers[0].totpRecoveryCodeHashes, [
      hashes[1],
    ]);

    // The same slip of paper cannot be replayed.
    assert.equal(
      await service.consumeRecoveryCode(
        "owner-1",
        prisma.platformUsers[0].totpRecoveryCodeHashes as string[],
        codes[0],
      ),
      false,
    );
  });

  it("accepts a recovery code however it was written down", async () => {
    const code = "aaaa-bbbb-cccc";
    const hashes = [hashValue(code)];
    const prisma = createMfaPrisma({
      platformUsers: [{ id: "owner-1", totpRecoveryCodeHashes: [...hashes] }],
    });
    const service = new PlatformMfaService(prisma as never);

    assert.equal(
      await service.consumeRecoveryCode("owner-1", hashes, " AAAA BBBB CCCC "),
      true,
    );
  });

  it("rejects a code that is not one of the owner's", async () => {
    const hashes = [hashValue("aaaa-bbbb-cccc")];
    const prisma = createMfaPrisma({
      platformUsers: [{ id: "owner-1", totpRecoveryCodeHashes: [...hashes] }],
    });
    const service = new PlatformMfaService(prisma as never);

    assert.equal(
      await service.consumeRecoveryCode("owner-1", hashes, "zzzz-zzzz-zzzz"),
      false,
    );
    assert.equal(
      await service.consumeRecoveryCode("owner-1", hashes, "not-a-code"),
      false,
    );
    assert.deepEqual(prisma.platformUsers[0].totpRecoveryCodeHashes, hashes);
  });
});

describe("platform login requires a second factor", () => {
  const owner = {
    id: "owner-1",
    email: "owner@vizitum.dev",
    name: "Platform Owner",
    passwordHash: "hash",
    status: "active",
    totpSecret: "SECRET",
    totpConfirmedAt: new Date(),
    totpRecoveryCodeHashes: ["hash-a"],
  };

  function createService(
    mfa: ReturnType<typeof createTestPlatformMfa>,
    sessions: unknown[] = [],
  ) {
    return new PlatformAuthService(
      {
        platformUser: {
          findUnique: async () => owner,
          update: async () => owner,
        },
      } as never,
      { verifyPassword: async () => true } as never,
      {
        createSession: async (input: unknown) => {
          sessions.push(input);

          return { token: "platform-token", session: { id: "session-1" } };
        },
      } as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
      mfa,
      createTestAuthAudit(),
    );
  }

  const request = { header: () => undefined } as never;
  const response = { cookie: () => {} } as never;

  it("offers enrolment instead of a session when the owner has no authenticator", async () => {
    const sessions: unknown[] = [];
    const service = createService(
      createTestPlatformMfa({ enrolled: false }),
      sessions,
    );

    const result = await service.login(
      { email: "owner@vizitum.dev", password: "secret" },
      request,
      response,
    );

    // "Not enrolled" has to be a state the owner passes through, never one
    // they can keep signing in from.
    assert.equal(result.step, "mfa-enrollment");
    assert.equal(sessions.length, 0);
  });

  it("refuses a wrong code and charges it like a wrong password", async () => {
    const backoff = createTestLoginBackoff();
    const sessions: unknown[] = [];
    const service = new PlatformAuthService(
      {
        platformUser: {
          findUnique: async () => owner,
          update: async () => owner,
        },
      } as never,
      { verifyPassword: async () => true } as never,
      {
        createSession: async (input: unknown) => {
          sessions.push(input);

          return { token: "platform-token", session: { id: "session-1" } };
        },
      } as never,
      { assertValidToken: async () => {} } as never,
      backoff,
      createTestPlatformMfa({ codeValid: false }),
      createTestAuthAudit(),
    );

    await assert.rejects(
      () =>
        service.verifyMfa(
          { challengeToken: "login-challenge-token", code: "000000" },
          request,
          response,
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code?: string }).code,
          "MFA_CODE_INVALID",
        );

        return true;
      },
    );

    assert.equal(sessions.length, 0);
    // A six-digit code must not be guessable at speed.
    assert.deepEqual(
      backoff.delays.map((entry) => entry.scope),
      ["platform-login"],
    );
  });

  it("lets a recovery code stand in for the authenticator", async () => {
    const sessions: unknown[] = [];
    const mfa = createTestPlatformMfa({ recoveryCodeValid: true });
    const service = createService(mfa, sessions);

    const result = await service.verifyMfa(
      {
        challengeToken: "login-challenge-token",
        recoveryCode: "aaaa-bbbb-cccc",
      },
      request,
      response,
    );

    assert.equal(result.step, "session");
    assert.equal(sessions.length, 1);
    assert.deepEqual(mfa.consumedRecoveryCodes, ["aaaa-bbbb-cccc"]);
  });

  it("refuses a recovery code that is not the owner's", async () => {
    const sessions: unknown[] = [];
    const service = createService(
      createTestPlatformMfa({ recoveryCodeValid: false }),
      sessions,
    );

    await assert.rejects(() =>
      service.verifyMfa(
        { challengeToken: "login-challenge-token", recoveryCode: "zzzz" },
        request,
        response,
      ),
    );
    assert.equal(sessions.length, 0);
  });

  it("returns the recovery codes once, on the request that enrols", async () => {
    const sessions: unknown[] = [];
    const service = createService(
      createTestPlatformMfa({ enrolled: false }),
      sessions,
    );

    const result = await service.completeEnrollment(
      { challengeToken: "enrollment-challenge-token", code: "123456" },
      request,
      response,
    );

    assert.equal(result.step, "session");
    assert.deepEqual(result.recoveryCodes, [
      "aaaa-bbbb-cccc",
      "dddd-eeee-ffff",
    ]);
    assert.equal(sessions.length, 1);
  });

  it("refuses an enrolment challenge with no pending secret", async () => {
    const service = createService(
      createTestPlatformMfa({ enrolled: false, pendingSecret: null }),
    );

    await assert.rejects(
      () =>
        service.completeEnrollment(
          { challengeToken: "enrollment-challenge-token", code: "123456" },
          request,
          response,
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code?: string }).code,
          "MFA_CHALLENGE_INVALID",
        );

        return true;
      },
    );
  });
});
