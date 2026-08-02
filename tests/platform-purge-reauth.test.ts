import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";

import { PlatformService } from "../src/modules/platform/platform.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";
import type { UsersService } from "../src/modules/users/users.service";
import { createTestAuthAudit } from "./fixtures/auth-audit";
import { createTestLoginBackoff } from "./fixtures/login-backoff";

// Marking a tenant for purge is the one action that ends in data being gone.
// Until now the only thing standing in front of it was a permission every
// platform session already carries and a slug typed into a box — and a
// platform session lasts twelve hours and reaches every tenant's data, so
// "this request came from a live session" is not the same claim as "the person
// making it is the one who signed in".
describe("purge requires a fresh second factor", () => {
  it("marks the tenant when the code is accepted", async () => {
    const store = createStore();
    const service = createService(store);

    const marked = await service.requestTenantPurge("tenant-1", {
      confirmSlug: "pilot-a",
      mfaCode: "123456",
      actorUserId: "owner-1",
    });

    assert.ok(marked.purgeRequestedAt instanceof Date);
    assert.deepEqual(store.codesChecked, ["123456"]);
  });

  it("refuses a wrong code and changes nothing", async () => {
    const store = createStore();
    const service = createService(store, { codeAccepted: false });

    await assert.rejects(
      () =>
        service.requestTenantPurge("tenant-1", {
          confirmSlug: "pilot-a",
          mfaCode: "000000",
          actorUserId: "owner-1",
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "TENANT_PURGE_REAUTH_INVALID");
        assert.ok(response.fieldErrors.mfaCode);
        return true;
      },
    );

    assert.equal(store.tenant.purgeRequestedAt, null);
    assert.equal(store.events.length, 0);
  });

  it("charges a wrong code the same backoff and trail the login step does", async () => {
    // The asymmetry this closes: the login code step earns a growing delay
    // and an audit row on a wrong code, and this endpoint earned neither —
    // so a stolen session could pump codes at a destructive endpoint bounded
    // only by the global per-IP throttle, leaving nothing for the 3.5
    // alerting to fire on.
    const store = createStore();
    const service = createService(store, { codeAccepted: false });

    await assert.rejects(
      () =>
        service.requestTenantPurge("tenant-1", {
          confirmSlug: "pilot-a",
          mfaCode: "000000",
          actorUserId: "owner-1",
          requestId: "request-a",
        }),
      BadRequestException,
    );

    // Shared with the login scope on purpose: same account, same secret, so
    // guessing here must not buy an allowance the login page already spent.
    assert.deepEqual(
      store.backoff.delays.map((entry) => entry.scope),
      ["platform-login"],
    );
    assert.equal(store.backoff.delays[0]?.identity, "owner@vizitum.dev");

    assert.deepEqual(store.audit.events, [
      {
        eventType: "platform.reauth_failed",
        platformUserId: "owner-1",
        email: "owner@vizitum.dev",
        tenantId: "tenant-1",
        requestId: "request-a",
      },
    ]);
  });

  it("leaves the backoff and the trail alone when the code is right", async () => {
    const store = createStore();
    const service = createService(store);

    await service.requestTenantPurge("tenant-1", {
      confirmSlug: "pilot-a",
      mfaCode: "123456",
      actorUserId: "owner-1",
    });

    assert.deepEqual(store.backoff.delays, []);
    assert.deepEqual(store.audit.events, []);
  });

  it("refuses a missing code, so an omitted field is not a way past", async () => {
    const store = createStore();
    const service = createService(store, { codeAccepted: false });

    await assert.rejects(
      () =>
        service.requestTenantPurge("tenant-1", {
          confirmSlug: "pilot-a",
          actorUserId: "owner-1",
        }),
      BadRequestException,
    );
    assert.equal(store.tenant.purgeRequestedAt, null);
  });

  it("does not spend a code on a mistyped slug", async () => {
    // Verifying a code spends its step, so the owner would have to wait for
    // the next one. Every refusal that can be decided without the code is
    // decided before it — otherwise a typo costs thirty seconds and the
    // confirmation stops feeling like a safety net.
    const store = createStore();
    const service = createService(store);

    await assert.rejects(
      () =>
        service.requestTenantPurge("tenant-1", {
          confirmSlug: "wrong-slug",
          mfaCode: "123456",
          actorUserId: "owner-1",
        }),
      BadRequestException,
    );

    assert.deepEqual(store.codesChecked, []);
  });

  it("does not spend a code on a tenant that is not archived", async () => {
    const store = createStore({ status: "pilot" });
    const service = createService(store);

    await assert.rejects(
      () =>
        service.requestTenantPurge("tenant-1", {
          confirmSlug: "pilot-a",
          mfaCode: "123456",
          actorUserId: "owner-1",
        }),
      ConflictException,
    );

    assert.deepEqual(store.codesChecked, []);
  });

  it("does not spend a code when the tenant is already marked", async () => {
    // The idempotent no-op runs before the gate: asking twice is not an
    // attempt at anything, and should not cost the owner a code.
    const store = createStore({
      purgeRequestedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const service = createService(store);

    const result = await service.requestTenantPurge("tenant-1", {
      confirmSlug: "pilot-a",
      actorUserId: "owner-1",
    });

    assert.ok(result.purgeRequestedAt instanceof Date);
    assert.deepEqual(store.codesChecked, []);
  });

  it("refuses when the actor cannot be resolved to an active owner", async () => {
    for (const platformUser of [
      null,
      { id: "owner-1", email: "o@v.dev", totpSecret: "SECRET", status: "suspended" },
      // Enrolment is required before a session exists, so this is unreachable
      // through login — but a purge is not where to find out otherwise.
      { id: "owner-1", email: "o@v.dev", totpSecret: null, status: "active" },
    ]) {
      const store = createStore({}, platformUser);
      const service = createService(store);

      await assert.rejects(
        () =>
          service.requestTenantPurge("tenant-1", {
            confirmSlug: "pilot-a",
            mfaCode: "123456",
            actorUserId: "owner-1",
          }),
        ForbiddenException,
      );
      assert.equal(store.tenant.purgeRequestedAt, null);
    }
  });

  it("refuses when there is no actor at all", async () => {
    const store = createStore();
    const service = createService(store);

    await assert.rejects(
      () =>
        service.requestTenantPurge("tenant-1", {
          confirmSlug: "pilot-a",
          mfaCode: "123456",
        }),
      ForbiddenException,
    );
    assert.equal(store.tenant.purgeRequestedAt, null);
  });
});

function createStore(
  seed: Record<string, unknown> = {},
  platformUser: Record<string, unknown> | null = {
    id: "owner-1",
    email: "owner@vizitum.dev",
    totpSecret: "SECRET",
    status: "active",
  },
) {
  const tenant: Record<string, unknown> = {
    id: "tenant-1",
    slug: "pilot-a",
    name: "Pilot A",
    status: "archived",
    archivedAt: new Date("2026-06-01T00:00:00.000Z"),
    purgeRequestedAt: null,
    purgeStartedAt: null,
    adminLimit: 2,
    ...seed,
  };
  const events: Array<Record<string, unknown>> = [];
  const codesChecked: unknown[] = [];
  const backoff = createTestLoginBackoff();
  const audit = createTestAuthAudit();

  const client = {
    platformUser: {
      findUnique: async () => platformUser,
    },
    platformTenant: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === tenant.id ? { ...tenant } : null,
      findUniqueOrThrow: async () => ({ ...tenant }),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(tenant, data);
        return { count: 1 };
      },
    },
    platformOperationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      },
    },
  };

  const prisma = {
    ...client,
    $transaction: async (callback: (tx: typeof client) => Promise<unknown>) =>
      callback(client),
  };

  return { prisma, tenant, events, codesChecked, backoff, audit };
}

function createService(
  store: ReturnType<typeof createStore>,
  options: { codeAccepted?: boolean } = {},
) {
  return new PlatformService(
    store.prisma as unknown as PrismaService,
    {} as UsersService,
    {} as never,
    {
      acceptTotpCode: async (_user: unknown, code: unknown) => {
        store.codesChecked.push(code);

        return options.codeAccepted ?? true;
      },
    } as never,
    store.backoff,
    store.audit,
  );
}
