import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import { hashValue } from "../src/modules/auth/auth-crypto";
import { PasswordResetService } from "../src/modules/auth/password-reset.service";

// A password-reset token is meant to be single-use. It was single-use
// *sequentially* — a later attempt did fail — but nothing claimed it, which is
// the only case a race cares about (audit F7).
//
// `resetPassword` read the token, checked `usedAt`, and much later spent it
// with a plain `update({ where: { id } })` that was not conditional on `usedAt`
// still being null. Two concurrent requests carrying the same token both passed
// the check, both entered the transaction and both committed: under Read
// Committed the second UPDATE waits for the first to release the row and then
// applies on top. Both callers were told they had succeeded, and the account
// ended up with whichever password committed last.
//
// The window is unusually wide for a TOCTOU because `hashPassword` runs between
// the check and the transaction, and argon2 is deliberately expensive — this is
// a window of order a hundred milliseconds, not microseconds.
//
// The scenario that makes it matter: a reset link is exposed (a forwarded mail,
// a shared inbox, a device someone else also holds). Without a claim, whoever
// submits at the same moment can land their own password while the legitimate
// user's reset silently loses and still reports success.

const TENANT_ID = "tenant-a";
const USER_ID = "user-a";
const TOKEN = "reset-token-value";

describe("password reset race", () => {
  it("claims the token inside the transaction, so the loser of a race changes nothing", async () => {
    const store = createStore({ claimedCount: 0 });
    const service = createService(store.prisma);

    await assert.rejects(
      () =>
        service.resetPassword(
          { token: TOKEN, password: "new-password-1" },
          request,
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code?: string }).code,
          "PASSWORD_RESET_INVALID",
        );

        return true;
      },
    );

    // The whole point: the loser attempted the claim and stopped there. No
    // password was written, no sessions revoked, no sibling tokens deleted.
    assert.deepEqual(
      store.writes.map((write) => write.model),
      ["passwordResetToken.updateMany"],
    );
    // And it never reports success, so the legitimate holder learns the link
    // is spent instead of believing their password landed.
    assert.deepEqual(store.auditEvents, []);
  });

  it("makes the claim conditional on the token still being unspent", async () => {
    const store = createStore();
    const service = createService(store.prisma);

    await service.resetPassword(
      { token: TOKEN, password: "new-password-1" },
      request,
    );

    const claim = store.writes.find(
      (write) => write.model === "passwordResetToken.updateMany",
    );

    // `usedAt: null` in the where is the entire fix — an unconditional update
    // by id would restore the race while every other assertion in this suite
    // still passed.
    assert.deepEqual((claim?.args as { where: unknown }).where, {
      id: "token-1",
      usedAt: null,
    });
  });

  it("spends the token in the same transaction as the password write", async () => {
    const store = createStore();
    const service = createService(store.prisma);

    await service.resetPassword(
      { token: TOKEN, password: "new-password-1" },
      request,
    );

    // One transaction, and the claim is the first thing in it. A claim outside
    // the transaction would spend the token even when the password write then
    // failed, stranding whoever holds the only link they have.
    assert.equal(store.transactionCount.value, 1);
    assert.deepEqual(
      store.writes.map((write) => write.model),
      [
        "passwordResetToken.updateMany",
        "user.update",
        "passwordResetToken.deleteMany",
        "session.updateMany",
      ],
    );
    assert.deepEqual(
      store.writes.map((write) => write.insideTransaction),
      [true, true, true, true],
    );
  });
});

function createStore(options: { claimedCount?: number } = {}) {
  const writes: { model: string; args: unknown; insideTransaction: boolean }[] =
    [];
  const auditEvents: { eventType: string }[] = [];
  const transactionCount = { value: 0 };
  const inTransaction = { value: false };
  const record = (model: string, args: unknown) => {
    writes.push({ model, args, insideTransaction: inTransaction.value });
  };
  const transactionClient = {
    passwordResetToken: {
      updateMany: async (args: unknown) => {
        record("passwordResetToken.updateMany", args);

        return { count: options.claimedCount ?? 1 };
      },
      deleteMany: async (args: unknown) => {
        record("passwordResetToken.deleteMany", args);

        return { count: 0 };
      },
    },
    user: {
      update: async (args: unknown) => {
        record("user.update", args);

        return args;
      },
    },
    session: {
      updateMany: async (args: unknown) => {
        record("session.updateMany", args);

        return { count: 0 };
      },
    },
  };

  return {
    writes,
    auditEvents,
    transactionCount,
    prisma: {
      passwordResetToken: {
        findUnique: async () => ({
          id: "token-1",
          tenantId: TENANT_ID,
          userId: USER_ID,
          tokenHash: hashValue(TOKEN),
          expiresAt: new Date(Date.now() + 60_000),
          // The read that opens the window: from here on this request believes
          // the token is live, and stays wrong for as long as argon2 takes.
          usedAt: null,
        }),
        update: (args: unknown) => {
          record("passwordResetToken.update", args);

          return args;
        },
        deleteMany: (args: unknown) => {
          record("passwordResetToken.deleteMany", args);

          return args;
        },
      },
      user: {
        findFirst: async () => ({ id: USER_ID }),
        update: (args: unknown) => {
          record("user.update", args);

          return args;
        },
      },
      session: {
        updateMany: (args: unknown) => {
          record("session.updateMany", args);

          return args;
        },
      },
      auditEvent: {
        create: async ({ data }: { data: { eventType: string } }) => {
          auditEvents.push(data);

          return data;
        },
      },
      $transaction: async (callback: unknown) => {
        transactionCount.value += 1;
        inTransaction.value = true;

        try {
          return await (callback as (tx: unknown) => Promise<unknown>)(
            transactionClient,
          );
        } finally {
          inTransaction.value = false;
        }
      },
    },
  };
}

function createService(prisma: unknown) {
  return new PasswordResetService(
    prisma as never,
    { sendPasswordResetEmail: async () => "sent" } as never,
    {
      hashPassword: async () => "new-hash",
      verifyPassword: async () => true,
    } as never,
    { revokeUserSessions: async () => {} } as never,
    {} as never,
    { assertValidToken: async () => {} } as never,
    { penalizeFailure: async () => 0, clearFailures: async () => {} } as never,
  );
}

const request = { ip: "203.0.113.10", header: () => undefined } as never;
