import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { AuthService } from "../src/modules/auth/auth.service";
import { RolesService } from "../src/modules/roles/roles.service";
import { createTestLoginBackoff } from "./fixtures/login-backoff";
import { createTestAuthAudit } from "./fixtures/auth-audit";

// Invite acceptance parses the optional phone against the invite tenant's
// phoneCountry and stores E.164 — the same policy as every other phone write
// path (see src/common/phone.ts).

function createRequest() {
  return {
    requestId: "request-a",
    header: () => undefined,
  };
}

function createResponse() {
  return { cookie: () => {} };
}

function createService(phoneCountry: string | null) {
  const upserts: Array<{ create: Record<string, unknown> }> = [];
  const client = {
    platformTenant: {
      findUniqueOrThrow: async () => ({ phoneCountry }),
    },
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
    user: {
      // acceptInvite refuses a stale invite for an account that is already
      // live; no such account exists in these fixtures.
      findUnique: async () => null,
      upsert: async (query: { create: Record<string, unknown> }) => {
        upserts.push(query);

        return {
          id: "user-1",
          email: "rep@example.com",
          firstName: "Rep",
          lastName: "Alpha",
          name: "Rep Alpha",
          status: "active",
          lastSelectedRoleCode: "field_representative",
        };
      },
      findMany: async () => [],
    },
    userRole: {
      upsert: async () => ({}),
      deleteMany: async () => {},
    },
    auditEvent: {
      create: async () => {},
    },
  };
  const service = new AuthService(
    {
      ...client,
      $transaction: async (cb: (tx: unknown) => unknown) => cb(client),
    } as never,
    { hashPassword: async () => "hashed" } as never,
    new RolesService(),
    {
      createSession: async () => ({ token: "session-token" }),
      revokeUserSessions: async () => {},
    } as never,
    {} as never,
    { assertValidToken: async () => {} } as never,
    createTestLoginBackoff(),
    createTestAuthAudit(),
  );

  return { service, upserts };
}

function acceptBody(phone: string | undefined) {
  return {
    token: "invite-token",
    firstName: "Rep",
    lastName: "Alpha",
    password: "password123",
    phone,
  };
}

describe("invite accept phone normalization", () => {
  it("stores a national phone as E.164 using the invite tenant's phone country", async () => {
    const { service, upserts } = createService("UA");

    await service.acceptInvite(
      acceptBody("067 123 45 67"),
      createRequest() as never,
      createResponse() as never,
    );

    assert.equal(upserts[0]?.create.phone, "+380671234567");
  });

  it("stores a '+'-international phone as E.164 even without a tenant phone country", async () => {
    const { service, upserts } = createService(null);

    await service.acceptInvite(
      acceptBody("+49 30 901820"),
      createRequest() as never,
      createResponse() as never,
    );

    assert.equal(upserts[0]?.create.phone, "+4930901820");
  });

  it("stores null when no phone is provided", async () => {
    const { service, upserts } = createService("UA");

    await service.acceptInvite(
      acceptBody(undefined),
      createRequest() as never,
      createResponse() as never,
    );

    assert.equal(upserts[0]?.create.phone, null);
  });

  it("rejects an invalid phone with a phone field error", async () => {
    const { service, upserts } = createService("UA");

    await assert.rejects(
      () =>
        service.acceptInvite(
          acceptBody("not a phone"),
          createRequest() as never,
          createResponse() as never,
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "INVITE_ACCEPTANCE_INVALID");
        assert.ok(response.fieldErrors.phone);
        return true;
      },
    );
    assert.equal(upserts.length, 0);
  });

  it("rejects a national phone when the tenant has no phone country", async () => {
    const { service, upserts } = createService(null);

    await assert.rejects(
      () =>
        service.acceptInvite(
          acceptBody("067 123 45 67"),
          createRequest() as never,
          createResponse() as never,
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        return true;
      },
    );
    assert.equal(upserts.length, 0);
  });
});
