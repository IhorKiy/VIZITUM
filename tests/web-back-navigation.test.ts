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
      ["too long", `/field/history?q=${"x".repeat(600)}`],
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
