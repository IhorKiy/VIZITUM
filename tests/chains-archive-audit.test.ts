import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChainsService } from "../src/modules/chains/chains.service";

// Archiving a chain records who did it (audit F5).
//
// The finding files chains alongside the location and product *soft deletes*,
// and for chains that is not the mechanism: `Chain.deletedAt` is never written
// anywhere in the codebase. A chain is archived by a status change through the
// ordinary `updateChain` path, so that is where the attribution has to live.
//
// Which brings the problem soft deletes do not have — the same call also
// renames a chain and edits its external code. Only a real transition may
// leave a trail: a rename that emitted `chain.archived` would be worse than no
// event at all, since an operator reading the trail would go looking for an
// archiving that never happened.

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "user-a",
  roleCodes: ["company_admin"],
  permissions: [],
};

function chainRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "chain-a",
    tenantId: "tenant-a",
    name: "ATB",
    externalCode: null,
    status: "active",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

type Recorded = { eventType: string; inTransaction: boolean };

function buildService(existing: Record<string, unknown>, events: Recorded[]) {
  return new ChainsService(
    {
      chain: {
        // Two callers share this: the id lookup that loads the chain, and the
        // name/code availability checks a rename runs. Only the first should
        // find anything — the second finding a row means "already in use".
        // Told apart by the shape of `id`: the lookup passes the id itself,
        // the availability check passes `{ not: id }` to exclude this chain.
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          typeof where.id === "string" ? chainRow(existing) : null,
      },
      $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          chain: {
            update: async ({ data }: { data: Record<string, unknown> }) =>
              chainRow({ ...existing, ...data }),
          },
        }),
    } as never,
    {
      recordEvent: async (
        _context: unknown,
        input: { eventType: string },
        client?: unknown,
      ) => {
        events.push({
          eventType: input.eventType,
          inTransaction: client !== undefined,
        });
      },
    } as never,
  );
}

describe("chain archive attribution", () => {
  it("records who archived a chain, in the same transaction", async () => {
    const events: Recorded[] = [];

    await buildService({ status: "active" }, events).updateChain(
      context as never,
      "chain-a",
      { status: "archived" },
    );

    assert.deepEqual(events, [
      { eventType: "chain.archived", inTransaction: true },
    ]);
  });

  it("records the restore too, so the trail can say what is archived now", async () => {
    const events: Recorded[] = [];

    await buildService({ status: "archived" }, events).updateChain(
      context as never,
      "chain-a",
      { status: "active" },
    );

    assert.deepEqual(events, [
      { eventType: "chain.restored", inTransaction: true },
    ]);
  });

  it("stays silent when a rename touches no status", async () => {
    // The load-bearing negative. `updateChain` is the general edit path, so an
    // event on every call would make the trail unreadable.
    const events: Recorded[] = [];

    await buildService({ status: "active" }, events).updateChain(
      context as never,
      "chain-a",
      { name: "ATB Market" },
    );

    assert.deepEqual(events, []);
  });

  it("stays silent when the status is re-saved unchanged", async () => {
    // A form that always submits every field would otherwise record an
    // archiving each time somebody pressed save on an already-archived chain.
    const events: Recorded[] = [];

    await buildService({ status: "archived" }, events).updateChain(
      context as never,
      "chain-a",
      { status: "archived" },
    );

    assert.deepEqual(events, []);
  });
});
