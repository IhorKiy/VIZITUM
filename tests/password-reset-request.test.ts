import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";

import { PasswordResetService } from "../src/modules/auth/password-reset.service";
import {
  PASSWORD_RESET_IP_LIMIT,
  PASSWORD_RESET_MAX_ACTIVE_TOKENS,
} from "../src/modules/auth/auth.constants";

const TENANT = {
  id: "tenant-a",
  name: "Demo Team",
  slug: "demo-team",
  language: "uk",
  timezone: "Europe/Kyiv",
};

type PrismaStubOptions = {
  user?: unknown;
  activeTokenCount?: number;
};

function createPrismaStub(options: PrismaStubOptions = {}) {
  const createdTokens: { tenantId: string; userId: string }[] = [];
  const auditEvents: { eventType: string; actorUserId: string }[] = [];
  const deletions: unknown[] = [];

  const prisma: Record<string, unknown> = {
    user: {
      findUnique: async () => options.user ?? null,
    },
    passwordResetToken: {
      deleteMany: async (query: unknown) => {
        deletions.push(query);
        return { count: 0 };
      },
      count: async () => options.activeTokenCount ?? 0,
      create: async ({ data }: { data: (typeof createdTokens)[number] }) => {
        createdTokens.push(data);
        return data;
      },
    },
    auditEvent: {
      create: async ({ data }: { data: (typeof auditEvents)[number] }) => {
        auditEvents.push(data);
        return data;
      },
    },
  };

  // Issuance runs inside a serializable transaction (the count and the create
  // must not race), so the stub hands the callback the same client back.
  prisma.$transaction = async (run: (tx: unknown) => Promise<unknown>) =>
    run(prisma);

  return { createdTokens, auditEvents, deletions, prisma };
}

function createEmailStub() {
  const sent: { to: string; token: string }[] = [];

  return {
    sent,
    emailService: {
      sendPasswordResetEmail: async (params: { to: string; token: string }) => {
        sent.push(params);
        return "sent" as const;
      },
    },
  };
}

function createService(overrides: {
  prisma: unknown;
  emailService: unknown;
  tenant?: typeof TENANT | null;
}) {
  const tenancyService = {
    resolveTenant: async () => {
      if (overrides.tenant === null) {
        throw new NotFoundException({ code: "TENANT_NOT_FOUND" });
      }

      return { tenant: overrides.tenant ?? TENANT, slug: TENANT.slug };
    },
  };

  return new PasswordResetService(
    overrides.prisma as never,
    overrides.emailService as never,
    { hashPassword: async () => "hash" } as never,
    { revokeUserSessions: async () => {} } as never,
    tenancyService as never,
    { assertValidToken: async () => {} } as never,
    createLoginBackoff() as never,
  );
}

// Only the change-password path consults it; the reset paths carry it so the
// constructor is satisfied.
function createLoginBackoff() {
  return {
    penalizeFailure: async () => 0,
    clearFailures: async () => {},
  };
}

function createRequest(ip = "203.0.113.10") {
  return {
    ip,
    path: `/${TENANT.slug}`,
    header: () => undefined,
    requestId: "request-a",
  } as never;
}

const ACTIVE_USER = { id: "user-a", status: "active", deletedAt: null };

describe("password reset request", () => {
  it("issues a token and sends the email for an active account", async () => {
    const { prisma, createdTokens, auditEvents } = createPrismaStub({
      user: ACTIVE_USER,
    });
    const { emailService, sent } = createEmailStub();
    const service = createService({ prisma, emailService });

    const result = await service.requestReset(
      { email: "Rep@Demo-Team.local", tenantSlug: TENANT.slug },
      createRequest(),
    );
    await service.settlePendingDispatches();

    assert.deepEqual(result, { ok: true });
    assert.equal(createdTokens.length, 1);
    assert.equal(createdTokens[0].userId, ACTIVE_USER.id);
    assert.equal(sent.length, 1);
    // The address is normalized before the lookup, so the mail goes to the
    // stored lowercase form rather than whatever casing was typed.
    assert.equal(sent[0].to, "rep@demo-team.local");
    assert.equal(auditEvents[0].eventType, "password.reset_requested");
  });

  // The whole point of the endpoint's shape: none of these may be
  // distinguishable from the success above by anything the caller can observe.
  it("acknowledges an unknown address without sending anything", async () => {
    const { prisma, createdTokens } = createPrismaStub({ user: null });
    const { emailService, sent } = createEmailStub();
    const service = createService({ prisma, emailService });

    const result = await service.requestReset(
      { email: "nobody@demo-team.local", tenantSlug: TENANT.slug },
      createRequest(),
    );
    await service.settlePendingDispatches();

    assert.deepEqual(result, { ok: true });
    assert.equal(createdTokens.length, 0);
    assert.equal(sent.length, 0);
  });

  it("acknowledges a suspended account without sending anything", async () => {
    const { prisma, createdTokens } = createPrismaStub({
      user: { id: "user-b", status: "suspended", deletedAt: null },
    });
    const { emailService, sent } = createEmailStub();
    const service = createService({ prisma, emailService });

    const result = await service.requestReset(
      { email: "suspended@demo-team.local", tenantSlug: TENANT.slug },
      createRequest(),
    );
    await service.settlePendingDispatches();

    assert.deepEqual(result, { ok: true });
    assert.equal(createdTokens.length, 0);
    assert.equal(sent.length, 0);
  });

  it("acknowledges an unresolvable tenant without sending anything", async () => {
    const { prisma, createdTokens } = createPrismaStub({ user: ACTIVE_USER });
    const { emailService, sent } = createEmailStub();
    const service = createService({ prisma, emailService, tenant: null });

    const result = await service.requestReset(
      { email: "rep@demo-team.local", tenantSlug: "no-such-tenant" },
      createRequest(),
    );
    await service.settlePendingDispatches();

    assert.deepEqual(result, { ok: true });
    assert.equal(createdTokens.length, 0);
    assert.equal(sent.length, 0);
  });

  it("stops issuing once the account holds the maximum live tokens", async () => {
    const { prisma, createdTokens } = createPrismaStub({
      user: ACTIVE_USER,
      activeTokenCount: PASSWORD_RESET_MAX_ACTIVE_TOKENS,
    });
    const { emailService, sent } = createEmailStub();
    const service = createService({ prisma, emailService });

    const result = await service.requestReset(
      { email: "rep@demo-team.local", tenantSlug: TENANT.slug },
      createRequest(),
    );
    await service.settlePendingDispatches();

    // Still the same acknowledgement — a throttled address must not be
    // distinguishable from one that was just mailed.
    assert.deepEqual(result, { ok: true });
    assert.equal(createdTokens.length, 0);
    assert.equal(sent.length, 0);
  });

  it("prunes spent and expired rows before counting live ones", async () => {
    const { prisma, deletions } = createPrismaStub({ user: ACTIVE_USER });
    const { emailService } = createEmailStub();
    const service = createService({ prisma, emailService });

    await service.requestReset(
      { email: "rep@demo-team.local", tenantSlug: TENANT.slug },
      createRequest(),
    );
    await service.settlePendingDispatches();

    assert.equal(deletions.length, 1);
    const where = (deletions[0] as { where: { OR: unknown[] } }).where;
    // Spent OR expired — never a live token, which would defeat the throttle.
    assert.equal(where.OR.length, 2);
  });

  it("drops requests from one address past the per-IP ceiling", async () => {
    const { prisma, createdTokens } = createPrismaStub({ user: ACTIVE_USER });
    const { emailService, sent } = createEmailStub();
    const service = createService({ prisma, emailService });
    const request = createRequest("198.51.100.7");

    const attempts = PASSWORD_RESET_IP_LIMIT * 2 + 5;

    // The limiter is instance state, so these accumulate across calls on this
    // one service.
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await service.requestReset(
        { email: "rep@demo-team.local", tenantSlug: TENANT.slug },
        request,
      );
    }
    await service.settlePendingDispatches();

    // Pinned to the exact ceiling rather than "fewer than we tried": a
    // regression that quietly raised the limit would still be under the loop
    // count and would pass an inequality unnoticed.
    assert.equal(createdTokens.length, PASSWORD_RESET_IP_LIMIT);
    assert.equal(sent.length, PASSWORD_RESET_IP_LIMIT);
  });

  it("counts the per-IP window per client address, not globally", async () => {
    const { prisma, createdTokens } = createPrismaStub({ user: ACTIVE_USER });
    const { emailService } = createEmailStub();
    const service = createService({ prisma, emailService });

    // One address exhausts its window; a second must still be served. This is
    // what silently stops being true when `request.ip` collapses to a single
    // proxy address for every caller — see common/trust-proxy.ts.
    for (let attempt = 0; attempt < PASSWORD_RESET_IP_LIMIT; attempt += 1) {
      await service.requestReset(
        { email: "rep@demo-team.local", tenantSlug: TENANT.slug },
        createRequest("198.51.100.8"),
      );
    }
    await service.settlePendingDispatches();
    const afterFirstAddress = createdTokens.length;

    await service.requestReset(
      { email: "rep@demo-team.local", tenantSlug: TENANT.slug },
      createRequest("198.51.100.9"),
    );
    await service.settlePendingDispatches();

    assert.equal(afterFirstAddress, PASSWORD_RESET_IP_LIMIT);
    assert.equal(createdTokens.length, PASSWORD_RESET_IP_LIMIT + 1);
  });
});
