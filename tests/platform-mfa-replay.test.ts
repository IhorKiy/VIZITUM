import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import { generateSecret, generateSync } from "otplib";

import { encryptSecret } from "../src/common/secret-box";
import { PlatformMfaService } from "../src/modules/platform/platform-mfa.service";

// One TOTP code is accepted across three steps — the current one and one
// either side, for the clock drift RFC 6238 expects — so roughly ninety
// seconds of wall clock. Within that window nothing else stopped the same six
// digits, seen over a shoulder or captured by a phishing proxy, from being
// spent more than once by whoever also had the password.
describe("platform TOTP replay guard", () => {
  it("reports the step each code belongs to, not the step it is checked from", () => {
    const service = new PlatformMfaService(createStore().prisma as never);
    const secret = generateSecret();
    // Mid-step, so a boundary crossing during the test cannot push either
    // code outside the drift tolerance.
    const epoch = Math.floor(Date.now() / 1000 / 30) * 30 + 15;
    const current = service.verifyTotpCode(
      secret,
      generateSync({ strategy: "totp", secret, epoch }),
    );
    // Accepted by the drift tolerance even though it belongs to the step
    // before the one it is being checked from.
    const previous = service.verifyTotpCode(
      secret,
      generateSync({ strategy: "totp", secret, epoch: epoch - 30 }),
    );

    assert.equal(current.valid, true);
    assert.equal(previous.valid, true);
    assert.equal(current.valid && current.timeStep, Math.floor(epoch / 30));
    // The property the whole guard rests on. If a code reported the step it
    // was *checked* from, every code in the window would report the same
    // number, the marker would advance on its own, and nothing would ever be
    // refused as a replay.
    assert.equal(
      previous.valid && current.valid && current.timeStep - previous.timeStep,
      1,
    );
  });

  it("refuses a code that has already been spent", async () => {
    const store = createStore();
    const service = new PlatformMfaService(store.prisma as never);
    const secret = generateSecret();
    const code = generateSync({ strategy: "totp", secret });
    const platformUser = { id: "owner-1", totpSecret: secret };

    assert.equal(await service.acceptTotpCode(platformUser, code), true);
    // Same code, still inside its ~90-second window: previously this was a
    // second working sign-in.
    assert.equal(await service.acceptTotpCode(platformUser, code), false);
    assert.equal(await service.acceptTotpCode(platformUser, code), false);
  });

  it("lets two concurrent replays through exactly once", async () => {
    const store = createStore();
    const service = new PlatformMfaService(store.prisma as never);
    const secret = generateSecret();
    const code = generateSync({ strategy: "totp", secret });
    const platformUser = { id: "owner-1", totpSecret: secret };

    // A read-then-write check would let both of these pass.
    const results = await Promise.all([
      service.acceptTotpCode(platformUser, code),
      service.acceptTotpCode(platformUser, code),
    ]);

    assert.deepEqual(results.filter(Boolean).length, 1);
  });

  it("still accepts the next code, so the owner is never locked out", async () => {
    const store = createStore();
    const service = new PlatformMfaService(store.prisma as never);
    const secret = generateSecret();
    const now = Math.floor(Date.now() / 1000 / 30) * 30 + 15;
    const platformUser = { id: "owner-1", totpSecret: secret };

    assert.equal(
      await service.acceptTotpCode(
        platformUser,
        generateSync({ strategy: "totp", secret, epoch: now }),
      ),
      true,
    );

    // A code from the following step is newer than the marker, so it is
    // accepted — the guard refuses reuse, not the next sign-in.
    const nextStepCode = generateSync({
      strategy: "totp",
      secret,
      epoch: now + 30,
    });

    // Asserted rather than guarded against: two adjacent steps producing the
    // same six digits is a one-in-a-million coincidence, and skipping the
    // check when it happens would make this test silently prove nothing.
    assert.notEqual(
      nextStepCode,
      generateSync({ strategy: "totp", secret, epoch: now }),
    );
    assert.equal(
      await service.acceptTotpCode(platformUser, nextStepCode),
      true,
    );
  });

  it("refuses a wrong code without moving the marker", async () => {
    const store = createStore();
    const service = new PlatformMfaService(store.prisma as never);
    const secret = generateSecret();
    const platformUser = { id: "owner-1", totpSecret: secret };

    assert.equal(await service.acceptTotpCode(platformUser, "000000"), false);
    assert.equal(store.users[0].totpLastUsedStep, undefined);

    assert.equal(
      await service.acceptTotpCode(
        platformUser,
        generateSync({ strategy: "totp", secret }),
      ),
      true,
    );
  });

  describe("secrets at rest", () => {
    const key = randomBytes(32);

    it("verifies against an encrypted secret", async () => {
      const restore = withEncryptionKey(key);

      try {
        const store = createStore();
        const service = new PlatformMfaService(store.prisma as never);
        const secret = generateSecret();

        assert.equal(
          await service.acceptTotpCode(
            { id: "owner-1", totpSecret: encryptSecret(secret, key) },
            generateSync({ strategy: "totp", secret }),
          ),
          true,
        );
      } finally {
        restore();
      }
    });

    it("upgrades a secret still stored in the clear on the next sign-in", async () => {
      const restore = withEncryptionKey(key);

      try {
        const store = createStore();
        const service = new PlatformMfaService(store.prisma as never);
        const secret = generateSecret();

        assert.equal(
          await service.acceptTotpCode(
            { id: "owner-1", totpSecret: secret },
            generateSync({ strategy: "totp", secret }),
          ),
          true,
        );

        // Written in the same statement as the replay marker, so the upgrade
        // cannot half-happen.
        const stored = store.users[0].totpSecret as string;

        assert.ok(
          stored.startsWith("v1."),
          `expected an envelope, got ${stored}`,
        );
        assert.ok(!stored.includes(secret));
      } finally {
        restore();
      }
    });

    it("leaves the secret alone when no key is configured", async () => {
      const store = createStore();
      const service = new PlatformMfaService(store.prisma as never);
      const secret = generateSecret();

      assert.equal(
        await service.acceptTotpCode(
          { id: "owner-1", totpSecret: secret },
          generateSync({ strategy: "totp", secret }),
        ),
        true,
      );
      assert.equal(store.users[0].totpSecret, undefined);
    });
  });
});

function withEncryptionKey(key: Buffer): () => void {
  const previous = process.env.TOTP_ENCRYPTION_KEY;

  process.env.TOTP_ENCRYPTION_KEY = key.toString("base64");

  return () => {
    if (previous === undefined) {
      delete process.env.TOTP_ENCRYPTION_KEY;
    } else {
      process.env.TOTP_ENCRYPTION_KEY = previous;
    }
  };
}

// Enough of platformUser.updateMany to model the conditional claim: the row
// updates only when the where clause still matches, which is what makes the
// guard safe against two requests racing one code.
function createStore() {
  const users: Record<string, unknown>[] = [{ id: "owner-1" }];

  return {
    users,
    prisma: {
      platformUser: {
        updateMany: async ({
          where,
          data,
        }: {
          where: {
            id: string;
            OR?: { totpLastUsedStep?: null | { lt: number } }[];
          };
          data: Record<string, unknown>;
        }) => {
          const user = users.find((candidate) => candidate.id === where.id);

          if (!user) {
            return { count: 0 };
          }

          const lastStep = user.totpLastUsedStep as number | undefined;
          const matches = (where.OR ?? []).some((clause) =>
            clause.totpLastUsedStep === null
              ? lastStep === undefined
              : typeof clause.totpLastUsedStep === "object" &&
                lastStep !== undefined &&
                lastStep < clause.totpLastUsedStep.lt,
          );

          if (!matches) {
            return { count: 0 };
          }

          Object.assign(user, data);

          return { count: 1 };
        },
      },
    },
  };
}
