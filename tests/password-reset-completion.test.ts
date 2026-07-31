import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, UnauthorizedException } from "@nestjs/common";

import { hashValue } from "../src/modules/auth/auth-crypto";
import { SESSION_COOKIE_NAME } from "../src/modules/auth/auth.constants";
import { PasswordResetService } from "../src/modules/auth/password-reset.service";

const TENANT_ID = "tenant-a";
const USER_ID = "user-a";
const TOKEN = "reset-token-value";

function liveToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "token-1",
    tenantId: TENANT_ID,
    userId: USER_ID,
    tokenHash: hashValue(TOKEN),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    ...overrides,
  };
}

type ResetPrismaOptions = {
  resetToken?: unknown;
  user?: unknown;
};

function createResetPrisma(options: ResetPrismaOptions = {}) {
  const transactions: unknown[][] = [];
  const auditEvents: { eventType: string }[] = [];
  const updates: { model: string; args: unknown }[] = [];

  return {
    transactions,
    auditEvents,
    updates,
    prisma: {
      passwordResetToken: {
        findUnique: async () =>
          options.resetToken === undefined ? liveToken() : options.resetToken,
        update: (args: unknown) => {
          updates.push({ model: "passwordResetToken.update", args });
          return args;
        },
        deleteMany: (args: unknown) => {
          updates.push({ model: "passwordResetToken.deleteMany", args });
          return args;
        },
      },
      user: {
        findFirst: async () =>
          options.user === undefined ? { id: USER_ID } : options.user,
        update: (args: unknown) => {
          updates.push({ model: "user.update", args });
          return args;
        },
      },
      platformTenant: {
        findUnique: async () => ({ id: TENANT_ID }),
      },
      session: {
        updateMany: (args: unknown) => {
          updates.push({ model: "session.updateMany", args });
          return args;
        },
      },
      auditEvent: {
        create: async ({ data }: { data: { eventType: string } }) => {
          auditEvents.push(data);
          return data;
        },
      },
      $transaction: async (operations: unknown[]) => {
        transactions.push(operations);
        return operations;
      },
    },
  };
}

function createService(prisma: unknown, revoked: string[][] = []) {
  return new PasswordResetService(
    prisma as never,
    { sendPasswordResetEmail: async () => "sent" } as never,
    {
      hashPassword: async () => "new-hash",
      verifyPassword: async () => true,
    } as never,
    {
      revokeUserSessions: async (tenantId: string, userId: string) => {
        revoked.push([tenantId, userId]);
      },
    } as never,
    {} as never,
    { assertValidToken: async () => {} } as never,
  );
}

const request = { ip: "203.0.113.10", header: () => undefined } as never;

async function assertResetRejected(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    assert.equal(
      (error.getResponse() as { code?: string }).code,
      "PASSWORD_RESET_INVALID",
    );
    return true;
  });
}

describe("password reset completion", () => {
  it("spends the token, sets the password and revokes sessions in one transaction", async () => {
    const { prisma, transactions, auditEvents, updates } = createResetPrisma();
    const service = createService(prisma);

    const result = await service.resetPassword(
      { token: TOKEN, password: "new-password-1" },
      request,
    );

    assert.deepEqual(result, { ok: true });
    // All four writes are one unit. Session revocation in particular must not
    // be a follow-up write: if it were and it failed, the password would
    // already be changed while whoever prompted the reset still held a live
    // session — the exact guarantee this endpoint exists to give.
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].length, 4);
    assert.deepEqual(
      updates.map((update) => update.model),
      [
        "passwordResetToken.update",
        "user.update",
        "passwordResetToken.deleteMany",
        "session.updateMany",
      ],
    );
    assert.equal(auditEvents[0].eventType, "password.reset_completed");
  });

  it("rejects a token that was already spent", async () => {
    const { prisma } = createResetPrisma({
      resetToken: liveToken({ usedAt: new Date() }),
    });
    const service = createService(prisma);

    await assertResetRejected(
      service.resetPassword(
        { token: TOKEN, password: "new-password-1" },
        request,
      ),
    );
  });

  it("rejects a token past its expiry", async () => {
    const { prisma } = createResetPrisma({
      resetToken: liveToken({ expiresAt: new Date(Date.now() - 1_000) }),
    });
    const service = createService(prisma);

    await assertResetRejected(
      service.resetPassword(
        { token: TOKEN, password: "new-password-1" },
        request,
      ),
    );
  });

  it("rejects an unknown token", async () => {
    const { prisma } = createResetPrisma({ resetToken: null });
    const service = createService(prisma);

    await assertResetRejected(
      service.resetPassword(
        { token: "nope", password: "new-password-1" },
        request,
      ),
    );
  });

  it("rejects a token whose account is no longer active", async () => {
    const { prisma } = createResetPrisma({ user: null });
    const service = createService(prisma);

    await assertResetRejected(
      service.resetPassword(
        { token: TOKEN, password: "new-password-1" },
        request,
      ),
    );
  });

  it("rejects a password below the minimum length", async () => {
    const { prisma } = createResetPrisma();
    const service = createService(prisma);

    await assertResetRejected(
      service.resetPassword({ token: TOKEN, password: "short" }, request),
    );
  });
});

describe("password change", () => {
  function createChangePrisma(passwordHash: string | null = "old-hash") {
    const auditEvents: { eventType: string }[] = [];
    const updates: { model: string }[] = [];
    const transactions: unknown[][] = [];

    return {
      auditEvents,
      updates,
      transactions,
      prisma: {
        user: {
          findFirst: async () =>
            passwordHash === null ? null : { id: USER_ID, passwordHash },
          update: (args: unknown) => {
            updates.push({ model: "user.update" });
            return args;
          },
        },
        session: {
          updateMany: (args: unknown) => {
            updates.push({ model: "session.updateMany" });
            return args;
          },
        },
        passwordResetToken: {
          deleteMany: (args: unknown) => {
            updates.push({ model: "passwordResetToken.deleteMany" });
            return args;
          },
        },
        auditEvent: {
          create: async ({ data }: { data: { eventType: string } }) => {
            auditEvents.push(data);
            return data;
          },
        },
        $transaction: async (operations: unknown[]) => {
          transactions.push(operations);
          return operations;
        },
      },
    };
  }

  function createChangeService(
    prisma: unknown,
    options: { verifies?: boolean; revoked?: string[][] } = {},
  ) {
    return new PasswordResetService(
      prisma as never,
      { sendPasswordResetEmail: async () => "sent" } as never,
      {
        hashPassword: async () => "new-hash",
        verifyPassword: async () => options.verifies ?? true,
      } as never,
      {
        revokeUserSessions: async (tenantId: string, userId: string) => {
          options.revoked?.push([tenantId, userId]);
        },
        findActiveSessionByToken: async () => ({
          tenantId: TENANT_ID,
          userId: USER_ID,
        }),
        createSession: async () => ({ token: "fresh-session-token" }),
      } as never,
      {} as never,
      { assertValidToken: async () => {} } as never,
    );
  }

  // readSessionToken parses the raw `cookie` header, not express's parsed
  // `req.cookies`, so the stub has to supply the header itself.
  const signedInRequest = {
    ip: "203.0.113.10",
    header: (name: string) =>
      name === "cookie" ? `${SESSION_COOKIE_NAME}=session-token` : undefined,
  } as never;

  function createResponse() {
    const cookies: { name: string; value: string }[] = [];

    return {
      cookies,
      response: {
        cookie: (name: string, value: string) => {
          cookies.push({ name, value });
        },
      } as never,
    };
  }

  it("changes the password, revokes sessions and re-issues one for the caller", async () => {
    const { prisma, auditEvents, updates, transactions } = createChangePrisma();
    const service = createChangeService(prisma);
    const { response, cookies } = createResponse();

    const result = await service.changePassword(
      { currentPassword: "old-password", newPassword: "new-password-1" },
      signedInRequest,
      response,
    );

    assert.deepEqual(result, { ok: true });
    // The new password, the sign-out and the invalidation of pending reset
    // links commit together — a partial failure would otherwise leave exactly
    // the state the change was meant to end.
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].length, 3);
    assert.deepEqual(
      updates.map((update) => update.model),
      ["user.update", "session.updateMany", "passwordResetToken.deleteMany"],
    );
    // Session and CSRF cookies, so the person who just changed their password
    // keeps the screen they did it on while every other device is signed out.
    assert.equal(cookies.length, 2);
    assert.equal(auditEvents[0].eventType, "password.changed");
  });

  it("rejects a wrong current password without writing anything", async () => {
    const { prisma, updates } = createChangePrisma();
    const service = createChangeService(prisma, { verifies: false });
    const { response } = createResponse();

    await assert.rejects(
      service.changePassword(
        { currentPassword: "wrong", newPassword: "new-password-1" },
        signedInRequest,
        response,
      ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code?: string }).code,
          "CURRENT_PASSWORD_INVALID",
        );
        return true;
      },
    );
    assert.equal(updates.length, 0);
  });

  it("requires a session", async () => {
    const { prisma } = createChangePrisma();
    const service = new PasswordResetService(
      prisma as never,
      {} as never,
      {} as never,
      { findActiveSessionByToken: async () => null } as never,
      {} as never,
      {} as never,
    );
    const { response } = createResponse();

    await assert.rejects(
      service.changePassword(
        { currentPassword: "old-password", newPassword: "new-password-1" },
        { header: () => undefined } as never,
        response,
      ),
      UnauthorizedException,
    );
  });
});
