import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";

import { AuthService } from "../src/modules/auth/auth.service";
import { RolesService } from "../src/modules/roles/roles.service";
import { createTestLoginBackoff } from "./fixtures/login-backoff";

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
