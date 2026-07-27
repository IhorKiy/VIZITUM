import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  backOrigin,
  resolveBackTarget,
  withBackOrigin,
  type BackTarget,
} from "../apps/web/lib/back-navigation";

// The hierarchical parent every caller passes when the screen was opened
// without an origin.
const LOCATION_FALLBACK: BackTarget = {
  href: "/acme/field/locations/loc-1",
  labelKey: "location",
};

describe("resolveBackTarget", () => {
  it("falls back to the hierarchical parent when no origin was passed", () => {
    assert.deepEqual(
      resolveBackTarget("acme", undefined, LOCATION_FALLBACK),
      LOCATION_FALLBACK,
    );
  });

  it("returns the opener, tenant-prefixed, when one was passed", () => {
    assert.deepEqual(
      resolveBackTarget("acme", "/field/history", LOCATION_FALLBACK),
      { href: "/acme/field/history", labelKey: "history" },
    );
  });

  it("keeps the opener's filter state so the list is not reset", () => {
    assert.equal(
      resolveBackTarget(
        "acme",
        "/field/history?page=2&status=completed",
        LOCATION_FALLBACK,
      ).href,
      "/acme/field/history?page=2&status=completed",
    );
  });

  it("labels the destination it actually lands on, not the caller's default", () => {
    // The visit report defaults to "back to location"; opened from a
    // location's own history it must say — and do — otherwise.
    assert.equal(
      resolveBackTarget(
        "acme",
        "/field/locations/loc-1/history",
        LOCATION_FALLBACK,
      ).labelKey,
      "locationHistory",
    );
  });

  it("unwinds one screen at a time through a nested origin chain", () => {
    // Locations list → location card → visit report: the report returns to
    // the card, and the card still knows the list it came from.
    const listOrigin = backOrigin("/field/locations", { city: "Kyiv" });
    const cardOrigin = backOrigin("/field/locations/loc-1", {
      from: listOrigin,
    });

    const fromReport = resolveBackTarget("acme", cardOrigin, {
      href: "/acme/field",
      labelKey: "route",
    });

    assert.equal(fromReport.labelKey, "location");
    assert.equal(
      fromReport.href,
      "/acme/field/locations/loc-1?from=%2Ffield%2Flocations%3Fcity%3DKyiv",
    );

    // What the card itself then reads back out of its own URL.
    assert.deepEqual(resolveBackTarget("acme", listOrigin, LOCATION_FALLBACK), {
      href: "/acme/field/locations?city=Kyiv",
      labelKey: "locations",
    });
  });

  describe("rejects an origin that isn't a real in-app screen", () => {
    // Each of these must fall back rather than become the back link's href —
    // `from` is attacker-controllable, so the allowlist is the only thing
    // standing between it and an off-site or cross-tenant redirect.
    const rejected: [string, string][] = [
      ["absolute URL", "https://evil.example/steal"],
      ["protocol-relative URL", "//evil.example/steal"],
      ["backslash-folded host", "/\\evil.example"],
      ["unknown path", "/field/not-a-screen"],
      ["already tenant-prefixed", "/acme/field/history"],
      ["another tenant", "/other-tenant/field/history"],
      ["empty", ""],
      ["too long", `/field/history?q=${"x".repeat(2100)}`],
    ];

    for (const [name, value] of rejected) {
      it(name, () => {
        assert.deepEqual(
          resolveBackTarget("acme", value, LOCATION_FALLBACK),
          LOCATION_FALLBACK,
        );
      });
    }

    it("newline in the path", () => {
      assert.deepEqual(
        resolveBackTarget("acme", "/field\n/history", LOCATION_FALLBACK),
        LOCATION_FALLBACK,
      );
    });
  });

  describe("keeps a back control inside its own zone", () => {
    // The allowlist is global, so without a zone check a crafted origin could
    // make one zone's screen advertise a destination in another — never a
    // privilege hole (the target still enforces its own permissions), but a
    // link pointing somewhere its screen has no relationship to. The zone is
    // taken from the fallback, which is always a screen in the current zone.
    const MANAGER_FALLBACK: BackTarget = {
      href: "/acme/manager/visits",
      labelKey: "visits",
    };

    it("rejects a field origin on a manager screen", () => {
      assert.deepEqual(
        resolveBackTarget("acme", "/field/tasks", MANAGER_FALLBACK),
        MANAGER_FALLBACK,
      );
    });

    it("rejects a field origin on an admin screen", () => {
      const adminFallback: BackTarget = {
        href: "/acme/admin/locations",
        labelKey: "locations",
      };

      assert.deepEqual(
        resolveBackTarget("acme", "/field/locations", adminFallback),
        adminFallback,
      );
    });

    it("rejects an admin origin on a field screen", () => {
      assert.deepEqual(
        resolveBackTarget("acme", "/admin/locations", LOCATION_FALLBACK),
        LOCATION_FALLBACK,
      );
    });

    it("still accepts an origin from the fallback's own zone", () => {
      assert.equal(
        resolveBackTarget(
          "acme",
          "/manager/visits?status=completed",
          MANAGER_FALLBACK,
        ).href,
        "/acme/manager/visits?status=completed",
      );
    });
  });

  it("carries a deep chain of Cyrillic filters without flattening to the fallback", () => {
    // Percent-encoding compounds per level — Cyrillic costs 6 characters per
    // letter at the first level and ~10 at the second — so a full-length
    // search term three levels down is what the length cap has to clear.
    const search = "п".repeat(100);
    const listOrigin = backOrigin("/field/locations", { search });
    const cardOrigin = backOrigin("/field/locations/loc-1", {
      from: listOrigin,
    });
    const historyOrigin = backOrigin("/field/locations/loc-1/history", {
      from: cardOrigin,
    });

    const fromReport = resolveBackTarget("acme", historyOrigin, {
      href: "/acme/field",
      labelKey: "route",
    });

    assert.equal(fromReport.labelKey, "locationHistory");
    assert.ok(
      fromReport.href.startsWith("/acme/field/locations/loc-1/history?from="),
      `expected the visit history, got ${fromReport.href}`,
    );
  });

  it("drops a fragment rather than carrying it into the href", () => {
    assert.equal(
      resolveBackTarget("acme", "/field/history#anchor", LOCATION_FALLBACK)
        .href,
      "/acme/field/history",
    );
  });
});

describe("backOrigin", () => {
  it("omits unset and empty filters so an untouched list stays a bare path", () => {
    assert.equal(
      backOrigin("/field/history", {
        page: undefined,
        status: null,
        startedFrom: "",
      }),
      "/field/history",
    );
  });

  it("keeps the filters that are set", () => {
    assert.equal(
      backOrigin("/manager/visits", { status: "completed", page: 2 }),
      "/manager/visits?status=completed&page=2",
    );
  });
});

describe("withBackOrigin", () => {
  it("starts the query string when the link has none", () => {
    assert.equal(
      withBackOrigin("/acme/field/visits/v-1", "/field/history"),
      "/acme/field/visits/v-1?from=%2Ffield%2Fhistory",
    );
  });

  it("appends to a link that already carries params", () => {
    assert.equal(
      withBackOrigin("/acme/field/locations/loc-1?routeItemId=r-1", "/field"),
      "/acme/field/locations/loc-1?routeItemId=r-1&from=%2Ffield",
    );
  });

  it("round-trips through resolveBackTarget", () => {
    const origin = backOrigin("/field/history", { status: "completed" });
    const href = withBackOrigin("/acme/field/visits/v-1", origin);
    const from = new URL(href, "https://app.local").searchParams.get("from");

    assert.equal(
      resolveBackTarget("acme", from ?? undefined, LOCATION_FALLBACK).href,
      "/acme/field/history?status=completed",
    );
  });
});
