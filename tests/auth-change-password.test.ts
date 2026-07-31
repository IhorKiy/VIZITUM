import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";

import { AuthService } from "../src/modules/auth/auth.service";
import { RolesService } from "../src/modules/roles/roles.service";
import { createTestLoginBackoff } from "./fixtures/login-backoff";

const SESSION = {
  id: "session-current",
  tenantId: "tenant-a",
  userId: "user-a",
};

const ACTIVE_USER = {
  id: "user-a",
  tenantId: "tenant-a",
  email: "rep@example.com",
  status: "active",
  passwordHash: "hash-of-current",
};

type Harness = {
  service: AuthService;
  updates: unknown[];
  revocations: unknown[];
  backoff: ReturnType<typeof createTestLoginBackoff>;
};

function createHarness(
  options: {
    currentPasswordMatches?: boolean;
    session?: typeof SESSION | null;
    user?: Partial<typeof ACTIVE_USER> | null;
    revokedOtherSessions?: number;
  } = {},
): Harness {
  const updates: unknown[] = [];
  const revocations: unknown[] = [];
  const backoff = createTestLoginBackoff();
  const user =
    options.user === null ? null : { ...ACTIVE_USER, ...options.user };
  const session = options.session === undefined ? SESSION : options.session;

  const service = new AuthService(
    {
      user: {
        findFirst: async () => user,
        update: async (query: unknown) => {
          updates.push(query);

          return user;
        },
      },
    } as never,
    {
      verifyPassword: async () => options.currentPasswordMatches ?? true,
      hashPassword: async (value: string) => `hash-of-${value}`,
    } as never,
    new RolesService(),
    {
      findActiveSessionByToken: async () => session,
      revokeOtherUserSessions: async (
        tenantId: string,
        userId: string,
        keepSessionId: string,
      ) => {
        revocations.push({ tenantId, userId, keepSessionId });

        return options.revokedOtherSessions ?? 0;
      },
    } as never,
    {} as never,
    { assertValidToken: async () => {} } as never,
    backoff,
  );

  return { service, updates, revocations, backoff };
}

function createRequest(token: string | null = "session-token") {
  return {
    header: (name: string) =>
      name.toLowerCase() === "cookie" && token
        ? `vizitum_session=${token}`
        : undefined,
  } as never;
}

describe("change password", () => {
  it("hashes the new password and keeps the caller signed in", async () => {
    const { service, updates, revocations } = createHarness({
      revokedOtherSessions: 3,
    });

    const result = await service.changePassword(
      { currentPassword: "old-password", newPassword: "new-password" },
      createRequest(),
    );

    assert.deepEqual(result, { ok: true, revokedOtherSessions: 3 });
    assert.deepEqual(updates, [
      {
        where: { id: "user-a" },
        data: { passwordHash: "hash-of-new-password" },
      },
    ]);
    // Every other session is revoked, this one is not. Leaving the others
    // alive would make the change cosmetic — a session cookie needs no
    // password to keep working — and revoking this one would sign out the
    // person who just proved they know the password.
    assert.deepEqual(revocations, [
      {
        tenantId: "tenant-a",
        userId: "user-a",
        keepSessionId: "session-current",
      },
    ]);
  });

  it("rejects a wrong current password without touching the stored hash", async () => {
    const { service, updates, revocations, backoff } = createHarness({
      currentPasswordMatches: false,
    });

    await assert.rejects(
      () =>
        service.changePassword(
          { currentPassword: "not-the-password", newPassword: "new-password" },
          createRequest(),
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

    assert.deepEqual(updates, []);
    assert.deepEqual(revocations, []);
    // A stolen session cookie must not turn this into a free oracle for the
    // account's password, so a failure here costs the same as a failed login.
    assert.deepEqual(backoff.delays, [
      {
        scope: "password-change",
        identity: "tenant-a:rep@example.com",
        delayMs: 0,
      },
    ]);
  });

  it("refuses to set the password to the current one", async () => {
    const { service, updates } = createHarness();

    await assert.rejects(
      () =>
        service.changePassword(
          { currentPassword: "same-password", newPassword: "same-password" },
          createRequest(),
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code?: string }).code,
          "PASSWORD_UNCHANGED",
        );

        return true;
      },
    );

    assert.deepEqual(updates, []);
  });

  it("rejects a new password shorter than the minimum", async () => {
    const { service } = createHarness();

    await assert.rejects(
      () =>
        service.changePassword(
          { currentPassword: "old-password", newPassword: "short" },
          createRequest(),
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code?: string }).code,
          "PASSWORD_CHANGE_INVALID",
        );

        return true;
      },
    );
  });

  it("requires a session", async () => {
    const { service } = createHarness();

    await assert.rejects(
      () =>
        service.changePassword(
          { currentPassword: "old-password", newPassword: "new-password" },
          createRequest(null),
        ),
      UnauthorizedException,
    );
  });

  it("rejects a session token that no longer resolves", async () => {
    const { service } = createHarness({ session: null });

    await assert.rejects(
      () =>
        service.changePassword(
          { currentPassword: "old-password", newPassword: "new-password" },
          createRequest(),
        ),
      UnauthorizedException,
    );
  });

  it("rejects a suspended account holding a live session", async () => {
    const { service } = createHarness({ user: { status: "suspended" } });

    await assert.rejects(
      () =>
        service.changePassword(
          { currentPassword: "old-password", newPassword: "new-password" },
          createRequest(),
        ),
      UnauthorizedException,
    );
  });

  it("clears the failure debt on a successful change", async () => {
    const { service, backoff } = createHarness();

    await service.changePassword(
      { currentPassword: "old-password", newPassword: "new-password" },
      createRequest(),
    );

    assert.deepEqual(backoff.cleared, [
      { scope: "password-change", identity: "tenant-a:rep@example.com" },
    ]);
  });
});

describe("invite acceptance against an existing account", () => {
  // An invite is a password-setting credential for its address and stays
  // valid for its full 7-day TTL. Both issue paths refuse an address that
  // already belongs to a live user, but nothing stopped an invite issued
  // *before* that account existed from being redeemed afterwards — which
  // overwrote the live account's password.
  function createAcceptHarness(existingUser: unknown) {
    const upserts: unknown[] = [];
    const client = {
      invite: {
        findUnique: async () => ({
          id: "invite-1",
          tenantId: "tenant-a",
          email: "rep@example.com",
          roleCodes: ["field_representative"],
          status: "pending",
          expiresAt: new Date(Date.now() + 60_000),
          createdByUserId: null,
        }),
        update: async () => {},
        updateMany: async () => ({ count: 1 }),
      },
      platformTenant: {
        findUniqueOrThrow: async () => ({ phoneCountry: "UA" }),
      },
      user: {
        findUnique: async () => existingUser,
        upsert: async (query: unknown) => {
          upserts.push(query);

          return { id: "user-a", email: "rep@example.com", status: "active" };
        },
        findMany: async () => [],
      },
      userRole: { upsert: async () => {} },
    };

    const service = new AuthService(
      {
        ...client,
        $transaction: async (callback: (tx: unknown) => unknown) =>
          callback(client),
      } as never,
      { hashPassword: async () => "hashed" } as never,
      new RolesService(),
      { createSession: async () => ({ token: "session-token" }) } as never,
      {} as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
    );

    return { service, upserts };
  }

  const acceptBody = {
    token: "invite-token",
    firstName: "Rep",
    lastName: "One",
    password: "password123",
    phone: "+380671234567",
  };

  it("refuses a stale invite for an account that is already active", async () => {
    const { service, upserts } = createAcceptHarness({
      status: "active",
      deletedAt: null,
    });

    await assert.rejects(
      () =>
        service.acceptInvite(
          acceptBody,
          { header: () => undefined } as never,
          {} as never,
        ),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code?: string }).code,
          "INVITE_ACCOUNT_ALREADY_ACTIVE",
        );

        return true;
      },
    );

    assert.deepEqual(upserts, [], "the stored password was never touched");
  });

  it("still lets a fresh invite reactivate a soft-deleted user", async () => {
    // Reactivation through a new invite is a supported flow, and a deleted
    // row carries status "deleted" — so only a genuinely live account is
    // refused above.
    const { service, upserts } = createAcceptHarness({
      status: "deleted",
      deletedAt: new Date(),
    });

    await service.acceptInvite(
      acceptBody,
      { header: () => undefined } as never,
      { cookie: () => {} } as never,
    );

    assert.equal(upserts.length, 1);
  });

  it("accepts normally when no user row exists yet", async () => {
    const { service, upserts } = createAcceptHarness(null);

    await service.acceptInvite(
      acceptBody,
      { header: () => undefined } as never,
      { cookie: () => {} } as never,
    );

    assert.equal(upserts.length, 1);
  });
});
