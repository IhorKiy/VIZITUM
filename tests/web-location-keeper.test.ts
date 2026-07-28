import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LocationAssignment } from "../apps/web/lib/api-client";
import { resolveLocationKeeper } from "../apps/web/lib/location-keeper";

const ME = "user-me";

function assignment(
  userId: string,
  name: string,
  status: LocationAssignment["status"] = "active",
): LocationAssignment {
  return {
    id: `assignment-${userId}`,
    locationId: "loc-1",
    representativeUserId: userId,
    representative: { id: userId, email: `${userId}@acme.local`, name },
    status,
    assignedByUserId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("resolveLocationKeeper", () => {
  it("reports the reader's own location, so no screen marks the ordinary case", () => {
    const keeper = resolveLocationKeeper(
      [assignment(ME, "Me"), assignment("user-other", "Olena K.")],
      ME,
    );

    assert.deepEqual(keeper, { kind: "mine" });
  });

  it("names the single colleague who keeps a location the reader does not", () => {
    const keeper = resolveLocationKeeper(
      [assignment("user-other", "Olena K.")],
      ME,
    );

    assert.deepEqual(keeper, {
      kind: "others",
      name: "Olena K.",
      othersCount: 0,
    });
  });

  it("counts the rest when several colleagues keep it", () => {
    const keeper = resolveLocationKeeper(
      [
        assignment("user-a", "Olena K."),
        assignment("user-b", "Petro H."),
        assignment("user-c", "Iryna M."),
      ],
      ME,
    );

    assert.deepEqual(keeper, {
      kind: "others",
      name: "Olena K.",
      othersCount: 2,
    });
  });

  it("treats a location nobody keeps as its own state, not as someone else's", () => {
    assert.deepEqual(resolveLocationKeeper([], ME), { kind: "unassigned" });
  });

  it("stays unknown without a session, so no colleague is named to a stranger", () => {
    const keeper = resolveLocationKeeper(
      [assignment("user-other", "Olena K.")],
      null,
    );

    assert.deepEqual(keeper, { kind: "unknown" });
  });

  it("ignores an inactive assignment, whichever caller supplied the list", () => {
    const keeper = resolveLocationKeeper(
      [
        assignment("user-other", "Olena K.", "inactive"),
        assignment("user-b", "Petro H."),
      ],
      ME,
    );

    assert.deepEqual(keeper, {
      kind: "others",
      name: "Petro H.",
      othersCount: 0,
    });
  });

  it("does not treat the reader's own inactive assignment as ownership", () => {
    const keeper = resolveLocationKeeper(
      [assignment(ME, "Me", "inactive"), assignment("user-b", "Petro H.")],
      ME,
    );

    assert.deepEqual(keeper, {
      kind: "others",
      name: "Petro H.",
      othersCount: 0,
    });
  });
});
